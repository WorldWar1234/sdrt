import https from 'https';
import sharp from 'sharp';
import { Transform } from 'stream';

// Constants
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value
const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

// Utility function to determine if compression is needed
function shouldCompress(originType, originSize, isWebp) {
  const MIN_COMPRESS_LENGTH = isWebp ? 10000 : 50000;
  return (
    originType.startsWith("image") &&
    originSize >= MIN_COMPRESS_LENGTH &&
    !originType.endsWith("gif") // Skip GIFs for simplicity
  );
}

// Custom Transform stream to buffer chunks
class BufferChunks extends Transform {
  constructor(options) {
    super(options);
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= CHUNK_SIZE) {
      this.push(this.buffer.slice(0, CHUNK_SIZE));
      this.buffer = this.buffer.slice(CHUNK_SIZE);
    }
    callback();
  }

  _flush(callback) {
    if (this.buffer.length > 0) {
      this.push(this.buffer);
    }
    callback();
  }
}

// Function to compress an image stream directly
function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  const sharpInstance = sharp({ unlimited: false, animated: false });
  const bufferChunks = new BufferChunks();

  inputStream.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (grayscale) {
        sharpInstance.grayscale();
      }

      // Process the image and buffer it in chunks
      sharpInstance
        .toFormat(format, { quality , effort:0})
        .on("info", (info) => {
          // Set headers for the compressed image
          res.setHeader("Content-Type", `image/${format}`);
          res.setHeader("X-Original-Size", originSize);
          res.setHeader("X-Processed-Size", info.size);
          res.setHeader("X-Bytes-Saved", originSize - info.size);
        })
        .pipe(bufferChunks)
        .on("error", (err) => {
          console.error("Error during compression:", err.message);
          res.status(500).send("Error processing image.");
        })
        .on("end", () => {
          res.end(); // Ensure the response ends after all chunks are sent
        });

      bufferChunks.pipe(res);
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
