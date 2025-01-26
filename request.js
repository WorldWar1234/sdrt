import https from 'https';
import Jimp from 'jimp';

const DEFAULT_QUALITY = 80;
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

// Function to compress the image buffer using Jimp
async function compressImage(buffer, format, quality) {
  const image = await Jimp.read(buffer);

  // Apply quality/compression based on format
  if (format === 'jpeg' || format === 'jpg') {
    image.quality(quality); // Set JPEG quality
  } else if (format === 'png') {
    image.deflateLevel(9); // Max compression for PNG
  }

  return await image.getBufferAsync(`image/${format}`);
}

// Function to handle image requests and compression
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  https.get(req.params.url, (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    if (shouldCompress(req)) {
      // Collect the incoming data chunks
      const chunks = [];
      response
        .on('data', (chunk) => chunks.push(chunk))
        .on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const format = 'jpeg' : req.params.originType.split('/')[1];

            // Compress the image
            const compressedBuffer = await compressImage(buffer, format, req.params.quality);

            // Send the compressed image
            res.setHeader('Content-Type', `image/${format}`);
            res.setHeader('X-Original-Size', req.params.originSize);
            res.setHeader('X-Processed-Size', compressedBuffer.length);
            res.setHeader('X-Bytes-Saved', req.params.originSize - compressedBuffer.length);
            res.end(compressedBuffer);
          } catch (error) {
            console.error('Error during compression:', error.message);
            res.status(500).send('Failed to compress the image.');
          }
        })
        .on('error', (error) => {
          console.error('Error fetching image:', error.message);
          res.status(500).send('Failed to fetch the image.');
        });
    } else {
      // Stream the original image directly if compression is not needed
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res);
    }
  }).on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}
