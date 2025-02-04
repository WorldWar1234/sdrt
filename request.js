import http from 'stream-http';
import sharp from 'sharp';
import { URL } from 'url';

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
  // Configure sharp settings
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({
    unlimited: false,
    animated: false,
    limitInputPixels: false,
  });

  // Pipe the input stream to Sharp for processing
  inputStream.pipe(sharpInstance);

  // Handle metadata and apply transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Set the response Content-Type header
      res.setHeader('Content-Type', `image/${format}`);

      // Convert to the desired format and quality
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          // Set headers for the compressed image
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .on('data', (chunk) => {
          // Write each chunk of data to the response
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

// Function to handle image compression requests using stream-http
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    res.statusCode = 400;
    return res.end('Image URL is required.');
  }
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // if query parameter "jpeg" is provided, do not convert to webp
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  let urlObj;
  try {
    urlObj = new URL(req.params.url);
  } catch (err) {
    res.statusCode = 400;
    return res.end('Invalid URL.');
  }

  // Build the options for the stream-http request.
  const options = {
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
  };

  // Initiate the HTTP request using stream-http
  const clientRequest = http.request(options, (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      res.statusCode = response.statusCode;
      return res.end('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Compress the image stream if needed
      compress(req, res, response);
    } else {
      // Otherwise, pipe the original image stream directly to the response
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res);
    }
  });

  clientRequest.on('error', (err) => {
    console.error('Error fetching image:', err.message);
    res.statusCode = 500;
    res.end('Failed to fetch the image.');
  });

  clientRequest.end();
}
