import { request } from 'undici';
import sharp from 'sharp';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType?.startsWith('image')) return false;
  if (!originSize) return false;
  if (req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }

  return true;
}

// Function to compress an image stream
async function compress(req, res, inputStream) {
  try {
    sharp.cache(false);
    sharp.concurrency(1);
    sharp.simd(true);

    const format = req.params.webp ? 'webp' : 'jpeg';
    const sharpInstance = sharp().on('error', (err) => {
      console.error('Sharp processing error:', err.message);
      res.status(500).send('Image processing failed.');
    });

    const metadata = await sharpInstance.metadata();
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }

    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    res.setHeader('Content-Type', `image/${format}`);
    inputStream.pipe(sharpInstance);

    await pipe(
      sharpInstance.toFormat(format, { quality: req.params.quality, effort: 0 }),
      res
    );

  } catch (err) {
    console.error('Compression failed:', err.message);
    res.status(500).send('Failed to process the image.');
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
      await compress(req, res, body);
    } else {
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      await pipe(body, res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
