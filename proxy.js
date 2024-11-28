import http from 'http';
import https from 'https';
import sharp from 'sharp';
import { availableParallelism } from 'os';
import pick from './pick.js';

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Helper: Should compress
function shouldCompress(ctx) {
  const { originType, originSize, webp } = ctx.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0) return false;
  if (ctx.request.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Helper: Copy headers
function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.set(key, value);
    } catch (e) {
      console.log(e.message);
    }
  }
}

// Helper: Redirect
function redirect(ctx) {
  const { response, request } = ctx;
  if (response.headersSent) return;

  response.set('content-length', 0);
  response.remove('cache-control');
  response.remove('expires');
  response.remove('date');
  response.remove('etag');
  response.set('location', encodeURI(request.query.url));
  response.status = 302;
  response.end();
}

// Helper: Compress using stream
function compress(ctx, originRes) {
  const format = 'jpeg';

  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(availableParallelism());

  const sharpInstance = sharp({
    unlimited: true,
    failOn: 'none',
    limitInputPixels: false,
  });

  originRes
    .pipe(
      sharpInstance
        .resize(null, 16383, { withoutEnlargement: true })
        .grayscale(ctx.request.query.bw !== '0')
        .toFormat(format, {
          quality: ctx.request.query.l || DEFAULT_QUALITY,
          chromaSubsampling: '4:4:4',
          effort: 0,
        })
        .on('error', () => redirect(ctx)) // Redirect on sharp error
        .on('info', (info) => {
          // On successful processing, set the response headers
          ctx.response.set('content-type', `image/${format}`);
          ctx.response.set('content-length', info.size);
          ctx.response.set('x-original-size', ctx.params.originSize);
          ctx.response.set('x-bytes-saved', ctx.params.originSize - info.size);
          ctx.response.status = 200;
        })
    )
    .pipe(ctx.response);  // Pipe the stream directly to the Koa response
}

// Main: Proxy handler
async function proxy(ctx) {
  let url = ctx.request.query.url;
  if (!url) {
    ctx.body = 'bandwidth-hero-proxy';
    return;
  }

  ctx.params = {};
  ctx.params.url = decodeURIComponent(url);
  ctx.params.webp = !ctx.request.query.jpeg;
  ctx.params.grayscale = ctx.request.query.bw !== '0';
  ctx.params.quality = parseInt(ctx.request.query.l, 10) || DEFAULT_QUALITY;

  // Avoid loopback that could cause server hang.
  if (
    ctx.request.headers['via'] === '1.1 bandwidth-hero' &&
    ['127.0.0.1', '::1'].includes(ctx.request.ip)
  ) {
    return redirect(ctx);
  }

  const parsedUrl = new URL(ctx.params.url);
  const options = {
    headers: {
      ...pick(ctx.request.headers, ['cookie', 'dnt', 'referer', 'range']),
      'user-agent': 'Bandwidth-Hero Compressor',
      'x-forwarded-for': ctx.request.ip,
      via: '1.1 bandwidth-hero',
    },
    method: 'GET',
    rejectUnauthorized: false, // Disable SSL verification
  };

  const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  const originReq = requestModule.request(parsedUrl, options, (originRes) => {
    // Handle non-2xx or redirect responses.
    if (
      originRes.statusCode >= 400 ||
      (originRes.statusCode >= 300 && originRes.headers.location)
    ) {
      return redirect(ctx);
    }

    // Set headers and stream response
    copyHeaders(originRes, ctx.response);
    ctx.response.set('content-encoding', 'identity');
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.set('Cross-Origin-Resource-Policy', 'cross-origin');
    ctx.response.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    ctx.params.originType = originRes.headers['content-type'] || '';
    ctx.params.originSize = originRes.headers['content-length'] || '0';

    if (shouldCompress(ctx)) {
      return compress(ctx, originRes);
    } else {
      ctx.response.set('x-proxy-bypass', 1);
      ['accept-ranges', 'content-type', 'content-length', 'content-range'].forEach((header) => {
        if (originRes.headers[header]) {
          ctx.response.set(header, originRes.headers[header]);
        }
      });
      return originRes.pipe(ctx.response);
    }
  });

  originReq.on('error', (err) => {
    if (err.code === 'ERR_INVALID_URL') {
      ctx.response.status = 400;
      ctx.body = 'Invalid URL';
      return;
    }
    redirect(ctx);
    console.error(err);
  });

  originReq.end();
}

export default proxy;
