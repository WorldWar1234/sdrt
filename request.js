import axios from "axios";
import https2Adapter from "axios-https2-adapter";
import sharp from "sharp";

// Create an Axios instance configured to use the HTTP/2 adapter.
const http2Axios = axios.create({
  adapter: https2Adapter,
});

// Constants
const DEFAULT_QUALITY = 80;

export async function fetchImageAndHandle(req, res) {
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

  try {
    // Use the http2Axios instance so that the request uses HTTP/2.
    const response = await http2Axios({
      method: "get",
      url: req.params.url,
      responseType: "stream",
    });

    if (response.status >= 400) {
      res.statusCode = response.status;
      return res.end("Failed to fetch the image.");
    }

    req.params.originType = response.headers["content-type"];
    req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

    if (!req.params.originType.startsWith("image")) {
      res.statusCode = 400;
      return res.end("The requested URL is not an image.");
    }

    // Pass the response stream to the compress function.
    compress(req, res, response.data);
  } catch (err) {
    console.error("Error fetching image:", err.message);
    res.statusCode = 500;
    res.end("Failed to fetch the image.");
  }
}

// Compress function with piping
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({ unlimited: true, animated: false });

  inputStream
    .pipe(sharpInstance)
    .on("error", (err) => {
      console.error("Error during image processing:", err.message);
      res.statusCode = 500;
      res.end("Failed to process image.");
    });

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > 16383) {
        sharpInstance.resize({ height: 16383 });
      }
      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }
      res.setHeader("Content-Type", `image/${format}`);
      sharpInstance.toFormat(format, { quality: req.params.quality, effort: 0 }).pipe(res);
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.statusCode = 500;
      res.end("Failed to fetch image metadata.");
    });
}
