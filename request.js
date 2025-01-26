import https from 'https';
import sharp from 'sharp';
import imageminWebp from 'imagemin-webp';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';
import imagemin from 'imagemin';

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

// Function to set up a compression stream
function createCompressionStream(format, quality) {
  if (format === 'webp') {
    return sharp().webp({ quality });
  } else if (format === 'jpeg') {
    return sharp().jpeg({ quality });
  } else if (format === 'png') {
    return sharp().png({ quality });
  }
  throw new Error('Unsupported image format');
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

  https.get(req.params.url, (response) => {
    req.params.originType = response.headers['content-type'];
    req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send('Failed to fetch the image.');
    }

    const format = req.params.webp ? 'webp' : req.params.originType.split('/')[1];

    if (shouldCompress(req)) {
      try {
        // Set up the sharp transformation pipeline
        let transformer = sharp()
          .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
          .on('error', (error) => {
            console.error('Error during resizing:', error.message);
            res.status(500).send('Failed to resize the image.');
          });

        // Add compression
        transformer = transformer.pipe(createCompressionStream(format, req.params.quality));

        // Configure response headers
        res.setHeader('Content-Type', `image/${format}`);

        // Pipe the original image stream into the transformer and then to the response
        response
          .pipe(transformer)
          .pipe(res)
          .on('error', (error) => {
            console.error('Error during streaming:', error.message);
            res.status(500).send('Failed to stream the image.');
          });
      } catch (error) {
        console.error('Error during processing:', error.message);
        res.status(500).send('Failed to process the image.');
      }
    } else {
      // Stream the original image directly
      res.setHeader('Content-Type', req.params.originType);
      res.setHeader('Content-Length', req.params.originSize);
      response.pipe(res).on('error', (error) => {
        console.error('Error streaming the image:', error.message);
        res.status(500).send('Failed to stream the image.');
      });
    }
  }).on('error', (error) => {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  });
}
