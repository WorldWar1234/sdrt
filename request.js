import request from 'request';
import sharp from 'sharp';
import { Readable } from 'stream';

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
  // Configure Sharp's behavior
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  // Pipe the input stream to Sharp for processing
  inputStream.pipe(sharpInstance);

  // Process metadata to check for resize and apply transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Set the content type and output format
      res.setHeader('Content-Type', `image/${format}`);
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          // Set headers for the compressed image
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .on('data', (chunk) => {
          const buffer = Buffer.from(chunk); // Convert chunk to a Buffer
          res.write(buffer); // Send the buffer chunk
        })
        .on('end', () => {
          res.end(); // End the response once all chunks have been sent
        });
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.statusCode = 500;
      res.end('Failed to fetch image metadata.');
    });
}

// Function to handle image compression requests
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  req.params = {
    url: decodeURIComponent(url),
    // If the query string contains "jpeg", then do not use webp.
    webp: !req.query.jpeg,
    // If "bw" is not zero then use grayscale
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  // Create a streaming request using the request npm package.
  const imageRequest = request.get({ url: req.params.url, encoding: null });

  // Listen for the response event to access headers and statusCode.
  imageRequest.on('response', (response) => {
    if (response.statusCode >= 400) {
      res.status(response.statusCode).send('Failed to fetch the image.');
      return;
    }

    // Extract the content type and content length from response headers.
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      // If compression is needed, pipe the request stream to our compress function.
      compress(req, res, imageRequest);
    } else {
      // If no compression is needed, stream the original image directly.
    //  res.setHeader('Content-Type', req.params.originType);
    //  res.setHeader('Content-Length', req.params.originSize);
      imageRequest.pipe(res);
    }
  });

  imageRequest.on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}
