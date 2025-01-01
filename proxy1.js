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



/*function compress(req, res, input) {
  const format = "webp";
  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(1);
  const transform = sharp({unlimited: true});

  // Pipe the input to the transform pipeline
  input.body.pipe(transform);

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

      // Set response headers for content type and original size
      res.setHeader("content-type", `image/${format}`);
      res.setHeader("x-original-size", req.params.originSize);

      // Pipe the output directly to the response in chunks
      let originalSize = req.params.originSize;

      transform
        .on('data', (chunk) => {
          // Send each chunk as it's processed
          res.write(chunk);
        })
        .on('end', () => {
          // After all chunks are sent, finalize the response
          res.end();
        })
        .on('info', (info) => {
          res.setHeader("content-length", info.size);
          res.setHeader("x-bytes-saved", originalSize - info.size);
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
}*/

/*import fs from 'fs';
import path from 'path';

function compress(req, res, input) {
  const format = 'webp'; // Fixed format
  const outputFilePath = path.join('/tmp', `output.${format}`); // Temporary writable path

  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(1);

  const transformer = sharp({ unlimited: true });

  // Pipe the input stream into sharp
  input.body.pipe(transformer);

  // Fetch metadata and process the image
  transformer
    .metadata()
    .then((metadata) => {
      // Resize if necessary
      if (metadata.height > 16383) {
        transformer.resize({ height: 16383 });
      }

      // Apply grayscale and compression options
      if (req.params.grayscale) {
        transformer.grayscale();
      }

      transformer
        .toFormat(format, {
          quality: req.params.quality || 80,
          effort: 0, // Balance performance and compression (range: 0–6)
        })
        .toFile(outputFilePath) // Save output to temporary file
        .then((info) => {
          // Create a file stream for the saved output file
          const fileStream = fs.createReadStream(outputFilePath);

          // Set response headers
          res.setHeader('content-type', `image/${format}`);
          res.setHeader('content-length', info.size);
          res.setHeader('x-original-size', req.params.originSize);
          res.setHeader('x-bytes-saved', req.params.originSize - info.size);

          // Manually stream the data
          fileStream.on('data', (chunk) => {
            res.write(chunk); // Write each chunk to the response
          });

          // Handle stream end and cleanup
          fileStream.on('end', () => {
            // Clean up the temporary file
            fs.unlink(outputFilePath, (unlinkErr) => {
              if (unlinkErr) {
                console.error('Error deleting temporary file:', unlinkErr);
              }
              // Finalize the response after unlink
              res.end();
            });
          });

          // Handle stream errors
          fileStream.on('error', (err) => {
            console.error('Error during streaming:', err);
            redirect(req, res); // Redirect on error
          });
        })
        .catch((err) => {
          console.error('Error during image processing:', err.message);
          redirect(req, res); // Handle processing errors
        });
    })
    .catch((err) => {
      console.error('Metadata error:', err.message);
      redirect(req, res); // Handle metadata errors
    });
}
*/
const sharpStream = _ => sharp({ animated: false, unlimited: false});
function compress(req, res, input) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharpStream();

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
            height: 16383
          //  withoutEnlargement: true,
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
    return compress(req, res, origin.body);
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
