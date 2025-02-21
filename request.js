import got from 'got';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

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
  const sharpInstance = sharp().resize({ height: MAX_HEIGHT }).grayscale(req.params.grayscale);

  res.setHeader('Content-Type', `image/${format}`);

  inputStream
    .pipe(sharpInstance.toFormat(format, { quality: req.params.quality, effort: 0 }))
    .on('info', (info) => {
      res.setHeader('X-Original-Size', req.params.originSize);
      res.setHeader('X-Processed-Size', info.size);
      res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
    })
    .pipe(res);
}

// Function to handle image compression requests using got
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
    const responseStream = got.stream(req.params.url);
    let headersSet = false;

    responseStream.on('response', (response) => {
      req.params.originType = response.headers['content-type'];
      req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

      if (!shouldCompress(req)) {
        res.setHeader('Content-Type', req.params.originType);
        res.setHeader('Content-Length', req.params.originSize);
        responseStream.pipe(res);
      } else {
        compress(req, res, responseStream);
      }
    });

    responseStream.on('error', (error) => {
      console.error('Error fetching image:', error.message);
      res.status(500).send('Failed to fetch the image.');
    });
  } catch (error) {
    console.error('Error initiating image fetch:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
