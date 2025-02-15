import fetch from "node-fetch";
import sharp from "sharp";

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
    const response = await fetch(req.params.url);

    if (!response.ok) {
      res.statusCode = response.status;
      return res.end("Failed to fetch the image.");
    }

    req.params.originType = response.headers.get("content-type");
    req.params.originSize = parseInt(response.headers.get("content-length"), 10) || 0;
    console.log("Content-Type:", req.params.originType);

    if (!req.params.originType.startsWith("image")) {
      res.statusCode = 400;
      return res.end("The requested URL is not an image.");
    }

    // Pass the response stream to the compress function
    compress(req, res, response.body);
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
