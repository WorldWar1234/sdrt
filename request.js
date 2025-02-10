import axios from 'axios';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value
const REQUEST_TIMEOUT = 10000; // 10 seconds timeout for axios requests

// Generic User-Agent to mimic a browser request
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Utility function to determine if compression is needed
function shouldCompress({ originType, originSize, webp }) {
  if (!originType?.startsWith('image') || originSize === 0) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }
  return true;
}

// Function to compress an image stream directly using Sharp
async function compress(req, res, inputStream) {
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  try {
    const metadata = await sharpInstance.metadata();
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }

    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache the response for 1 year
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing

    const outputStream = sharpInstance
      .toFormat(format, { quality: req.params.quality, effort: 0 })
      .on('info', (info) => {
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
      });

    inputStream.pipe(sharpInstance).pipe(res);
  } catch (err) {
    console.error('Error during image processing:', err.message);
    res.status(500).end('Failed to process the image.');
  }
}

// Function to handle image compression requests using axios
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send('Image URL is required.');

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // if "jpeg" is provided, do not convert to webp
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  try {
    // Fetch the image with axios using a generic user-agent and timeout
    const response = await axios.get(req.params.url, {
      responseType: 'stream',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': USER_AGENT, // Use a generic user-agent
        'Accept': 'image/*', // Accept only image types
        'Referer': new URL(req.params.url).origin, // Add referer header to mimic browser behavior
      },
    });

    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.status >= 400) {
      return res.status(response.status).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      await compress(req, res, response.data);
    } else {
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache the response for 1 year
      res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing
      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    if (error.code === 'ECONNABORTED') {
      res.status(504).send('Request timed out.'); // Handle timeout errors
    } else {
      res.status(500).send('Failed to fetch the image.');
    }
  }
}
