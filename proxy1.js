// proxy.js
const http = require("http");
const https = require("https");
const sharp = require("sharp");
const pick = require("./pick.js");
const { availableParallelism } = require("os");

const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const MAX_HEIGHT = 16383;
const USER_AGENT = "Bandwidth-Hero Compressor";

function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;
  return (
    originType.startsWith("image") &&
    originSize > 0 &&
    !req.headers.range &&
    !(webp && originSize < MIN_COMPRESS_LENGTH) &&
    !(!webp && (originType.endsWith("png") || originType.endsWith("gif")) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH)
  );
}

function copyHeaders(source, target) {
  Object.entries(source.headers).forEach(([key, value]) => {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.log(e.message);
    }
  });
}

function redirect(req, res) {
  if (!res.headersSent) {
    res.writeHead(302, {
      Location: encodeURI(req.params.url),
      'Content-Length': '0'
    });
    ["cache-control", "expires", "date", "etag"].forEach(header => res.removeHeader(header));
    res.end();
  }
}

function compress(req, res, input) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false
  });

  sharp.cache(false);
  sharp.simd(false);
  sharp.concurrency(availableParallelism());

  sharpInstance
    .metadata()
    .then(metadata => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({
          width: null,
          height: MAX_HEIGHT,
          withoutEnlargement: true
        });
      }
      return sharpInstance
        .grayscale(req.params.grayscale)
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on("info", info => {
          res.writeHead(200, {
            "content-type": `image/${format}`,
            "content-length": info.size,
            "x-original-size": req.params.originSize,
            "x-bytes-saved": req.params.originSize - info.size
          });
        })
        .on("data", chunk => {
          res.write(chunk);
        })
        .on("end", () => {
          res.end();
        })
        .on("error", () => redirect(req, res));
    });

  input.pipe(sharpInstance);
}

function hhproxy(req, res) {
  let url = req.query.url;
  if (!url) return res.end("bandwidth-hero-proxy");

  req.params = {
    url: decodeURIComponent(url),
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
      "User-Agent": USER_AGENT,
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.ip,
      "Via": "1.1 bandwidth-hero"
    },
    rejectUnauthorized: false
  };

  const requestModule = parsedUrl.protocol === 'https:' ? https : http;

  try {
    let originReq = requestModule.request(parsedUrl, options, originRes => {
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
        ["accept-ranges", "content-type", "content-length", "content-range"].forEach(header => {
          if (originRes.headers[header]) {
            res.setHeader(header, originRes.headers[header]);
          }
        });

        originRes.pipe(res);
      }
    });

    originReq.on('error', () => req.socket.destroy());
    originReq.end();
  } catch (err) {
    if (err.code === "ERR_INVALID_URL") {
      res.status(400).send("Invalid URL");
    } else {
      redirect(req, res);
      console.error(err);
    }
  }
}

module.exports = hhproxy;
