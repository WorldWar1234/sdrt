import got from "got";
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
    // Use got.stream to get a readable stream
    const imageStream = got.stream(req.params.url, {
      method: "get",
    });

    // Listen for the response event to access headers
    imageStream.on("response", (response) => {
      if (response.statusCode >= 400) {
        res.statusCode = response.statusCode;
        return res.end("Failed to fetch the image.");
      }

      req.params.originType = response.headers["content-type"];
      req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

      if (!req.params.originType.startsWith("image")) {
        res.statusCode = 400;
        return res.end("The requested URL is not an image.");
      }

      // Pass the stream to the compress function
      compress(req, res, imageStream);
    });

    // Handle errors during the stream
    imageStream.on("error", (err) => {
      console.error("Error fetching image:", err.message);
      res.statusCode = 500;
      res.end("Failed to fetch the image.");
    });
  } catch (err) {
    console.error("Error setting up stream:", err.message);
    res.statusCode = 500;
    res.end("Failed to fetch the image.");
  }
}

// Compress function with piping
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({ unlimited: false, animated: false });

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
      sharpInstance.toFormat(format, { quality: req.params.quality, effort: 0 }).pipe(res);
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.statusCode = 500;
      res.end("Failed to fetch image metadata.");
    });
    }
