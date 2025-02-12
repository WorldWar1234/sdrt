import got from 'got';
import sharp from 'sharp';
import http2wrapper from 'http2-wrapper';
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
async function compress(req, res, inputBuffer) {
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp(inputBuffer, { unlimited: false, animated: false, limitInputPixels: false });

  try {
    const metadata = await sharpInstance.metadata();
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }
    sharpInstance.sharpen(0.5);

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

    outputStream.pipe(res);
  } catch (err) {
    console.error('Error during image processing:', err.message);
    res.status(500).end('Failed to process the image.');
  }
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
    const response = await got(req.params.url, {
      timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false, // handle decompression manually
        http2: true,  // Enable HTTP/2
        request: http2wrapper.auto,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        // Explicitly set only the headers you need
      },
      hooks: {
        beforeRequest: [
          (options) => {
            // Pick only the headers you want to include
            const allowedHeaders = ['User-Agent', 'Accept', 'Accept-Language', 'Connection'];
            Object.keys(options.headers).forEach(key => {
              if (!allowedHeaders.includes(key)) {
                delete options.headers[key];
              }
            });
          }
        ]
      }
    });

    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    const buffer = response.body; // The response body is already a buffer

    if (shouldCompress(req)) {
      await compress(req, res, buffer);
    } else {
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      res.end(buffer);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
