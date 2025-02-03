import superagent from 'superagent';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed (unchanged)
function shouldCompress(req) {
  // ... keep existing implementation
}

// Modified compress function to handle stream errors
function compress(req, res, inputStream) {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  // Handle input stream errors
  inputStream.on('error', (err) => {
    console.error('Input stream error:', err);
    if (!res.headersSent) res.status(500).send('Image download failed');
    sharpInstance.destroy();
  });

  inputStream.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Set response headers
      res.setHeader('Content-Type', `image/${format}`);
      
      // Create processing pipeline
      const pipeline = sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        });

      // Handle pipeline errors
      pipeline.on('error', (err) => {
        console.error('Processing error:', err);
        if (!res.headersSent) res.status(500).send('Image processing failed');
        inputStream.destroy();
      });

      // Stream processed image to response
      pipeline.pipe(res);
    })
    .catch((err) => {
      console.error('Metadata error:', err);
      if (!res.headersSent) res.status(500).send('Image processing failed');
    });
}

// Modified fetch function using Superagent
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
    const { headers, statusCode, stream } = await new Promise((resolve, reject) => {
      const request = superagent.get(req.params.url)
        .buffer(false)
        .parse((res, callback) => {
          // Keep the stream flowing without buffering
          res.on('data', () => {});
          res.on('end', () => callback());
        })
        .on('response', (response) => {
          if (response.status >= 400) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          resolve({
            headers: response.headers,
            statusCode: response.status,
            stream: request
          });
        })
        .on('error', reject);
    });

    req.params.originType = headers['content-type'];
    req.params.originSize = parseInt(headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      compress(req, res, stream);
    } else {
      res.setHeader('Content-Type', req.params.originType);
      if (req.params.originSize > 0) {
        res.setHeader('Content-Length', req.params.originSize);
      }
      stream.pipe(res);
    }
  } catch (error) {
    console.error('Fetch error:', error.message);
    const statusCode = error.message.startsWith('HTTP ') 
      ? parseInt(error.message.split(' ')[1]) 
      : 500;
    res.status(statusCode).send('Failed to fetch image');
  }
}
