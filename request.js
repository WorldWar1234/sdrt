import https from 'https';
import sharp from 'sharp';
import { pipeline } from 'stream';
import { promisify } from 'util';

const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Promisify the pipeline function for better error handling
const pipelineAsync = promisify(pipeline);

// Utility function to determine if compression is needed
function shouldCompress(originType, originSize, isWebp) {
  const MIN_COMPRESS_LENGTH = isWebp ? 10000 : 50000;
  return (
    originType.startsWith("image") &&
    originSize >= MIN_COMPRESS_LENGTH &&
    !originType.endsWith("gif") // Skip GIFs for simplicity
  );
}

// Function to handle conditional resizing and compression using Node pipelines
async function compressStream(inputStream, format, quality, grayscale, res, originSize) {
  try {
    // Create a Sharp instance for image processing
    const sharpInstance = sharp({ unlimited: false, animated: false });

    // Fetch metadata to determine if resizing is needed
    const metadata = await sharpInstance.metadata();
    const transforms = [];

    if (metadata.height > MAX_HEIGHT) {
      transforms.push(sharp().resize({ height: MAX_HEIGHT, withoutEnlargement: true }));
    }

    if (grayscale) {
      transforms.push(sharp().grayscale());
    }

    transforms.push(sharp().toFormat(format, { quality, effort: 0 }));

    // Set headers once processing begins
    transforms[transforms.length - 1].on("info", (info) => {
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("X-Original-Size", originSize);
      res.setHeader("X-Processed-Size", info.size);
      res.setHeader("X-Bytes-Saved", originSize - info.size);
    });

    // Use the pipeline to process the stream
    await pipelineAsync(
      inputStream,
      ...transforms,
      res
    );

    res.end(); // End the response
  } catch (error) {
    console.error("Error during compression:", error.message);
    res.status(500).send("Error processing image.");
  }
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
      // Compress the stream with conditional resizing
      compressStream(response, format, quality, grayscale, res, originSize);
    } else {
      // Stream the original image to the response if compression is not needed
      res.setHeader("Content-Type", originType);
      res.setHeader("Content-Length", originSize);
      pipeline(response, res, (error) => {
        if (error) {
          console.error("Error streaming original image:", error.message);
          res.status(500).send("Error streaming original image.");
        }
      });
    }
  }).on("error", (error) => {
    console.error("Error fetching image:", error.message);
    res.status(500).send("Failed to fetch the image.");
  });
}
