import { request } from 'undici';

// Constants
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value
const STATICALLY_URL = 'https://cdn.statically.io'; // Statically.io base URL

// Function to generate a Statically.io URL
function generateStaticallyUrl(url, options) {
  const { webp, grayscale, quality, height } = options;
  let staticallyUrl = `${STATICALLY_URL}/img/${encodeURIComponent(url)}`;

  // Add query parameters for Statically.io
  if (webp) staticallyUrl += '/f=webp';
  if (grayscale) staticallyUrl += '/f=grayscale';
  if (quality) staticallyUrl += `/q=${quality}`;
  if (height) staticallyUrl += `/h=${height}`;

  return staticallyUrl;
}

// Function to handle image compression requests
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  const options = {
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
    height: MAX_HEIGHT,
  };

  try {
    // Generate Statically.io URL
    const staticallyUrl = generateStaticallyUrl(decodeURIComponent(url), options);

    // Fetch the image from Statically.io
    const { body, headers, statusCode } = await request(staticallyUrl);

    if (statusCode >= 400) {
      return res.status(statusCode).send('Failed to fetch the image.');
    }

    // Stream the processed image directly to the response
    res.setHeader('Content-Type', headers['content-type']);
    res.setHeader('Content-Length', headers['content-length']);
    body.pipe(res);
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
