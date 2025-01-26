import https from 'https';
import gm from 'gm';
import { PassThrough } from 'stream';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith('image')) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (
    !webp &&
    (originType.endsWith('png') || originType.endsWith('gif')) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Function to compress an image stream directly
function compress(req, res, inputStream) {
  const format = req.params.webp ? 'webp' : 'jpeg';
  const quality = req.params.quality;
  const passthrough = new PassThrough();

  gm(inputStream)
    .quality(quality)
    .resize(null, MAX_HEIGHT > 0 ? MAX_HEIGHT : null) // Resize if height exceeds MAX_HEIGHT
    .toBuffer(format, (err, buffer) => {
      if (err) {
        console.error('Error compressing image:', err.message);
        res.statusCode = 500;
        return res.end('Failed to compress image.');
      }

      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('X-Original-Size', req.params.originSize);
      res.setHeader('X-Processed-Size', buffer.length);
      res.setHeader('X-Bytes-Saved', req.params.originSize - buffer.length);
      res.end(buffer);
    });

  if (req.params.grayscale) {
    gm(inputStream).colorspace(' Gray').stream();
  }
}

// Function to handle image compression requests
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  https.get(req.params.url, (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Compress the stream
      compress(req, res, response);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res);
    }
  }).on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}
