import https from 'https';
import fs from 'fs';
import zlib from 'zlib';
import { Readable, Writable } from 'stream';
import sharp from 'sharp';

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

// Function to resize the image manually using sharp
function resizeImage(inputStream, heightLimit) {
  const sharpInstance = sharp();
  return new Readable({
    read() {
      inputStream.pipe(sharpInstance.resize({ height: heightLimit })).pipe(this);
    },
  });
}

// Function to convert the image format manually using sharp
function convertImage(inputStream, format, quality) {
  const sharpInstance = sharp();
  return new Readable({
    read() {
      inputStream.pipe(sharpInstance.toFormat(format, { quality, effort: 0 })).pipe(this);
    },
  });
}

// Function to handle grayscale conversion using sharp
function convertToGrayscale(inputStream) {
  const sharpInstance = sharp();
  return new Readable({
    read() {
      inputStream.pipe(sharpInstance.grayscale()).pipe(this);
    },
  });
}

// Function to compress the image stream directly
function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  let processedStream = inputStream;

  // Resize the image if it exceeds the max height
  processedStream = resizeImage(processedStream, MAX_HEIGHT);

  // Apply grayscale conversion if needed
  if (grayscale) {
    processedStream = convertToGrayscale(processedStream);
  }

  // Convert the image format and quality
  processedStream = convertImage(processedStream, format, quality);

  processedStream
    .on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      res.write(buffer);
    })
    .on("end", () => {
      res.end(); // Ensure the response ends after all chunks are sent
    })
    .on("error", (err) => {
      console.error("Error during compression:", err.message);
      res.status(500).send("Error processing image.");
    });

  // Sending the headers before the stream starts
  processedStream.once('data', () => {
    res.setHeader("Content-Type", `image/${format}`);
    res.setHeader("X-Original-Size", originSize);
    res.setHeader("X-Processed-Size", processedStream.readableLength || originSize);
    res.setHeader("X-Bytes-Saved", originSize - (processedStream.readableLength || originSize));
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
