import { request } from "undici";
import sharp from "sharp";

// Constants remain the same
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;

// Utility function remains unchanged
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

// compress function remains the same
function compress(req, res, inputStream) {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  inputStream.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      res.setHeader('Content-Type', `image/${format}`);
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .pipe(res);
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.status(500).send('Failed to fetch image metadata.');
    });
}

// Updated fetch handling using undici
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
    // Use undici.request instead of fetch
    const response = await request(req.params.url, {
      maxRedirections: 4, // Handle redirects similarly to node-fetch
    });

    // Check if the status code is in the 200-299 range
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    // Extract headers using object notation
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      compress(req, res, response.body);
    } else {
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.body.pipe(res); // Stream the original image
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
