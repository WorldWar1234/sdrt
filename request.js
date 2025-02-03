import { request } from 'undici';
import sharp from 'sharp';
import { pipeline } from 'stream/promises';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType?.startsWith('image')) return false;
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
async function compress(req, res, inputStream) {
  try {
    sharp.cache(false);
    sharp.concurrency(1);
    sharp.simd(true);

    const format = req.params.webp ? 'webp' : 'jpeg';
    const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

    // Handle metadata and apply transformations
    const metadata = await sharpInstance.metadata();

    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }

    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    // Set headers for the compressed image
    res.setHeader('Content-Type', `image/${format}`);

    const outputStream = sharpInstance
      .toFormat(format, { quality: req.params.quality, effort: 0 })
      .on('info', (info) => {
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
      });

    // Use pipeline for better stream handling
    await pipeline(inputStream, sharpInstance, res);
  } catch (err) {
    console.error('Error during compression:', err.message);
    res.status(500).send('Failed to compress the image.');
  }
}

// Function to handle image compression requests
export async function fetchImageAndHandle(req, res) {
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

  try {
    const { body, headers, statusCode } = await request(req.params.url);

    req.params.originType = headers['content-type'];
    req.params.originSize = parseInt(headers['content-length'], 10) || 0;

    if (statusCode >= 400) {
      return res.status(statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Compress the stream
      await compress(req, res, body);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      await pipeline(body, res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
