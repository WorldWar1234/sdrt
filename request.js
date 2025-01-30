import { request } from 'undici';
import sharp from 'sharp';
import { PassThrough } from 'stream';

// Constants (configurable via environment variables)
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = parseInt(process.env.DEFAULT_QUALITY, 10) || 80;
const MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT, 10) || 16383;
const CACHE_TTL = parseInt(process.env.CACHE_TTL, 10) || 3600; // Cache TTL in seconds

// Cache setup (using a simple in-memory cache)
const cache = new Map();

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  // Early return for non-image types or empty files
  if (!originType?.startsWith('image') || originSize === 0 || req.headers.range) {
    return false;
  }

  // Skip compression for small files
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }

  return true;
}

// Function to compress an image stream directly
async function compress(req, res, inputStream) {
  try {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false })
      .on('error', (err) => {
        console.error('Sharp processing error:', err.message);
        throw err;
      });

    inputStream.pipe(sharpInstance);

    const metadata = await sharpInstance.metadata();

    // Resize if height exceeds the limit
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }

    // Apply grayscale if requested
    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    // Set response headers
    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);

    // Stream the processed image to the response
    const outputStream = sharpInstance
      .toFormat(format, { quality: req.params.quality, effort: 0 })
      .on('info', (info) => {
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
      });

    outputStream.pipe(res);
  } catch (err) {
    console.error('Compression error:', err.message);
    res.status(500).send('Failed to process the image.');
  }
}

// Function to handle image compression requests
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;

  // Validate URL
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  // Decode and validate the URL to prevent SSRF
  let decodedUrl;
  try {
    decodedUrl = new URL(decodeURIComponent(url));
    if (!['http:', 'https:'].includes(decodedUrl.protocol)) {
      return res.status(400).send('Invalid URL protocol.');
    }
  } catch (err) {
    return res.status(400).send('Invalid URL.');
  }

  // Set request parameters
  req.params = {
    url: decodedUrl.toString(),
    webp: !req.query.jpeg,
    grayscale: req.query.bw !== '0',
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  // Generate a cache key based on the request parameters
  const cacheKey = JSON.stringify(req.params);

  // Check cache for previously processed images
  if (cache.has(cacheKey)) {
    const { headers, body } = cache.get(cacheKey);
    headers['X-Cache'] = 'HIT'; // Indicate that the response is served from cache
    res.writeHead(200, headers);
    return body.pipe(res);
  }

  try {
    const { body, headers, statusCode } = await request(req.params.url);

    // Validate response
    if (statusCode >= 400) {
      return res.status(statusCode).send('Failed to fetch the image.');
    }

    req.params.originType = headers['content-type'];
    req.params.originSize = parseInt(headers['content-length'], 10) || 0;

    // Create a PassThrough stream to cache the response
    const cacheStream = new PassThrough();
    const chunks = [];

    cacheStream.on('data', (chunk) => chunks.push(chunk));
    cacheStream.on('end', () => {
      // Cache the response
      cache.set(cacheKey, {
        headers: {
          'Content-Type': req.params.originType,
          'Content-Length': req.params.originSize,
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
        },
        body: Buffer.concat(chunks),
      });
    });

    if (shouldCompress(req)) {
      // Compress the image and pipe to both response and cache
      await compress(req, res, body);
      body.pipe(cacheStream);
    } else {
      // Stream the original image to both response and cache
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
      body.pipe(res);
      body.pipe(cacheStream);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
