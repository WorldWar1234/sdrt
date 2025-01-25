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

// Function to compress an image stream directly using Node.js Transform streams
function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  const sharpInstance = sharp({ unlimited: false, animated: false })
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true });

  if (grayscale) {
    sharpInstance.grayscale();
  }

  // Set the output format and quality
  sharpInstance.toFormat(format, { quality, effort: 0 });

  // Create a Transform stream to manage the response headers and output to the client
  const transformStream = new Transform({
    transform(chunk, encoding, callback) {
      this.push(chunk); // Pass each chunk to the response stream
      callback();
    }
  });

  // Pipe sharp output through the transform stream
  inputStream.pipe(sharpInstance).pipe(transformStream);

  // Send response headers and data to the client
  sharpInstance
    .on('info', (info) => {
      // Set headers for the compressed image
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("X-Original-Size", originSize);
      res.setHeader("X-Processed-Size", info.size);
      res.setHeader("X-Bytes-Saved", originSize - info.size);
    })
    .on('end', () => {
      res.end(); // Ensure the response ends after all chunks are sent
    })
    .on('error', (err) => {
      console.error("Error during compression:", err.message);
      res.status(500).send("Error processing image.");
    });

  // Pipe the transformed stream to the response
  transformStream.pipe(res);
}

// Function to handle image compression requests
export function fetchImageAndHandle(req, res) {
  const imageUrl = req.query.url;
  const isWebp = !req.query.jpeg;
  const grayscale = req.query.bw == "1";
  const quality = parseInt(req.query.quality, 10) || DEFAULT_QUALITY;
  const format = isWebp ? "webp" : "jpeg";

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
      // Compress the stream
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
