import fetch from 'node-fetch';
import sharp from 'sharp';
import { pipeline } from 'stream';
import { promisify } from 'util';
sharp.cache(false);
sharp.simd(true);
sharp.concurrency(1);
const pipelineAsync = promisify(pipeline);

// Constant
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  return originType.startsWith('image') &&
         originSize > 0 &&
         !req.headers.range &&
         !(webp && originSize < MIN_COMPRESS_LENGTH) &&
         !(!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH);
}

// Function to handle image compression requests
export async function fetchImageAndHandle(req, reply) {
  const url = req.query.url;
  if (!url) {
    return reply.status(400).send('Image URL is required.');
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  try {
    // Fetch the image using node-fetch
    const response = await fetch(req.params.url);

    if (!response.ok) {
      return reply.status(response.status).send('Failed to fetch the image.');
    }

    // Extract headers
    req.params.originType = response.headers.get('content-type');
    req.params.originSize = parseInt(response.headers.get('content-length'), 10) || 0;

    if (shouldCompress(req)) {
      // Create a Sharp instance for processing
      const sharpInstance = sharp()
        .toFormat('jpeg', { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          reply.header('Content-Type', `image/jpeg`);
          reply.header('X-Original-Size', req.params.originSize);
          reply.header('X-Processed-Size', info.size);
          reply.header('X-Bytes-Saved', req.params.originSize - info.size);
        });

      // Stream the response body through Sharp and then to the reply
      await pipelineAsync(response.body, sharpInstance, reply.raw);
    } else {
      // Stream the original image directly to the reply
      reply.header('Content-Type', req.params.originType);
      reply.header('Content-Length', req.params.originSize);
      await pipelineAsync(response.body, reply.raw);
    }
  } catch (error) {
    console.error('Error fetching or processing image:', error.message);
    reply.status(500).send('Failed to fetch or process the image.');
  }
}
