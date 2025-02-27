import axios from "axios";
import sharp from "sharp";

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
async function compress(req, res, inputStream) {
  sharp.cache(false);
  sharp.simd(true);
  const format = 'jpeg';
  const sharpInstance = sharp({ unlimited: true, animated: false, limitInputPixels: false });

  // Set headers for the compressed image
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('X-Original-Size', req.params.originSize);

  // Create a transform stream to handle the output
  const transformStream = sharpInstance
    .toFormat(format, { quality: req.params.quality, effort: 0 });

  // Handle the 'info' event to get the processed size
  transformStream.on('info', (info) => {
    res.setHeader('X-Processed-Size', info.size);
    res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
  });

  // Handle errors during processing
  transformStream.on('error', (err) => {
    console.error('Error processing image:', err.message);
    res.status(500).send('Failed to process image.');
  });

  // Pipe the input stream to the transform stream
  inputStream.pipe(transformStream).pipe(res);

  

  // Handle any errors from the input stream
  inputStream.on('error', (err) => {
    console.error('Error reading input stream:', err.message);
    res.status(500).send('Failed to read input stream.');
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
    // Fetch the image using axios
    const response = await axios({
      method: 'get',
      url: req.params.url,
      responseType: 'stream'
    });

    if (response.status !== 200) {
      return res.status(response.status).send('Failed to fetch the image.');
    }

    // Extract headers
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      // Compress the stream
      compress(req, res, response.data);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
                           }
