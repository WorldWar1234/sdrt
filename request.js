import { request } from 'undici';
import imagemagick from 'imagemagick';

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
async function compress(req, res, inputStream) {
  try {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const quality = req.params.quality || DEFAULT_QUALITY;
    const args = ['-', '-resize', `x${MAX_HEIGHT}`, '-quality', quality, '-format', format, '-'];

    // If grayscale is requested, apply it
    if (req.params.grayscale) {
      args.push('-colorspace', 'Gray');
    }

    // Set response headers
    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
    res.setHeader('CDN-Cache-Control', `public, max-age=${CACHE_TTL}`);
    res.setHeader('Vary', 'Accept');

    // Process the image using ImageMagick
    const convert = imagemagick.convert;

    convert([inputStream, ...args], (err, stdout, stderr) => {
      if (err) {
        console.error('ImageMagick error:', stderr || err);
        return res.status(500).send('Image processing failed');
      }

      // Get the processed image's size
      const processedSize = Buffer.byteLength(stdout);

      // Send the image back as a response
      res.setHeader('X-Processed-Size', processedSize);
      res.setHeader('X-Original-Size', req.params.originSize);
      res.setHeader('X-Bytes-Saved', req.params.originSize - processedSize);
      res.end(stdout);
    });
  } catch (err) {
    console.error('Compression failed:', err);
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
      await compress(req, res, body);
    } else {
      // Stream the original image with Cloudflare caching headers
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
      res.setHeader('CDN-Cache-Control', `public, max-age=${CACHE_TTL}`);
      res.setHeader('Vary', 'Accept');
      body.pipe(res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
