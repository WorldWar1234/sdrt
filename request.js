import fetch from 'node-fetch';
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

// Function to handle image compression requests using node-fetch
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send('Image URL is required.');

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // if "jpeg" is provided, do not convert to webp
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  fetch(req.params.url)
    .then(origin => {
        if (!origin.ok) {
            throw err;
        }

        req.params.originType = origin.headers.get('content-type') || '';
        res.setHeader('content-encoding', 'identity');

        if (shouldCompress(req)) {
            compress(req, res, origin.body);
        } else {
     res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      origin.body.pipe(res);
        }
    })
    .catch(err => {
        console.error('Proxy error:', err);
        res.status(500).send('Internal Server Error');
    });
}
