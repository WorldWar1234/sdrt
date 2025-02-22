import { Pool } from 'undici';
import sharp from 'sharp';
import { URL } from 'url';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;
const KEEPALIVE_TIMEOUT = 30_000;

// Create connection pools for different origins
const pools = new Map();

function getPool(origin) {
  if (!pools.has(origin)) {
    pools.set(origin, new Pool(origin, {
      connections: 12,
      keepAliveMaxTimeout: KEEPALIVE_TIMEOUT,
      pipelining: 6,
      bodyTimeout: 10_000,
    }));
  }
  return pools.get(origin);
}

// Compression decision logic
function shouldCompress({ originType, originSize, webp }) {
  if (!originType?.startsWith('image/')) return false;
  if (originSize === 0) return false;
  
  const isTransparent = originType.endsWith('png') || originType.endsWith('gif');
  const minSize = webp ? MIN_COMPRESS_LENGTH : MIN_TRANSPARENT_COMPRESS_LENGTH;
  
  return originSize > (isTransparent && !webp ? MIN_TRANSPARENT_COMPRESS_LENGTH : minSize);
}

// Stream processing pipeline
function createProcessingPipeline(res, { quality, grayscale }) {
  let processedBytes = 0;
  
  return sharp()
    .on('info', ({ size }) => {
      res.setHeader('X-Processed-Size', size);
      res.setHeader('X-Bytes-Saved', processedBytes - size);
    })
    .jpeg({
      quality: Math.min(100, quality),
      mozjpeg: true,
      optimizeScans: true
    })
    .grayscale(grayscale)
    .on('end', () => res.end());
}

// Main image handler
export async function imageHandler(req, res) {
  try {
    const url = new URL(decodeURIComponent(req.query.url));
    const pool = getPool(url.origin);
    
    const { statusCode, headers, body } = await pool.request({
      path: url.pathname + url.search,
      method: 'GET',
      headers: { accept: 'image/*' },
      throwOnError: false,
    });

    if (statusCode >= 300) {
      body.destroy();
      return res.status(statusCode).end();
    }

    const originType = headers['content-type'];
    const originSize = parseInt(headers['content-length'], 10) || 0;
    const webp = !req.query.jpeg;
    const grayscale = !!req.query.bw;
    const quality = Math.min(100, parseInt(req.query.l, 10) || DEFAULT_QUALITY);

    // Compression decision
    if (!shouldCompress({ originType, originSize, webp })) {
      res.setHeader('Content-Type', originType);
      res.setHeader('Content-Length', originSize);
      return body.pipe(res);
    }

    // Create processing pipeline
    const pipeline = createProcessingPipeline(res, { quality, grayscale });
    
    // Set headers
    res.setHeader('Content-Type', `image/jpeg`);
    res.setHeader('X-Original-Size', originSize);
    
    // Stream processing
    body
      .on('data', (chunk) => processedBytes += chunk.length)
      .pipe(pipeline)
      .pipe(res);

  } catch (error) {
    console.error(`[${Date.now()}] Error: ${error.message}`);
    res.status(500).json({ error: 'Image processing failed' });
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await Promise.all([...pools.values()].map(p => p.close()));
  process.exit(0);
});
