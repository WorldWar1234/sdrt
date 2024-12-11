"use strict";


import http from "http";
import https from "https";
import sharp from "sharp";
import pick from "./pick.js";
import UserAgent from 'user-agents';

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
  const format = req.params.webp ? "webp" : "jpeg"; // Output format
  const quality = parseInt(req.params.quality, 10) || 80; // Image quality
  const grayscale = req.params.grayscale === "true"; // Grayscale toggle

  const sharpInstance = sharp().on("info", (info) => {
    res.setHeader("Content-Type", `image/${format}`);
    res.setHeader("Content-Length", info.size);
    if (req.params.originSize) {
      const originalSize = parseInt(req.params.originSize, 10);
      res.setHeader("X-Original-Size", originalSize);
      res.setHeader("X-Bytes-Saved", originalSize - info.size);
    }
    res.statusCode = 200;
  });

  sharpInstance.on("data", (chunk) => {
    if (!res.write(chunk)) {
      sharpInstance.pause();
      res.once("drain", () => sharpInstance.resume());
    }
  });

  sharpInstance.on("end", () => res.end());
  sharpInstance.on("error", (err) => {
    console.error("Error processing image:", err);
    res.status(500).send("Failed to process the image.");
  });

  input.on("data", (chunk) => sharpInstance.write(chunk));
  input.on("end", async () => {
    try {
      const metadata = await sharpInstance.metadata();
      if (metadata.height > 1683) {
        sharpInstance.resize({ height: 1683, width: null, withoutEnlargement: true });
      }
      sharpInstance.grayscale(grayscale).toFormat(format, { quality, effort: 0 }).end();
    } catch (err) {
      console.error("Error fetching metadata:", err);
      res.status(500).send("Failed to process the image.");
    }
  });

  input.on("error", (err) => {
    console.error("Error reading input stream:", err);
    res.status(400).send("Invalid input stream.");
  });
}


// 
function hhproxy(req, res) {
  // Extract and validate parameters from the request
  let url = req.query.url;
  if (!url) return res.end("ban");

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
    req.headers["via"] === "1.1 myapp-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  ) {
    return redirect(req, res);
  }

  const parsedUrl = new URL(req.params.url);
  const userAgent = new UserAgent();
  const options = {
    headers: {
      ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
      "user-agent": userAgent.toString(),
      "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
      via: "1.1 myapp-hero",
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
    console.error(err);
    redirect(req, res);
    
  }
}

export default hhproxy;
