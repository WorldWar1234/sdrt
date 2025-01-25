import https from 'https';
import sharp from 'sharp';
import { Transform } from 'stream';

// Constants
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(originType, originSize, isWebp) {
  const MIN_COMPRESS_LENGTH = isWebp ? 10000 : 50000;
  return (
    originType.startsWith("image") &&
    originSize >= MIN_COMPRESS_LENGTH &&
    !originType.endsWith("gif") // Skip GIFs for simplicity
  );
}

// Function to compress an image stream directly with conditional resizing
function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  const sharpInstance = sharp({ unlimited: false, animated: false });

  // Disable caching for Sharp
  sharp.cache(0);
  sharp.concurrency(1);
  sharp.simd(true);

  // Fetch metadata to check the height
  sharpInstance
    .metadata()
    .then((metadata) => {
      // If height exceeds MAX_HEIGHT, resize it
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT, withoutEnlargement: true });
      }

      if (grayscale) {
        sharpInstance.grayscale();
      }

      // Process the image with the specified format and quality
      sharpInstance
        .toFormat(format, { quality, effort: 1 })
        .on("info", (info) => {
          // Set headers for the compressed image
          res.setHeader("Content-Type", `image/${format}`);
          res.setHeader("X-Original-Size", originSize);
          res.setHeader("X-Processed-Size", info.size);
          res.setHeader("X-Bytes-Saved", originSize - info.size);
        })
        .on("data", (chunk) => {
          // Write chunks to the response stream
          res.write(Buffer.from(chunk));
        })
        .on("end", () => {
          res.end(); // Ensure the response ends
        })
        .on("error", (err) => {
          console.error("Error during compression:", err.message);
          res.status(500).send("Error processing image.");
        });

      // Pipe the input stream into the Sharp instance
      inputStream.pipe(sharpInstance);
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.status(500).send("Error processing image metadata.");
    });
}

// Function to handle image compression requests
export function fetchImageAndHandle(req, res) {
  const imageUrl = req.query.url;
  const isWebp = !req.query.jpeg;
  const grayscale = req.query.bw == "1";
  const quality = parseInt(req.query.quality, 10) || DEFAULT_QUALITY;
  const format = "png";

  if (!imageUrl) {
    return res.status(400).send("Image URL is required.");
  }

  https.get(imageUrl, (response) => {
    const originType = response.headers["content-type"];
    const originSize = parseInt(response.headers["content-length"], 10) || 0;

    if (response.statusCode >= 400) {
      return res.status(response.statusCode).send("Failed to fetch the image.");
    }

    if (shouldCompress(originType, originSize, isWebp)) {
      // Compress the stream with conditional resizing
      compressStream(response, format, quality, grayscale, res, originSize);
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
