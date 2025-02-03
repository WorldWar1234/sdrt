import got from 'got';
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
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  inputStream.pipe(sharpInstance); // Pipe input stream to Sharp for processing

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

      // Pipe the processed image directly to the response
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
          //const buffer = Buffer.from(chunk); // Convert chunk to buffer
          res.write(chunk); // Send the buffer chunk
        })
        .on('end', () => {
          res.end(); // Ensure the response ends after all chunks are sent
        })
        .on('error', (err) => {
          console.error('Error processing image:', err.message);
          res.statusCode = 500;
          res.end('Failed to process the image.');
        });
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.statusCode = 500;
      res.end('Failed to fetch image metadata.');
    });
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
    // Use got to stream the image
    const stream = got.stream(req.params.url);

    // Handle response headers
    stream.on('response', (response) => {
      req.params.originType = response.headers['content-type'];
      req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

      if (response.statusCode >= 400) {
        return res.status(response.statusCode).send('Failed to fetch the image.');
      }

      if (shouldCompress(req)) {
        // Compress the stream
        compress(req, res, stream);
      } else {
        // Stream the original image to the response if compression is not needed
        res.setHeader('Content-Type', req.params.originType);
        stream.pipe(res);
      }
    });

    // Handle errors
    stream.on('error', (error) => {
      console.error('Error fetching image:', error.message);
      res.status(500).send('Failed to fetch the image.');
    });
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
} 
