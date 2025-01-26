import https from 'https';
import Jimp from 'jimp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize } = req.params;

  if (!originType.startsWith('image')) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  if (originSize < MIN_COMPRESS_LENGTH) return false;
  if (
    (originType.endsWith('png') || originType.endsWith('gif')) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Function to compress an image stream directly
async function compress(req, res, inputStream) {
  try {
    const image = await Jimp.read(inputStream);

    if (req.params.grayscale) {
      image.grayscale();
    }

    if (image.getHeight() > MAX_HEIGHT) {
      image.resize(Jimp.AUTO, MAX_HEIGHT);
    }

    const buffer = await image.getBufferAsync(Jimp.MIME_JPEG, { quality: req.params.quality });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Original-Size', req.params.originSize);
    res.setHeader('X-Processed-Size', buffer.length);
    res.setHeader('X-Bytes-Saved', req.params.originSize - buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error('Error compressing image:', err.message);
    res.statusCode = 500;
    res.end('Failed to compress image.');
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
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.q, 10) || DEFAULT_QUALITY,
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
