"use strict";

import http from "http";
import https from "https";
import sharp from "sharp";
import { availableParallelism } from 'os';
import pick from "./pick.js";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Helper: Should compress
function shouldCompress(ctx) {
  const { originType, originSize, webp } = ctx.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0) return false;
  if (ctx.headers.range) return false;
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
      target.setHeader(key, value);
    } catch (e) {
      console.log(e.message);
    }
  }
}

// Helper: Redirect
function redirect(ctx) {
  if (ctx.response.headersSent) return;

  ctx.set("content-length", 0);
  ctx.remove("cache-control");
  ctx.remove("expires");
  ctx.remove("date");
  ctx.remove("etag");
  ctx.set("location", encodeURI(ctx.params.url));
  ctx.status = 302;
  ctx.body = null;
}

// Helper: Compress
function compress(ctx, input) {
  const format = "jpeg";

  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(availableParallelism());

  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false,
  });

  input
    .pipe(
      sharpInstance
        .resize(null, 16383, {
          withoutEnlargement: true
        })
        .grayscale(ctx.params.grayscale)
        .toFormat(format, {
          quality: ctx.params.quality,
          chromaSubsampling: '4:4:4',
          effort: 0,
        })
        .on("error", () => redirect(ctx))
        .on("info", (info) => {
          if (ctx.response.headersSent) return;
          ctx.set("content-type", "image/" + format);
          ctx.set("content-length", info.size);
          ctx.set("x-original-size", ctx.params.originSize);
          ctx.set("x-bytes-saved", ctx.params.originSize - info.size);
          ctx.status = 200;
        })
    )
    .pipe(ctx.res);
}

// Main: Proxy middleware
async function proxy(ctx, next) {
  // Extract and validate parameters from the request
  let url = ctx.query.url;
  if (!url) return ctx.body = "bandwidth-hero-proxy";

  ctx.params = {};
  ctx.params.url = decodeURIComponent(url);
  ctx.params.webp = !ctx.query.jpeg;
  ctx.params.grayscale = ctx.query.bw != 0;
  ctx.params.quality = parseInt(ctx.query.l, 10) || DEFAULT_QUALITY;

  // Avoid loopback that could cause server hang.
  if (
    ctx.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(ctx.headers["x-forwarded-for"] || ctx.ip)
  ) {
    return redirect(ctx);
  }

  const parsedUrl = new URL(ctx.params.url);
  const options = {
    headers: {
      ...pick(ctx.headers, ["cookie", "dnt", "referer", "range"]),
      "user-agent": "Bandwidth-Hero Compressor",
      "x-forwarded-for": ctx.headers["x-forwarded-for"] || ctx.ip,
      via: "1.1 bandwidth-hero",
    },
    method: 'GET',
    rejectUnauthorized: false // Disable SSL verification
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

    // Set headers and stream response.
    copyHeaders(originRes, ctx.res);
    ctx.set("content-encoding", "identity");
    ctx.set("Access-Control-Allow-Origin", "*");
    ctx.set("Cross-Origin-Resource-Policy", "cross-origin");
    ctx.set("Cross-Origin-Embedder-Policy", "unsafe-none");
    ctx.params.originType = originRes.headers["content-type"] || "";
    ctx.params.originSize = originRes.headers["content-length"] || "0";

    if (shouldCompress(ctx)) {
      return compress(ctx, originRes);
    } else {
      ctx.set("x-proxy-bypass", 1);
      ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
        if (originRes.headers[header]) {
          ctx.set(header, originRes.headers[header]);
        }
      });
      return originRes.pipe(ctx.res);
    }
  });

  originReq.on('error', (err) => {
    if (err.code === 'ERR_INVALID_URL') {
      if (!ctx.response.headersSent) {
        ctx.status = 400;
        ctx.body = "Invalid URL";
      }
    } else {
      redirect(ctx);
    }
    console.error(err);
  });

  originReq.end();
}

export default proxy;
