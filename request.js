import { fetch } from "fetch-h2"; // HTTP/2-enabled fetch
import sharp from "sharp";

// Constants (same as before)
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;

// ... (keep your `shouldCompress` and `compress` functions)
// Utility function remains unchanged
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

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

// compress function remains the same
function compress(req, res, inputStream) {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.simd(true);
  const format = 'jpeg';
  const sharpInstance = sharp({ unlimited: false, animated: false, limitInputPixels: false });

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

      res.setHeader('Content-Type', `image/${format}`);
      sharpInstance
        .toFormat(format, { quality: req.params.quality, effort: 0 })
        .on('info', (info) => {
          res.setHeader('X-Original-Size', req.params.originSize);
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', req.params.originSize - info.size);
        })
        .pipe(res);
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.status(500).send('Failed to fetch image metadata.');
    });
}

export async function fetchImageAndHandle(req, res) {
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

  try {
    // Fetch using HTTP/2
    const response = await fetch(req.params.url, {
      redirect: "follow", // Handle redirects automatically
      h2: { /* HTTP/2-specific options */ },
    });

    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch image.");
    }

    // Extract headers
    req.params.originType = response.headers.get("content-type");
    req.params.originSize = parseInt(response.headers.get("content-length"), 10) || 0;

    if (shouldCompress(req)) {
      compress(req, res, response.body);
    } else {
      res.setHeader("Content-Type", req.params.originType);
      res.setHeader("Content-Length", req.params.originSize);
      response.body.pipe(res); // Stream the HTTP/2 response
    }
  } catch (error) {
    console.error("HTTP/2 fetch error:", error.message);
    res.status(500).send("Failed to fetch image.");
  }
}
