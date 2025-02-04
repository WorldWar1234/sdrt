import axios from 'axios';
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

// Function to compress an image stream directly using Sharp
function compress(req, res, inputStream) {
  // Disable caching and set concurrency options for sharp
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

  // Read metadata to optionally adjust transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Set the response Content-Type header to the target format
      res.setHeader('Content-Type', `image/${format}`);

      // Convert the image to the desired format and stream the output
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .pipe(res)
        .on('error', (err) => {
          console.error('Error during image processing:', err.message);
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

// Function to handle image compression requests using axios
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // if "jpeg" is provided, do not convert to webp
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  try {
    // Fetch the image with axios configured to return a stream
    const response = await axios.get(req.params.url, { responseType: 'stream' });

    // Get the content type and length from response headers
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    // If the response status indicates an error, return it to the client
    if (response.status >= 400) {
      return res.status(response.status).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // If compression is needed, pass the response stream to Sharp for processing
      compress(req, res, response.data);
    } else {
      // Otherwise, set appropriate headers and pipe the original stream directly to the client
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
