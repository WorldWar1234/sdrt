"use strict";

//import { pipeline } from 'stream';
import http from "http";
import https from "https";
import sharp from "sharp";
import pick from "./pick.js";
import UserAgent from 'user-agents';

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
sharp.cache(false);
sharp.simd(true);

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
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({
    failOn: "none",
    limitInputPixels: false,
  });

  // Error handling for the input stream
  input.on("error", () => redirect(req, res));

  // Write chunks to the sharp instance
  input.on("data", (chunk) => sharpInstance.write(chunk));

  // Process the image after the input stream ends
  input.on("end", () => {
    sharpInstance.end();

    // Get metadata and apply transformations
    sharpInstance
      .metadata()
      .then((metadata) => {
        if (metadata.height > 16383) {
          sharpInstance.resize({
            height: 16383,
            withoutEnlargement: true,
          });
        }

        sharpInstance
          .grayscale(req.params.grayscale)
          .toFormat(format, {
            quality: req.params.quality,
            effort: 0,
          });

        setupResponseHeaders(sharpInstance, res, format, req.params.originSize);
        streamToResponse(sharpInstance, res);
      })
      .catch(() => redirect(req, res));
  });
}

// Helper to set up response headers
function setupResponseHeaders(sharpInstance, res, format, originSize) {
  sharpInstance.on("info", (info) => {
    res.setHeader("Content-Type", `image/${format}`);
    res.setHeader("Content-Length", info.size);
    res.setHeader("X-Original-Size", originSize);
    res.setHeader("X-Bytes-Saved", originSize - info.size);
    res.statusCode = 200;
  });
}

// Helper to handle streaming data to the response
function streamToResponse(sharpInstance, res) {
  sharpInstance.on("data", (chunk) => {
    if (!res.write(chunk)) {
      sharpInstance.pause();
      res.once("drain", () => sharpInstance.resume());
    }
  });

  sharpInstance.on("end", () => res.end());
  sharpInstance.on("error", () => redirect(req, res));
}








// 
function hhproxy(req, res) {
  // Extract and validate parameters from the request
  let url = req.query.url;
  if (!url) return res.end("ban");

  // Replace the URL pattern
  //url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Set request parameters
  req.params = {};
  req.params.url = decodeURIComponent(url);
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

const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  try {
    let origin = await requestModule.request(req.params.url, {
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": userAgent.toString(),
        "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
        via: "1.1 bandwidth-hero",
      },
      maxRedirections: 4
    });
    _onRequestResponse(origin, req, res);
    origin.end();
  } catch (err) {
    _onRequestError(req, res, err);
  }
}

function _onRequestError(req, res, err) {
  // Ignore invalid URL.
  if (err.code === "ERR_INVALID_URL") return res.status(400).send("Invalid URL");

  /*
   * When there's a real error, Redirect then destroy the stream immediately.
   */
  redirect(req, res);
  console.error(err);
}

function _onRequestResponse(origin, req, res) {
  if (origin.statusCode >= 400)
    return redirect(req, res);

  // handle redirects
  if (origin.statusCode >= 300 && origin.headers.location)
    return redirect(req, res);

  copyHeaders(origin, res);
  res.setHeader("content-encoding", "identity");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  req.params.originType = origin.headers["content-type"] || "";
  req.params.originSize = origin.headers["content-length"] || "0";

  origin.on('error', _ => req.socket.destroy());

  if (shouldCompress(req)) {
    /*
     * sharp support stream. So pipe it.
     */
    return compress(req, res, origin);
  } else {
    /*
     * Downloading then uploading the buffer to the client is not a good idea though,
     * It would better if you pipe the incomming buffer to client directly.
     */

    res.setHeader("x-proxy-bypass", 1);

    for (const headerName of ["accept-ranges", "content-type", "content-length", "content-range"]) {
      if (headerName in origin.headers)
        res.setHeader(headerName, origin.headers[headerName]);
    }

    return origin.pipe(res);
  }
}

export default hhproxy;
