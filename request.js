import https from 'https';
import sharp from 'sharp';
import imagemin from 'imagemin';
import imageminWebp from 'imagemin-webp';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';

const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Maximum allowed height
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Utility function to check if compression is needed
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

// Resize image height if it exceeds the maximum height
async function resizeImageIfNeeded(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  if (metadata.height > MAX_HEIGHT) {
    console.log(`Resizing image from height ${metadata.height} to ${MAX_HEIGHT}`);
    return await image.resize({ height: MAX_HEIGHT }).toBuffer();
  }

  return buffer;
}

// Function to compress an image buffer
async function compressBuffer(buffer, format, quality) {
  const plugins = [];

  if (format === 'webp') {
    plugins.push(imageminWebp({ quality }));
  } else if (format === 'jpeg') {
    plugins.push(imageminMozjpeg({ quality }));
  } else if (format === 'png') {
    plugins.push(imageminPngquant({ quality: [quality / 100, quality / 100] }));
  }

  return await imagemin.buffer(buffer, { plugins });
}

// Function to fetch and process the image
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  https.get(req.params.url, async (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      try {
        // Collect the stream into a buffer
        const buffer = await collectStreamToBuffer(response);

        // Resize the image if needed
        const resizedBuffer = await resizeImageIfNeeded(buffer);

        // Compress the resized image buffer
        const format = req.params.webp ? 'webp' : req.params.originType.split('/')[1];
        const compressedBuffer = await compressBuffer(resizedBuffer, format, req.params.quality);

        // Send the compressed image
        res.setHeader('Content-Type', `image/${format}`);
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', compressedBuffer.length);
        res.setHeader('X-Bytes-Saved', req.params.originSize - compressedBuffer.length);
        res.end(compressedBuffer);
      } catch (error) {
        console.error('Error during processing:', error.message);
        res.status(500).send('Failed to process the image.');
      }
    } else {
      // Stream the original image if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res).on('error', (err) => {
        console.error('Error streaming the image:', err.message);
        res.status(500).send('Failed to stream the image.');
      });
    }
  }).on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}

// Utility to collect stream into a buffer
async function collectStreamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
