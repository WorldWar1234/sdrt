"use strict";
import { request } from "undici";
import sharp from "sharp";
import UserAgent from "user-agents";

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

function pick(obj = {}, keys = []) {
  return keys.reduce((result, key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
    return result;
  }, {});
}

function copyHeaders(source, target) {
  // Headers to exclude or filter
  const excludeHeaders = ["set-cookie", "content-length"];
  
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      if (!excludeHeaders.includes(key.toLowerCase())) {
        target.setHeader(key, value);
      }
    } catch (error) {
      console.error(`Failed to copy header "${key}": ${error.message}`);
    }
  }
}

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

function compress(req, res, input) {
  const format = "webp";
  const transform = sharp();

  // Pipe the input to the transform pipeline
  input.pipe(transform);

  let outputBuffer = [];

  // Fetch metadata and process the image
  transform
    .metadata()
    .then((metadata) => {
      // Resize if height exceeds the WebP limit
      if (metadata.height > 16383) {
        transform.resize({ height: 16383 });
      }

      // Apply grayscale and compression options
      transform
        .grayscale(req.params.grayscale)
        .toFormat(format, {
          quality: req.params.quality,
          lossless: false,
          effort: 0, // Balance performance and compression (range: 0–6)
        });

      // Handle buffered output
      transform
        .on('data', (chunk) => {
          outputBuffer.push(chunk);  // Collect chunks of image data
        })
        .on('end', () => {
          // Combine the buffered chunks
          const finalBuffer = Buffer.concat(outputBuffer);

          // Set response headers and send the buffered image data
          res.setHeader("content-type", `image/${format}`);
          res.setHeader("content-length", finalBuffer.length);
          res.setHeader("x-original-size", req.params.originSize);
          res.setHeader("x-bytes-saved", req.params.originSize - finalBuffer.length);

          res.end(finalBuffer);  // Send the final buffer to the response
        })
        .on('error', (err) => {
          console.error("Compression error:", err.message);
          redirect(req, res);
        });
    })
    .catch((err) => {
      console.error("Metadata error:", err.message);
      redirect(req, res);
    });
}






async function hhproxy(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.end("bandwidth-hero-proxy");
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
  };

  try {
    let origin = await request(req.params.url, options);
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

  redirect(req, res);
  console.error(err);
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

  origin.body.on("error", (_) => req.socket.destroy());

  if (shouldCompress(req)) {
    return compress(req, res, origin.body);
  } else {
    res.setHeader("X-Proxy-Bypass", 1);

    ["accept-ranges", "content-type", "content-length", "content-range"].forEach(
      (header) => {
        if (origin.headers[header]) {
          res.setHeader(header, origin.headers[header]);
        }
      }
    );

    return origin.body.pipe(res);
  }
}

export default hhproxy;
