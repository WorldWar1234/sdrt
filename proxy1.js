"use strict";
import { request } from "undici";
import pick from "./pick.js";
import sharp from "sharp";
import UserAgent from "user-agents";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.error(`Error copying header ${key}:`, e.message);
    }
  }
}

function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0 || req.headers.range) return false;
  
  // Only compress PNG/GIF if large enough or webp is requested
  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  // Compress webp images only if above the minimum size threshold
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;

  return true;
}

function redirect(req, res) {
  if (res.headersSent) return;

  res.setHeader("content-length", 0);
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");
  res.setHeader("location", encodeURI(req.params.url));
  res.statusCode = 302;
  res.end();
}

function sharpStream() {
  return sharp({ animated: false, unlimited: true });
}

async function compress(req, res, input) {
  const format = "webp";
  const quality = req.params.quality || DEFAULT_QUALITY;

  // Disable sharp cache and enable SIMD for speed
  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(4); // Limit concurrency for optimal performance

  const transform = sharpStream();
  input.body.pipe(transform);

  try {
    const metadata = await transform.metadata();

    // Conditional resizing based on image height
    if (metadata.height > 16383) {
      console.log('Resizing image to height limit of 16383px');
      transform.resize({ height: 16383 });
    }

    // Apply grayscale if requested
    if (req.params.grayscale) {
      transform.grayscale();
    }

    // Optimize WebP options for compression
    const webpOptions = {
      quality: quality,
      lossless: false, // Use lossy for faster compression
      effort: 0, // Balance compression speed and quality
      smartSubsample: true, // Use smarter chroma subsampling
      alphaQuality: 70, // Specific for transparency handling in WebP
    };

    transform.toFormat(format, webpOptions);

    transform.on('info', (info) => {
      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Content-Length', info.size);
      res.setHeader('X-Original-Size', req.params.originSize);
      res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
    });

    transform.on('error', (err) => {
      console.error('Compression error:', err.message);
      redirect(req, res);
    });

    // Stream the transformed image to the response
    transform.pipe(res, { end: true });

  } catch (err) {
    console.error('Metadata error:', err.message);
    redirect(req, res);
  }
}

async function hhproxy(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.send("bandwidth-hero-proxy");
  }

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  const userAgent = new UserAgent();
  const options = {
    headers: {
      ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
      "User-Agent": userAgent.toString(),
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.ip,
      Via: "1.1 bandwidth-hero",
    },
    maxRedirects: 4,
    timeout: 5000, // Add a timeout to avoid hanging requests
  };

  try {
    const origin = await request(req.params.url, options);
    _onRequestResponse(origin, req, res);
  } catch (err) {
    _onRequestError(req, res, err);
  }
}

function _onRequestError(req, res, err) {
  if (err.code === "ERR_INVALID_URL") {
    res.statusCode = 400;
    return res.end("Invalid URL");
  }

  // Redirect for other errors
  redirect(req, res);
  console.error("Request Error:", err);
}

function _onRequestResponse(origin, req, res) {
  if (origin.statusCode >= 400) {
    return redirect(req, res);
  }

  if (origin.statusCode >= 300 && origin.headers.location) {
    req.params.url = origin.headers.location;
    return redirect(req, res);
  }

  copyHeaders(origin, res);

  res.setHeader("Content-Encoding", "identity");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

  req.params.originType = origin.headers["content-type"] || "";
  req.params.originSize = parseInt(origin.headers["content-length"] || "0", 10);

  origin.body.on("error", () => req.socket.destroy());

  if (shouldCompress(req)) {
    return compress(req, res, origin);
  } else {
    res.setHeader("X-Proxy-Bypass", 1);

    // Forward relevant headers
    ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
      if (origin.headers[header]) {
        res.setHeader(header, origin.headers[header]);
      }
    });

    return origin.body.pipe(res);
  }
}

export default hhproxy;
