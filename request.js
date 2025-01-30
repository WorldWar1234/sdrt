import { request } from 'undici';
import gm from 'gm';
import { PassThrough } from 'stream';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;
const CACHE_TTL = 3600; // 1 hour cache

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType?.startsWith('image') || originSize === 0 || req.headers.range) {
    return false;
  }

  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }

  return true;
}

// Function to compress an image stream directly using ImageMagick
function compress(req, res, inputStream) {
  const format = req.params.webp ? 'webp' : 'jpeg';
  const outputStream = new PassThrough();

  // Create ImageMagick instance
  const image = gm(inputStream);

  // Resize if height exceeds the limit
  image.resize(null, MAX_HEIGHT);

  // Apply grayscale if requested
  if (req.params.grayscale) {
    image.grayscale();
  }

  // Set output format and quality
  image
    .setFormat(format)
    .quality(req.params.quality)
    .stream((err, stdout) => {
      if (err) {
        console.error('ImageMagick error:', err);
        res.status(500).send('Image processing failed');
        return;
      }

      // Set response headers
      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
      res.setHeader('Vary', 'Accept');

      // Stream the processed image to the response
      stdout.pipe(outputStream);
      outputStream.pipe(res);
    });
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

  try {
    const { body, headers, statusCode } = await request(req.params.url);

    // Handle failed origin fetch
    if (statusCode >= 400) {
      return res.status(statusCode).send('Failed to fetch the image.');
    }

    req.params.originType = headers['content-type'];
    req.params.originSize = parseInt(headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      // Compress the image using ImageMagick
      compress(req, res, body);
    } else {
      // Stream the original image with caching headers
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
      res.setHeader('Vary', 'Accept');
      body.pipe(res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
