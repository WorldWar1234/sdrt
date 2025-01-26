import https from 'https';
import { Readable } from 'stream';
import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';
import imageminWebp from 'imagemin-webp';

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
  const format = req.params.webp ? 'webp' : (req.params.originType.endsWith('png') ? 'png' : 'jpeg');
  const plugins = req.params.webp ? [imageminWebp({ quality: req.params.quality })] :
    (format === 'png' ? [imageminPngquant({ quality: [req.params.quality / 10, req.params.quality / 10] })] :
    [imageminJpegtran({ quality: req.params.quality })]);

  try {
    const files = await imagemin.buffer(await streamToBuffer(inputStream), {
      plugins: plugins
    });

    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('X-Original-Size', req.params.originSize);
    res.setHeader('X-Processed-Size', files.length);
    res.setHeader('X-Bytes-Saved', req.params.originSize - files.length);
    res.end(files);
  } catch (err) {
    console.error('Error compressing image:', err.message);
    res.statusCode = 500;
    res.end('Failed to compress image.');
  }
}

// Helper function to convert a stream to a buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
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
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  https.get(req.params.url, (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Compress the stream
      compress(req, res, response);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res);
    }
  }).on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}
