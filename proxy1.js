"use strict";

import http from "http";
import https from "https";
import sharp from "sharp";
import pick from "./pick.js";
import UserAgent from 'user-agents';

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith("png") || originType.endsWith("gif")) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }

  return true;
}

function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.error(`Error setting header ${key}:`, e.message);
    }
  }
}

function redirect(req, res) {
  if (res.headersSent) return;

  res.setHeader("content-length", "0");
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");
  res.setHeader("location", encodeURI(req.params.url));
  res.statusCode = 302;
  res.end();
}

function compress(req, res, input) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false
  }).cache(false).simd(false).concurrency(1);

  sharpInstance
    .metadata()
    .then(metadata => {
      if (metadata.height > 16383) {
        sharpInstance.resize({
          width: null,
          height: 16383,
          withoutEnlargement: true
        });
      }
      return sharpInstance
        .grayscale(req.params.grayscale)
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on("info", info => {
          res.setHeader("content-type", `image/${format}`);
          res.setHeader("content-length", info.size);
          res.setHeader("x-original-size", req.params.originSize);
          res.setHeader("x-bytes-saved", req.params.originSize - info.size);
          res.statusCode = 200;
        });
    })
    .then(() => input.pipe(sharpInstance))
    .then(sharpStream => {
      sharpStream.on("data", chunk => res.write(chunk));
      sharpStream.on("end", () => res.end());
      sharpStream.on("error", () => redirect(req, res));
    })
    .catch(err => {
      console.error('Error during compression:', err);
      redirect(req, res);
    });
}

function hhproxy(req, res) {
  let url = req.query.url;
  if (!url) return res.end("ban");

  // Normalize the URL
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  req.params = {
    url,
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY
  };

  // Avoid loopback
  if (req.headers["via"] === "1.1 myapp-hero" && ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)) {
    return redirect(req, res);
  }

  const parsedUrl = new URL(url);
  const userAgent = new UserAgent();
  const options = {
    headers: {
      ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
      "user-agent": userAgent.toString(),
      "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
      "via": "1.1 myapp-hero",
    },
    method: 'GET'
    // Consider removing `rejectUnauthorized: false` for better security unless testing
  };

  const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  try {
    const originReq = requestModule.request(parsedUrl, options, originRes => {
      if (originRes.statusCode >= 400 || (originRes.statusCode >= 300 && originRes.headers.location)) {
        return redirect(req, res);
      }

      copyHeaders(originRes, res);
      res.setHeader("content-encoding", "identity");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

      req.params.originType = originRes.headers["content-type"] || "";
      req.params.originSize = parseInt(originRes.headers["content-length"] || "0", 10);

      if (shouldCompress(req)) {
        compress(req, res, originRes);
      } else {
        res.setHeader("x-proxy-bypass", "1");
        ["accept-ranges", "content-type", "content-length", "content-range"].forEach(header => {
          if (originRes.headers[header]) {
            res.setHeader(header, originRes.headers[header]);
          }
        });
        originRes.pipe(res);
      }
    });

    originReq.on('error', err => {
      console.error('Request error:', err);
      redirect(req, res);
    });
    originReq.end();
  } catch (err) {
    if (err.code === 'ERR_INVALID_URL') {
      res.statusCode = 400;
      return res.end("Invalid URL");
    }
    console.error('Proxy error:', err);
    redirect(req, res);
  }
}

export default hhproxy;
