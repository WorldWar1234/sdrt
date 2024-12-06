"use strict";

import http from "http";
import https from "https";
import sharp from "sharp";
import pick from "./pick.js";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

/**
 * Determines if image compression should be applied based on request parameters.
 * @param {http.IncomingMessage} req - The incoming HTTP request.
 * @returns {boolean} - Whether compression should be performed.
 */
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image") || originSize === 0 || req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith("png") || originType.endsWith("gif")) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }
  return true;
}

/**
 * Copies headers from source to target, logging errors if any.
 * @param {http.IncomingMessage} source - The source of headers.
 * @param {http.ServerResponse} target - The target for headers.
 */
function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.log(e.message);
    }
  }
}

/**
 * Redirects the request to the original URL with proper headers.
 * @param {http.IncomingMessage} req - The incoming HTTP request.
 * @param {http.ServerResponse} res - The HTTP response.
 */
function redirect(req, res) {
  if (res.headersSent) return; // If headers are already sent, we can't modify them

  // Set the status code and necessary headers for redirection
  res.writeHead(302, {
    Location: encodeURI(req.params.url),
    'Content-Length': '0' // No body in a redirect response
  });

  // Remove headers that might interfere with caching or freshness
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");

  // End the response, sending the headers
  res.end();
}

/**
 * Compresses and transforms the image according to request parameters.
 * @param {http.IncomingMessage} req - The incoming HTTP request.
 * @param {http.ServerResponse} res - The HTTP response.
 * @param {http.IncomingMessage} input - The input stream for image data.
 */
function compress(req, res, input) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp().resize({ height: 16383, withoutEnlargement: true })
    .grayscale(req.params.grayscale)
    .toFormat(format, { quality: req.params.quality, effort: 0 });

  sharpInstance.metadata().then((metadata) => {
    if (metadata.height > 16383) {
      sharpInstance.resize({ height: 16383, withoutEnlargement: true });
    }
  });

  let infoReceived = false;

  input.pipe(sharpInstance)
    .on("info", (info) => {
      infoReceived = true;
      res.writeHead(200, {
        'Content-Type': `image/${format}`,
        'Content-Length': info.size,
        'X-Original-Size': req.params.originSize,
        'X-Bytes-Saved': req.params.originSize - info.size
      });
    })
    .on("data", (chunk) => {
      if (!res.write(chunk)) {
        input.pause();
        res.once("drain", () => input.resume());
      }
    })
    .on("end", () => res.end())
    .on("error", (err) => {
      if (!res.headersSent && !infoReceived) {
        redirect(req, res);
      }
    });
}

/**
 * Main proxy handler for bandwidth optimization.
 * @param {http.IncomingMessage} req - The incoming HTTP request.
 * @param {http.ServerResponse} res - The HTTP response.
 */
function hhproxy(req, res) {
  let url = req.query.url;
  if (!url) return res.end("bandwidth-hero-proxy");

 // const cleanedUrl = url.replace(/http:\/\/1\.1\.\d{1,3}\.\d{1,3}\/bmi\//i, '');
  req.params = {
    url: url,
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY
  };

  if (req.headers["via"] === "1.1 bandwidth-hero" && 
      ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)) {
    return redirect(req, res);
  }

  const parsedUrl = new URL(req.params.url);
  const options = {
    headers: {
      ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
      "User-Agent": "Bandwidth-Hero Compressor",
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.ip,
      Via: "1.1 bandwidth-hero",
    },
    rejectUnauthorized: false
  };

  const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  try {
    const originReq = requestModule.request(parsedUrl, options, (originRes) => {
      if (originRes.statusCode >= 400 || (originRes.statusCode >= 300 && originRes.headers.location)) {
        originRes.resume();
        return redirect(req, res);
      }

      copyHeaders(originRes, res);
      res.setHeader("Content-Encoding", "identity");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

      req.params.originType = originRes.headers["content-type"] || "";
      req.params.originSize = parseInt(originRes.headers["content-length"] || "0");

      if (shouldCompress(req)) {
        compress(req, res, originRes);
      } else {
        res.setHeader("X-Proxy-Bypass", 1);
        ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
          if (originRes.headers[header]) {
            res.setHeader(header, originRes.headers[header]);
          }
        });
        originRes.pipe(res);
      }
    });

    originReq.on('error', _ => req.socket.destroy());

    originReq.end();
  } catch (err) {
    if (err.code === "ERR_INVALID_URL") return res.status(400).send("Invalid URL");

  /*
   * When there's a real error, Redirect then destroy the stream immediately.
   */
  redirect(req, res);
  console.error(err);

  }
}

export default hhproxy;
