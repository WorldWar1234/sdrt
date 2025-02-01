// imageHandler.js
import { request } from 'undici';
import sharp from 'sharp';
import { pipeline } from 'stream/promises';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Maximum allowed height for resizing

/**
 * Determines whether the image should be compressed.
 *
 * @param {object} options
 * @param {string} options.originType - The content type of the original image.
 * @param {number} options.originSize - The size of the original image.
 * @param {boolean} options.webp - Whether the target output is WebP.
 * @param {string|undefined} rangeHeader - The incoming Range header.
 * @returns {boolean} True if the image should be compressed.
 */
function shouldCompress({ originType, originSize, webp }, rangeHeader) {
  if (!originType.startsWith('image')) return false;
  if (originSize === 0) return false;
  if (rangeHeader) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }
  return true;
}

/**
 * Compresses an image stream using Sharp and pipes the result to the response.
 *
 * @param {object} options
 * @param {NodeJS.ReadableStream} options.inputStream - The input image stream.
 * @param {number} options.originSize - The original size of the image.
 * @param {number} options.quality - The quality setting for compression.
 * @param {boolean} options.webp - Whether to output in WebP (otherwise JPEG).
 * @param {boolean} options.grayscale - Whether to convert the image to grayscale.
 * @param {object} res - The HTTP response object.
 */
async function compressImage({ inputStream, originSize, quality, webp, grayscale }, res) {
  // Disable Sharp caching and configure concurrency for predictable performance.
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);

  // Determine output format
  const format = webp ? 'webp' : 'jpeg';

  // Create a Sharp transformer instance
  const transformer = sharp({ unlimited: false, animated: false, limitInputPixels: false });
  // Pipe the input stream into the transformer
  inputStream.pipe(transformer);

  try {
    // Read metadata to check for dimensions
    const metadata = await transformer.metadata();
    if (metadata.height > MAX_HEIGHT) {
      transformer.resize({ height: MAX_HEIGHT });
    }
    if (grayscale) {
      transformer.grayscale();
    }

    // Set the Content-Type header for the response
    res.setHeader('Content-Type', `image/${format}`);

    // Begin formatting the image to the desired format
    const formatOptions = { quality, effort: 0 };
    const formattedStream = transformer.toFormat(format, formatOptions)
      .on('info', (info) => {
        // Set additional headers with compression info before any data is sent
        res.setHeader('X-Original-Size', originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', originSize - info.size);
      });

    // Pipe the processed image to the response, awaiting completion
    await pipeline(formattedStream, res);
  } catch (error) {
    console.error('Error during image compression:', error.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Failed to process image.');
    }
  }
}

/**
 * Fetches an image from a URL and either streams it directly or compresses it.
 *
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 */
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    res.statusCode = 400;
    return res.end('Image URL is required.');
  }

  // Extract and parse query parameters.
  const quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;
  const webp = !req.query.jpeg; // If the `jpeg` query param is not provided, default to WebP.
  const grayscale = req.query.bw != 0; // If bw is not 0, enable grayscale.

  let imageUrl;
  try {
    imageUrl = decodeURIComponent(url);
  } catch (error) {
    res.statusCode = 400;
    return res.end('Invalid image URL.');
  }

  try {
    // Fetch the image using undici.
    const { body, headers, statusCode } = await request(imageUrl);
    const originType = headers['content-type'];
    const originSize = parseInt(headers['content-length'], 10) || 0;

    if (statusCode >= 400) {
      res.statusCode = statusCode;
      return res.end('Failed to fetch the image.');
    }

    // Decide whether to compress the image based on its properties and the request.
    if (shouldCompress({ originType, originSize, webp }, req.headers.range)) {
      await compressImage({ inputStream: body, originSize, quality, webp, grayscale }, res);
    } else {
      // If no compression is needed, set the original headers and stream the image.
      res.setHeader('Content-Type', originType);
      res.setHeader('Content-Length', originSize);
      await pipeline(body, res);
    }
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.statusCode = 500;
    res.end('Failed to fetch the image.');
  }
}
