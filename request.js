import fetch from 'node-fetch';
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

// Function to compress an image stream using Sharp and .on events
function compress(req, res, inputStream) {
  // Disable Sharp's caching and configure concurrency
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);

  // Determine the target format
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({
    unlimited: false,
    animated: false,
    limitInputPixels: false,
  });

  // Pipe the incoming image stream into Sharp
  inputStream.pipe(sharpInstance);

  // Read the image metadata to conditionally apply transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Set the response content type based on the output format
      res.setHeader('Content-Type', `image/${format}`);

      // Process the image into the desired format and quality
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          // Set additional headers reporting processing details
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .on('data', (chunk) => {
          res.write(chunk);
        })
        .on('end', () => {
          res.end();
        });
    })
    .catch((err) => {
      console.error('Error processing image metadata:', err.message);
      res.statusCode = 500;
      res.end('Failed to process image metadata.');
    });
}

// Function to handle image compression requests using fetch
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  // Parse query parameters and set defaults
  req.params = {
    url: decodeURIComponent(url),
    // Use WebP unless a "jpeg" query parameter is provided
    webp: !req.query.jpeg,
    // Apply grayscale if "bw" is not zero
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  try {
    // Fetch the remote image using fetch
    const response = await fetch(req.params.url);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch the image.');
    }

    // Get content type and content length from the response headers
    req.params.originType = response.headers.get('content-type');
    req.params.originSize =
      parseInt(response.headers.get('content-length'), 10) || 0;

    // Decide whether to compress based on the request parameters and image metadata
    if (shouldCompress(req)) {
      // If compression is needed, process the image stream
      compress(req, res, response.body);
    } else {
      // Otherwise, stream the original image using .on events on the response stream.
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);

      response.body.on('data', (chunk) => {
        res.write(chunk);
      });
      response.body.on('end', () => {
        res.end();
      });
      response.body.on('error', (error) => {
        console.error('Error streaming image:', error.message);
        res.status(500).end('Error streaming image.');
      });
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
