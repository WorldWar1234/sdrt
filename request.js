import { request } from 'undici';
import sharp from 'sharp';
import { PassThrough } from 'stream';

// Constants (now mandatory)
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;
const CACHE_TTL = 3600; // 1 hour cache

// Cache storage
const cache = new Map();

// Utility function remains the same
function shouldCompress(req) { /* ... */ }

// Modified compress function to work with output streams
async function compress(req, inputStream, outputStream) {
  try {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const sharpInstance = sharp({ unlimited: false, animated: false })
      .on('error', (err) => {
        console.error('Sharp error:', err);
        outputStream.emit('error', err);
      });

    // Pipe input to Sharp
    inputStream.pipe(sharpInstance);

    // Handle metadata
    const metadata = await sharpInstance.metadata();
    
    // Apply transformations
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }
    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    // Configure output
    sharpInstance
      .toFormat(format, { 
        quality: req.params.quality,
        effort: 0 
      })
      .on('info', (info) => {
        // Attach headers to output stream
        outputStream.headers = {
          'Content-Type': `image/${format}`,
          'X-Original-Size': req.params.originSize,
          'X-Processed-Size': info.size,
          'X-Bytes-Saved': req.params.originSize - info.size,
          'Cache-Control': `public, max-age=${CACHE_TTL}`
        };
      })
      .pipe(outputStream);

  } catch (err) {
    console.error('Compression failed:', err);
    outputStream.emit('error', err);
  }
}

// Main handler with proper caching
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;

    // Validate URL
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  // Decode and validate the URL to prevent SSRF
  let decodedUrl;
  try {
    decodedUrl = new URL(decodeURIComponent(url));
    if (!['http:', 'https:'].includes(decodedUrl.protocol)) {
      return res.status(400).send('Invalid URL protocol.');
    }
  } catch (err) {
    return res.status(400).send('Invalid URL.');
  }

  // Set request parameters
  req.params = {
    url: decodedUrl.toString(),
    webp: !req.query.jpeg,
    grayscale: req.query.bw !== '0',
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };
  // Create unique cache key
  const cacheKey = JSON.stringify({
    url: req.params.url,
    webp: req.params.webp,
    grayscale: req.params.grayscale,
    quality: req.params.quality
  });

  // Serve from cache if available
  if (cache.has(cacheKey)) {
    const { headers, body } = cache.get(cacheKey);
    res.writeHead(200, headers);
    return res.end(body);
  }

  try {
    const { body, headers, statusCode } = await request(req.params.url);

    // Handle failed origin fetch
    if (statusCode >= 400) {
      return res.status(statusCode).send('Origin fetch failed');
    }

    req.params.originType = headers['content-type'];
    req.params.originSize = parseInt(headers['content-length'], 10) || 0;

    if (shouldCompress(req)) {
      // Create processing pipeline
      const processedOutput = new PassThrough();
      const chunks = [];

      // Capture compressed output
      processedOutput
        .on('data', chunk => chunks.push(chunk))
        .on('end', () => {
          cache.set(cacheKey, {
            headers: processedOutput.headers || {},
            body: Buffer.concat(chunks)
          });
        });

      // Start compression and pipe to response
      await compress(req, body, processedOutput);
      
      // Set headers and pipe to client
      processedOutput
        .on('headers', (headers) => {
          res.writeHead(200, headers);
        })
        .pipe(res);

    } else {
      // Handle non-compressed path
      const chunks = [];
      body
        .on('data', chunk => chunks.push(chunk))
        .on('end', () => {
          const buffer = Buffer.concat(chunks);
          cache.set(cacheKey, {
            headers: {
              'Content-Type': req.params.originType,
              'Content-Length': buffer.length,
              'Cache-Control': `public, max-age=${CACHE_TTL}`
            },
            body: buffer
          });
          res.writeHead(200, cache.get(cacheKey).headers);
          res.end(buffer);
        });
    }

  } catch (error) {
    console.error('Request failed:', error);
    res.status(500).send('Image processing error');
  }
            }
