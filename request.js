import axios from 'axios';
import sharp from 'sharp';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

// Constants
const MAX_DIMENSION = 16384;
const LARGE_IMAGE_THRESHOLD = 4000000;
const MEDIUM_IMAGE_THRESHOLD = 1000000;
const DEFAULT_QUALITY = 75;

// Utility function to determine if compression is needed
function shouldCompress({ originType, originSize, format }) {
  if (!originType?.startsWith('image') || originSize === 0) return false;
  if (['image/webp', 'image/avif'].includes(originType) && originSize < 102400) return false;
  return true;
}

async function compressImage(req, res, inputBuffer) {
  try {
    const { format, quality, grayscale } = getCompressionParams(req);
    const sharpInstance = sharp(inputBuffer, { animated: true });
    const metadata = await sharpInstance.metadata();

    if (!metadata || !metadata.width || !metadata.height) {
      return sendOriginalImage(res, inputBuffer, req);
    }

    const isAnimated = metadata.pages > 1;
    const pixelCount = metadata.width * metadata.height;
    const outputFormat = isAnimated ? 'webp' : format;
    
    let processedImage = sharp(inputBuffer, { animated: isAnimated })
      .resize({
        width: Math.min(metadata.width, MAX_DIMENSION),
        height: Math.min(metadata.height, MAX_DIMENSION),
        fit: 'inside',
        withoutEnlargement: true
      });

    if (grayscale) processedImage = processedImage.grayscale();
    if (!isAnimated) processedImage = applyArtifactReduction(processedImage, pixelCount);

    const avifParams = outputFormat === 'avif' ? optimizeAvifParams(metadata.width, metadata.height) : {};
    const formatOptions = getFormatOptions(outputFormat, quality, avifParams, isAnimated);

    const { data, info } = await processedImage
      .toFormat(outputFormat, formatOptions)
      .toBuffer({ resolveWithObject: true });

    sendCompressedImage(res, data, outputFormat, req.params.url, req.params.originSize, info.size);

  } catch (error) {
    handleCompressionError(error, req, res, inputBuffer);
  }
}

function getCompressionParams(req) {
  const format = req.query.webp ? 'avif' : 'jpeg';
  const quality = Math.min(Math.max(parseInt(req.query.l, 10) || DEFAULT_QUALITY, 10), 100);
  const grayscale = req.query.bw === '1' || req.query.bw === 'true';

  return { format, quality, grayscale };
}

function optimizeAvifParams(width, height) {
  const area = width * height;
  if (area > LARGE_IMAGE_THRESHOLD) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  }
  if (area > MEDIUM_IMAGE_THRESHOLD) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  }
  return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 46, effort: 5 };
}

function applyArtifactReduction(sharpInstance, pixelCount) {
  const settings = pixelCount > LARGE_IMAGE_THRESHOLD
    ? { blur: 0.4, denoise: 0.15, sharpen: 0.8, saturation: 0.85 }
    : pixelCount > MEDIUM_IMAGE_THRESHOLD
    ? { blur: 0.35, denoise: 0.12, sharpen: 0.6, saturation: 0.9 }
    : { blur: 0.3, denoise: 0.1, sharpen: 0.5, saturation: 0.95 };

  return sharpInstance
    .modulate({ saturation: settings.saturation })
    .blur(settings.blur)
    .sharpen(settings.sharpen)
    .gamma();
}

function getFormatOptions(format, quality, avifParams, isAnimated) {
  const baseOptions = {
    quality,
    alphaQuality: 80,
    chromaSubsampling: '4:2:0',
    loop: isAnimated ? 0 : undefined
  };

  return format === 'avif' ? { ...baseOptions, ...avifParams } : baseOptions;
}

function sendCompressedImage(res, data, format, url, originSize, compressedSize) {
  const filename = sanitizeFilename(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
  
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Original-Size', originSize);
  res.setHeader('X-Processed-Size', compressedSize);
  res.setHeader('X-Bytes-Saved', Math.max(originSize - compressedSize, 0));
  res.status(200).end(data);
}

function handleCompressionError(error, req, res, originalBuffer) {
  console.error('Compression error:', error.message);
  sendOriginalImage(res, originalBuffer, req);
}

function sendOriginalImage(res, buffer, req) {
  res.setHeader('Content-Type', req.params.originType);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

export async function fetchImageAndHandle(req, res) {
  try {
    const url = validateUrl(req.query.url);
    const params = prepareRequestParams(req, url);
    
    const response = await axios.get(params.url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 50 * 1024 * 1024,
      headers: createSafeHeaders()
    });

    Object.assign(params, {
      originType: response.headers['content-type'],
      originSize: parseInt(response.headers['content-length'], 10) || 0
    });

    const inputBuffer = Buffer.from(response.data);
    
    if (shouldCompress(params)) {
      await compressImage(req, res, inputBuffer);
    } else {
      sendOriginalImage(res, inputBuffer, req);
    }

  } catch (error) {
    handleFetchError(error, res);
  }
}

function validateUrl(url) {
  if (!url) throw new Error('URL parameter is required');
  try {
    return new URL(url).toString();
  } catch (error) {
    throw new Error('Invalid URL format');
  }
}

function prepareRequestParams(req, url) {
  return {
    url: decodeURIComponent(url),
    webp: !!req.query.webp,
    grayscale: req.query.bw === '1' || req.query.bw === 'true',
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY
  };
}

function createSafeHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'image/webp,image/avif,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive'
  };
}

function handleFetchError(error, res) {
  console.error('Fetch error:', error.message);
  res.status(error.response?.status || 500).send(error.message);
}
