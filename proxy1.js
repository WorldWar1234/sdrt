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

const sharpStream = () => sharp({ animated: false, unlimited: true });

function compress(req, res, input) {
  const format = req.params.webp ? 'webp' : 'jpeg';

  const compressor = sharpStream();

  // Step 1: Retrieve metadata to check the height
  compressor
    .metadata()
    .then(metadata => {
      let pipeline = compressor;

      // Step 2: Check if height exceeds the limit and resize if necessary
      if (metadata.height > 16383) {
        const resizeHeight = 16383;
        pipeline = sharpStream().resize({ height: resizeHeight }); // Resize the image
      }

      // Step 3: Continue with image processing
      pipeline
        .grayscale(req.params.grayscale)
        .toFormat(format, {
          quality: req.params.quality,
          progressive: true,
          optimizeScans: true,
          effort: 0
        })
        .toBuffer((err, output, info) => _sendResponse(err, output, info, format, req, res));
    })
    .catch(err => {
      console.error("Error retrieving metadata:", err);
      redirect(req, res); // Redirect in case of errors
    });

  input.body.pipe(compressor);
}

function _sendResponse(err, output, info, format, req, res) {
  if (err || !info) return redirect(req, res);

  res.setHeader('content-type', 'image/' + format);
  res.setHeader('content-length', info.size);
  res.setHeader('x-original-size', req.params.originSize);
  res.setHeader('x-bytes-saved', req.params.originSize - info.size);
  res.status(200);
  res.write(output);
  res.end();
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
    return compress(req, res, origin);
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
