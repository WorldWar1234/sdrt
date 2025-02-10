import axios from 'axios';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;
const ANONYMOUS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Security headers configuration
const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// Configure axios for anonymous requests
const axiosInstance = axios.create({
  headers: {
    'User-Agent': ANONYMOUS_UA,
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Encoding': 'identity',
  },
  maxRedirects: 2,
  timeout: 10000,
});

// Simplified compression check
function shouldCompress({ originType, originSize, webp }) {
  if (!originType?.startsWith('image') || originSize === 0) return false;
  const minSize = webp ? MIN_COMPRESS_LENGTH : MIN_TRANSPARENT_COMPRESS_LENGTH;
  return originSize >= minSize;
}

// Optimized compression pipeline
async function compress(req, res, inputStream) {
  try {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const transformer = sharp()
      .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
      .grayscale(req.params.grayscale)
      .toFormat(format, {
        quality: req.params.quality,
        effort: 4,
        smartSubsample: true,
      });

    // Set security headers
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    inputStream
      .pipe(transformer)
      .on('info', (info) => {
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
      })
      .pipe(res);
  } catch (err) {
    console.error(`Processing error: ${err.message}`);
    res.status(500).end('Image processing failed');
  }
}

// Main handler with improved error handling
export async function fetchImageAndHandle(req, res) {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('URL parameter required');

    const params = {
      url: decodeURIComponent(url),
      webp: !req.query.jpeg,
      grayscale: !req.query.bw,
      quality: Math.min(Math.max(parseInt(req.query.l, 10) || DEFAULT_QUALITY, 10), 100),
    };

    const response = await axiosInstance.get(params.url, { 
      responseType: 'stream',
      validateStatus: (status) => status >= 200 && status < 400
    });

    params.originType = response.headers['content-type'];
    params.originSize = parseInt(response.headers['content-length'], 10) || 0;

    if (shouldCompress(params)) {
      await compress({ params }, res, response.data);
    } else {
      res.setHeader('Content-Type', params.originType);
      res.setHeader('Content-Length', params.originSize);
      response.data.pipe(res);
    }
  } catch (error) {
    console.error(`Fetch error: ${error.message}`);
    const status = error.response?.status || 500;
    res.status(status).send(status === 404 ? 'Image not found' : 'Processing error');
  }
}
