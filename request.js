import axios from 'axios';
import sharp from 'sharp';

// Constants
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress({ originType, originSize, webp }) {
  if (!originType?.startsWith('image') || originSize === 0) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
    return false;
  }
  return true;
}

// Function to compress an image stream directly using Sharp
async function compress(req, res, inputStream) {
  const format = req.params.webp ? 'webp' : 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

  try {
    const metadata = await sharpInstance.metadata();
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT });
    }

    if (req.params.grayscale) {
      sharpInstance.grayscale();
    }

    res.setHeader('Content-Type', `image/${format}`);

    const outputStream = sharpInstance
      .toFormat(format, { quality: req.params.quality, effort: 0 })
      .on('info', (info) => {
        res.setHeader('X-Original-Size', req.params.originSize);
        res.setHeader('X-Processed-Size', info.size);
        res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
      });

    inputStream.pipe(sharpInstance).pipe(res);
  } catch (err) {
    console.error('Error during image processing:', err.message);
    res.status(500).end('Failed to process the image.');
  }
}

// Function to handle image compression requests using node-fetch
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send('Image URL is required.');

  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg, // if "jpeg" is provided, do not convert to webp
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  try {
    // Fetch the URL with axios using a stream response.
    const response = await axios.get(req.params.url, {
      responseType: "stream",
      maxRedirects: 4,
      // Ensure axios resolves the promise regardless of the HTTP status.
      validateStatus: () => true
    });

    // If the response indicates an error or a redirect, simply forward it.
    if (response.status >= 400 || (response.status >= 300 && response.headers.location)) {
      res.status(response.status);
      return response.data.pipe(res);
    }

    // Set necessary headers on the client response.
    res.setHeader("content-encoding", "identity");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

    // Save origin header info for later use.
    req.params.originType = response.headers["content-type"] || "";
    req.params.originSize = response.headers["content-length"] || "0";

    // Destroy the socket if an error occurs while streaming.
    response.data.on("error", () => req.socket.destroy());

    if (shouldCompress(req)) {
      // If compression is needed, pass the stream to the compressor.
      return compress(req, res, {
        statusCode: response.status,
        headers: response.headers,
        body: response.data
      });
    } else {
      // Indicate bypass and set selected headers manually.
      res.setHeader("x-proxy-bypass", 1);
      ["accept-ranges", "content-type", "content-length", "content-range"].forEach(header => {
        if (response.headers[header]) {
          res.setHeader(header, response.headers[header]);
        }
      });
      return response.data.pipe(res);
    }
  } catch (err) {
    if (err.code === "ERR_INVALID_URL") {
      return res.status(400).send("Invalid URL");
    }
    console.error(err);
    return res.status(500).send("Internal Server Error");
  }
}
