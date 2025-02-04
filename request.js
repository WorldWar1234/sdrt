import phin from 'phin';
import sharp from 'sharp';

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
  // Configure Sharp options
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({
    unlimited: false,
    animated: false,
    limitInputPixels: false,
  });

  // Pipe the input stream into Sharp for processing
  inputStream.pipe(sharpInstance);

  // Process metadata and transformations
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
      // Convert the image to the desired format and stream it to the response
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .on('data', (chunk) => {
          // Write each chunk to the response
          res.write(Buffer.from(chunk));
        })
        .on('end', () => {
          res.end();
        });
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.statusCode = 500;
      res.end('Failed to fetch image metadata.');
    });
}

// Function to handle image compression requests using phin
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // If the "jpeg" query parameter is provided, do not convert to WebP
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  // Use phin to fetch the image with streaming enabled
  phin({ url: req.params.url, stream: true }, (err, response) => {
    if (err) {
      console.error('Error fetching image:', err.message);
      return res.status(500).send('Failed to fetch the image.');
    }

    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Compress the image stream if needed
      compress(req, res, response);
    } else {
      // Otherwise, simply pipe the original image stream to the response
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res);
    }
  });
}
