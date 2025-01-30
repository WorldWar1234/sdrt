import { request } from 'undici';

// Constants
const WSRV_URL = 'https://wsrv.nl/';
const DEFAULT_QUALITY = 80;

// Function to handle image compression requests using wsrv.nl
export async function fetchImageAndHandle(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Image URL is required.');
  }

  // Decode the URL and extract parameters
  const imageUrl = decodeURIComponent(url);
  const webp = !req.query.jpeg;
  const grayscale = req.query.bw != 0;
  const quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;

  try {
    // Construct the wsrv.nl URL with parameters
    const wsrvParams = new URLSearchParams();
    wsrvParams.set('url', imageUrl);
    if (webp) wsrvParams.set('output', 'webp');
    if (grayscale) wsrvParams.set('bw', '1');
    wsrvParams.set('q', quality.toString());

    const wsrvUrl = `${WSRV_URL}?${wsrvParams.toString()}`;

    // Fetch the optimized image from wsrv.nl
    const { body, headers, statusCode } = await request(wsrvUrl);

    if (statusCode >= 400) {
      return res.status(statusCode).send('Failed to fetch the image.');
    }

    // Stream the optimized image to the response
    res.setHeader('Content-Type', headers['content-type']);
    res.setHeader('Content-Length', headers['content-length']);
    body.pipe(res);
  } catch (error) {
    console.error('Error fetching image:', error.message);
    res.status(500).send('Failed to fetch the image.');
  }
}
