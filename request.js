import http2 from "http2";
import sharp from "sharp";

// Constants
const DEFAULT_QUALITY = 80;

export function fetchImageAndHandle(req, res) {
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

  // Determine the protocol and use the correct client
  const client = http2.connect(req.params.url.startsWith("https") ? "https://" + new URL(req.params.url).host : "http://" + new URL(req.params.url).host);

  const request = client.request({
    [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
    [http2.constants.HTTP2_HEADER_PATH]: new URL(req.params.url).pathname + new URL(req.params.url).search,
    [http2.constants.HTTP2_HEADER_SCHEME]: req.params.url.startsWith("https") ? "https" : "http",
    [http2.constants.HTTP2_HEADER_AUTHORITY]: new URL(req.params.url).host
  });

  request.on("response", (headers, flags) => {
    if (headers[http2.constants.HTTP2_HEADER_STATUS] >= 400) {
      res.statusCode = headers[http2.constants.HTTP2_HEADER_STATUS];
      return res.end("Failed to fetch the image.");
    }

    req.params.originType = headers[http2.constants.HTTP2_HEADER_CONTENT_TYPE];
    req.params.originSize = parseInt(headers[http2.constants.HTTP2_HEADER_CONTENT_LENGTH], 10) || 0;

    if (!req.params.originType.startsWith("image")) {
      res.statusCode = 400;
      return res.end("The requested URL is not an image.");
    }

    // Pass the response stream to the compress function
    compress(req, res, request);
  });

  request.on("error", (err) => {
    console.error("Error fetching image:", err.message);
    res.statusCode = 500;
    res.end("Failed to fetch the image.");
  });

  request.end();
}

// Compress function with piping
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({ unlimited: true, animated: false });

  inputStream
    .pipe(sharpInstance) // Pipe input stream to Sharp for processing
    .on("error", (err) => {
      console.error("Error during image processing:", err.message);
      res.statusCode = 500;
      res.end("Failed to process image.");
    });

  // Handle metadata and apply transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > 16383) {
        sharpInstance.resize({ height: 16383 });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Pipe the processed image directly to the response
      res.setHeader("Content-Type", `image/${format}`);
      sharpInstance.toFormat(format, { quality: req.params.quality, effort:0 }).pipe(res);
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.statusCode = 500;
      res.end("Failed to fetch image metadata.");
    });
}
