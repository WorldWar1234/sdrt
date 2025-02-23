import { createClient } from "fetch-h2";
import sharp from "sharp";

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;

// Create HTTP/2 client with connection pooling
const client = createClient({
  session: {
    maxReservedRemoteStreams: 100, // Concurrent streams per connection
  },
});

// Compression decision logic
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType?.startsWith('image')) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) {
    return originSize >= MIN_TRANSPARENT_COMPRESS_LENGTH;
  }

  return true;
}

// Image processing pipeline
function compress(req, res, inputStream) {
  const format = 'jpeg';
  const transformer = sharp()
    .on('error', (err) => {
      console.error('Sharp processing error:', err);
      res.status(500).end();
    });

  inputStream.pipe(transformer);

  transformer.metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        transformer.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        transformer.grayscale();
      }

      res.setHeader('Content-Type', `image/${format}`);
      transformer
        .toFormat(format, {
          quality: req.params.quality,
          mozjpeg: true, // Better compression
          effort: 0, // Fastest processing
        })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Compressed-Size', info.size);
          res.setHeader('X-Compression-Ratio', 
            `${((1 - info.size/req.params.originSize) * 100).toFixed(1)}%`);
        })
        .pipe(res);
    })
    .catch((err) => {
      console.error('Metadata error:', err);
      res.status(500).send('Image processing failed');
    });
}

// Main request handler
export async function fetchImageAndHandle(req, res) {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'Missing image URL' });
    }

    const params = {
      url: decodeURIComponent(url),
      webp: !req.query.jpeg,
      grayscale: req.query.bw != 0,
      quality: Math.min(Math.max(parseInt(req.query.l, 10) || DEFAULT_QUALITY, 1), 100),
    };

    // Fetch image via HTTP/2
    const response = await client.fetch(params.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Image Compression Proxy/1.0',
      },
    });

    if (!response.ok) {
      return res.status(response.statusCode).send('Image fetch failed');
    }

    // Extract metadata
    params.originType = response.headers.get('content-type') || '';
    params.originSize = parseInt(response.headers.get('content-length'), 10) || 0;

    // Handle compression
    if (shouldCompress({ params, headers: req.headers })) {
      compress({ params }, res, response.body);
    } else {
      res.setHeader('Content-Type', params.originType);
      res.setHeader('Content-Length', params.originSize);
      response.body.pipe(res);
    }

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({
      error: 'Image processing failed',
      details: err.message
    });
  }
}
