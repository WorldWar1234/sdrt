import https from 'https';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params

  if (!originType.startsWith('image')) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (
    !webp &&
    (originType.endsWith('png') || originType.endsWith('gif')) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Function to compress an image stream directly
function compressStream(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({ unlimited: false, animated: false });
  sharp.cache(0);
  sharp.concurrency(1);
  sharp.simd(true);
  inputStream.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Process the image and send it in chunks
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort:0 })
        .on("info", (info) => {
          // Set headers for the compressed image
          res.setHeader("Content-Type", `image/${format}`);
          res.setHeader("X-Original-Size", originSize);
          res.setHeader("X-Processed-Size", info.size);
          res.setHeader("X-Bytes-Saved", originSize - info.size);
        })
       /* .on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          res.write(buffer);
        })
        .on("end", () => {
            res.end(); // Ensure the response ends after all chunks are sent
           })*/
        .pipe(res)
        .on("error", (err) => {
          console.error("Error during compression:", err.message);
          res.status(500).send("Error processing image.");
        });
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.status(500).send("Error processing image metadata.");
    });
}

// Function to handle image compression requests
export function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send("Image URL is required.");
  }
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };
  
  https.get(imageUrl, (response) => {
    req.params.originType = response.headers["content-type"];
    req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send("Failed to fetch the image.");
    }

    if (shouldCompress(req)) {
      // Compress the stream
      compressStream(req, res, response);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader("Content-Type", originType);
      res.setHeader("Content-Length", originSize);
      response.pipe(res);
    }
  }).on("error", (error) => {
    console.error("Error fetching image:", error.message);
    res.status(500).send("Failed to fetch the image.");
  });
}
