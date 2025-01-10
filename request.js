import https from 'https';
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

// Function to compress an image stream directly

const MAX_BUFFER_SIZE = 50 * 1024; // 50 KB buffer size

function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  const sharpInstance = sharp({ unlimited: true, animated: false });

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

      res.setHeader("Content-Type", `image/${format}`);
      let processedSize = 0;

      let bufferQueue = []; // Array to store buffered chunks
      let currentBufferSize = 0; // Track total size of buffered chunks

      sharpInstance
        .toFormat(format, { quality })
        .on("data", (chunk) => {
          bufferQueue.push(chunk);
          currentBufferSize += chunk.length;

          // Write buffered chunks if buffer size exceeds the threshold (50 KB)
          if (currentBufferSize >= MAX_BUFFER_SIZE) {
            writeBufferedChunks();
          }
        })
        .on("end", () => {
          // Write any remaining buffered data
          if (bufferQueue.length > 0) {
            writeBufferedChunks();
          }
          res.end(); // Finalize the response
        })
        .on("error", (err) => {
          console.error("Error during compression:", err.message);
          res.status(500).send("Error processing image.");
        });

      function writeBufferedChunks() {
        // Combine all buffered chunks into a single buffer
        const combinedBuffer = Buffer.concat(bufferQueue, currentBufferSize);

        // Write the combined buffer to the response
        if (!res.send(combinedBuffer)) {
          sharpInstance.pause(); // Pause processing if writable stream is full
          res.once("drain", () => sharpInstance.resume()); // Resume when writable is ready
        }

        // Clear the buffer queue and reset size tracker
        bufferQueue = [];
        currentBufferSize = 0;

        // Update processed size
        processedSize += combinedBuffer.length;
        res.setHeader("X-Processed-Size", processedSize);
        res.setHeader("X-Bytes-Saved", originSize - processedSize);
      }
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.status(500).send("Error processing image metadata.");
    });
}


/*function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  const sharpInstance = sharp({ unlimited: false, animated: false });

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

      // Set headers for the compressed image
      res.setHeader("Content-Type", `image/${format}`);

      let processedSize = 0;

      // Process and send chunks as buffers
      sharpInstance
        .toFormat(format, { quality })
        .on("data", (chunk) => {
          const buffer = Buffer.from(chunk); // Convert the chunk to a buffer
          processedSize += buffer.length;
          res.send(buffer); // Send the buffer chunk
        })
        .on("info", (info) => {
          res.setHeader("X-Original-Size", originSize);
          res.setHeader("X-Processed-Size", processedSize);
          res.setHeader("X-Bytes-Saved", originSize - processedSize);
        })
        .on("end", () => {
          res.end(); // Finalize the response
        })
        .on("error", (err) => {
          console.error("Error during compression:", err.message);
          res.status(500).send("Error processing image.");
        });
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.status(500).send("Error processing image metadata.");
    });
}*/



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
