import { request } from 'undici';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

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
 * Compresses an image stream using Sharp by writing the result to a temporary file,
 * then streaming that file to the response.
 *
 * @param {object} options
 * @param {NodeJS.ReadableStream} options.inputStream - The input image stream.
 * @param {number} options.originSize - The original image size.
 * @param {number} options.quality - The quality setting for compression.
 * @param {boolean} options.webp - Whether to output in WebP (otherwise JPEG).
 * @param {boolean} options.grayscale - Whether to convert the image to grayscale.
 * @param {object} res - The HTTP response object.
 */
async function compressImage({ inputStream, originSize, quality, webp, grayscale }, res) {
  // Disable Sharp caching and adjust concurrency.
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);

  // Determine the output format.
  const format = webp ? 'webp' : 'jpeg';

  // Create a Sharp transformer instance.
  const transformer = sharp({ unlimited: false, animated: false, limitInputPixels: false });
  inputStream.pipe(transformer);

  try {
    // Get metadata and adjust transformations as needed.
    const metadata = await transformer.metadata();
    if (metadata.height > MAX_HEIGHT) {
      transformer.resize({ height: MAX_HEIGHT });
    }
    if (grayscale) {
      transformer.grayscale();
    }

    // Prepare to format the output image.
    const formatOptions = { quality, effort: 0 };
    const formattedStream = transformer.toFormat(format, formatOptions);

    // Generate a temporary file path.
    const tmpFile = path.join(os.tmpdir(), `${randomUUID()}.${format}`);

    // Write the transformed output to the temporary file.
    const fileWriteStream = fs.createWriteStream(tmpFile);
    await pipeline(formattedStream, fileWriteStream);

    // Once the file is written, get its size.
    const stats = fs.statSync(tmpFile);

    // Set response headers before streaming the file.
    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('X-Original-Size', originSize);
    res.setHeader('X-Processed-Size', stats.size);
    res.setHeader('X-Bytes-Saved', originSize - stats.size);

    // Stream the file to the response.
    const fileReadStream = fs.createReadStream(tmpFile);
    await pipeline(fileReadStream, res);

    // Clean up the temporary file.
    fs.unlink(tmpFile, (err) => {
      if (err) {
        console.error('Error deleting temporary file:', err);
      }
    });
  } catch (error) {
    console.error('Error during image compression:', error.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Failed to process image.');
    }
  }
}

/**
 * Fetches an image from a URL and either streams it directly or compresses it
 * using temporary file storage for the compressed output.
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

  // Parse query parameters.
  const quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;
  const webp = !req.query.jpeg; // Default to WebP unless the "jpeg" query parameter is provided.
  const grayscale = req.query.bw != 0; // Convert to grayscale if bw is not 0.

  let imageUrl;
  try {
    imageUrl = decodeURIComponent(url);
  } catch (error) {
    res.statusCode = 400;
    return res.end('Invalid image URL.');
  }

  try {
    // Fetch the image.
    const { body, headers, statusCode } = await request(imageUrl);
    const originType = headers['content-type'];
    const originSize = parseInt(headers['content-length'], 10) || 0;

    if (statusCode >= 400) {
      res.statusCode = statusCode;
      return res.end('Failed to fetch the image.');
    }

    // Decide whether to compress the image.
    if (shouldCompress({ originType, originSize, webp }, req.headers.range)) {
      await compressImage({ inputStream: body, originSize, quality, webp, grayscale }, res);
    } else {
      // Stream the original image directly.
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
