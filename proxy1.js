"use strict";

/*
 * proxy.js
 * The bandwidth hero proxy handler with integrated modules.
 */
import http from "http";
import https from "https";
import sharp from "sharp";
import pick from "./pick.js";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Helper: Should compress
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
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

// Helper: Compress
function compress(req, res, input) {
  const format = "jpeg";

  sharp.cache(false);
  sharp.simd(false);
  sharp.concurrency(1);

  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false,
  });

  const transform = sharpInstance
    .resize(null, 16383, {
      withoutEnlargement: true
    })
    .grayscale(req.params.grayscale)
    .toFormat(format, {
      quality: req.params.quality,
      effort: 0
    });

  input
    .pipe(transform)
    .on("error", () => {
          if (!res.headersSent || !info) {
            redirect(req, res);
          }
        })
    .on("info", (info) => {
          res.setHeader("content-type", "image/" + format);
          res.setHeader("content-length", info.size);
          res.setHeader("x-original-size", req.params.originSize);
          res.setHeader("x-bytes-saved", req.params.originSize - info.size);
          res.statusCode = 200;
        })
    .on('data', (chunk) => {
      if (!res.write(chunk)) {
        input.pause();
        res.once('drain', () => {
          input.resume();
        });
      }
    })
    .on('end', () => {
      res.end();
    })
    
}



// Main: Proxy
function hhproxy(req, res) {
  // Extract and validate parameters from the request
  let url = req.query.url;
  if (!url) return res.end("bandwidth-hero-proxy");

  // Replace the URL pattern
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Set request parameters
  req.params = {};
  req.params.url = url;
  req.params.webp = !req.query.jpeg;
  req.params.grayscale = req.query.bw != 0;
  req.params.quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;

  // Avoid loopback that could cause server hang.
  if (
    req.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  ) {
    return redirect(req, res);
  }

  const parsedUrl = new URL(req.params.url);
  const options = {
    headers: {
      ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
      "user-agent": "Bandwidth-Hero Compressor",
      "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
      via: "1.1 bandwidth-hero",
    },
    method: 'GET',
    rejectUnauthorized: false // Disable SSL verification
  };

const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  try {
    let originReq = requestModule.request(parsedUrl, options, (originRes) => {
      // Handle non-2xx or redirect responses.
      if (
        originRes.statusCode >= 400 ||
        (originRes.statusCode >= 300 && originRes.headers.location)
      ) {
        return redirect(req, res);
      }

      // Set headers and stream response.
      copyHeaders(originRes, res);
      res.setHeader("content-encoding", "identity");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
      req.params.originType = originRes.headers["content-type"] || "";
      req.params.originSize = originRes.headers["content-length"] || "0";

      if (shouldCompress(req)) {
        return compress(req, res, originRes);
      } else {
        res.setHeader("x-proxy-bypass", 1);
        ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
          if (originRes.headers[header]) {
            res.setHeader(header, originRes.headers[header]);
          }
        });

        // Use res.write for bypass
        originRes.on('data', (chunk) => {
          res.write(chunk);
        });

        originRes.on('end', () => {
          res.end();
        });
      }
    });
    originReq.end();
  } catch (err) {
    if (err.code === 'ERR_INVALID_URL') {
      return res.statusCode = 400, res.end("Invalid URL");
    }
    //console.error(err);
    redirect(req, res);
    
  }
}

export default hhproxy;
