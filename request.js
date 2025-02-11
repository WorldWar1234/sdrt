import axios from 'axios';
import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

const MAX_DIMENSION = 16384;
const LARGE_IMAGE_THRESHOLD = 4000000;
const MEDIUM_IMAGE_THRESHOLD = 1000000;

/**
 * Compress an image based on request parameters.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {Buffer|string} input - Input image buffer or file path.
 */
async function compress(req, res, input) {
    try {
        if (!Buffer.isBuffer(input) && typeof input !== 'string') {
            logError('Invalid input: must be a Buffer or file path.');
            return redirect(req, res);
        }

        const { format, compressionQuality, grayscale } = getCompressionParams(req);

        const sharpInstance = sharp(input);
        const metadata = await sharpInstance.metadata();

        if (!isValidMetadata(metadata)) {
            logError('Invalid or missing metadata.');
            return redirect(req, res);
        }

        const isAnimated = metadata.pages > 1;
        const pixelCount = metadata.width * metadata.height;
        const outputFormat = isAnimated ? 'webp' : format;
        const avifParams = outputFormat === 'avif' ? optimizeAvifParams(metadata.width, metadata.height) : {};
        let processedImage = prepareImage(input, grayscale, isAnimated, metadata, pixelCount);

        const formatOptions = getFormatOptions(outputFormat, compressionQuality, avifParams, isAnimated);

        processedImage.toFormat(outputFormat, formatOptions)
            .toBuffer({ resolveWithObject: true })
            .then(({ data, info }) => {
                sendImage(res, data, outputFormat, req.params.url || '', req.params.originSize || 0, info.size);
            })
            .catch((error) => {
                handleSharpError(error, res, sharpInstance, outputFormat, req, compressionQuality);
            });
    } catch (err) {
        logError('Error during image compression:', err);
        redirect(req, res);
    }
}

function getCompressionParams(req) {
    const format = req.params?.webp ? 'avif' : 'jpeg';
    const compressionQuality = Math.min(Math.max(parseInt(req.params?.quality, 10) || 75, 10), 100);
    const grayscale = req.params?.grayscale === 'true' || req.params?.grayscale === true;

    return { format, compressionQuality, grayscale };
}

function isValidMetadata(metadata) {
    return metadata && metadata.width && metadata.height;
}

function optimizeAvifParams(width, height) {
    const area = width * height;
    if (area > LARGE_IMAGE_THRESHOLD) {
        return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
    } else if (area > MEDIUM_IMAGE_THRESHOLD) {
        return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
    } else {
        return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 46, effort: 5 };
    }
}

function getFormatOptions(outputFormat, quality, avifParams, isAnimated) {
    const options = {
        quality,
        alphaQuality: 80,
        chromaSubsampling: '4:2:0',
        loop: isAnimated ? 0 : undefined,
    };
    if (outputFormat === 'avif') {
        return { ...options, ...avifParams };
    }
    return options;
}

function prepareImage(input, grayscale, isAnimated, metadata, pixelCount) {
    let processedImage = sharp(input, { animated: isAnimated });
    if (grayscale) processedImage = processedImage.grayscale();
    if (!isAnimated) processedImage = applyArtifactReduction(processedImage, pixelCount);

    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
        processedImage = processedImage.resize({
            width: Math.min(metadata.width, MAX_DIMENSION),
            height: Math.min(metadata.height, MAX_DIMENSION),
            fit: 'inside',
            withoutEnlargement: true,
        });
    }
    return processedImage;
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

function handleSharpError(error, res, sharpInstance, outputFormat, req, quality) {
    logError('Unhandled sharp error:', error);
    redirect(req, res);
}

function sendImage(res, data, format, url, originSize, compressedSize) {
    const filename = sanitizeFilename(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('x-original-size', originSize);
    res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));
    res.status(200).end(data);
}

function logError(message, error = null) {
    console.error({ message, error: error?.message || null });
}

// Function to handle image compression requests using axios
export async function fetchImageAndHandle(req, res) {
    const url = req.query.url;
    if (!url) return res.status(400).send('Image URL is required.');

    req.params = {
        url: decodeURIComponent(url),
        webp: !req.query.jpeg, // if "jpeg" is provided, do not convert to webp
        grayscale: req.query.bw != 0,
        quality: parseInt(req.query.l, 10) || 75,
    };

    try {
        const response = await axios.get(req.params.url, {
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
            },
            transformRequest: [(data, headers) => {
                const allowedHeaders = ['User-Agent', 'Accept', 'Accept-Language', 'Connection'];
                Object.keys(headers).forEach(key => {
                    if (!allowedHeaders.includes(key)) {
                        delete headers[key];
                    }
                });
                return data;
            }]
        });

        req.params.originType = response.headers['content-type'];
        req.params.originSize = parseInt(response.headers['content-length'], 10) || 0;

        if (response.status >= 400) {
            return res.status(response.status).send('Failed to fetch the image.');
        }

        const chunks = [];
        response.data.on('data', chunk => chunks.push(chunk));
        response.data.on('end', async () => {
            const buffer = Buffer.concat(chunks);

            if (shouldCompress(req)) {
                await compress(req, res, buffer);
            } else {
                res.setHeader('Content-Type', req.params.originType);
                res.setHeader('Content-Length', req.params.originSize);
                res.end(buffer);
            }
        });

        response.data.on('error', (err) => {
            console.error('Error receiving image data:', err.message);
            res.status(500).send('Failed to fetch the image.');
        });
    } catch (error) {
        console.error('Error fetching image:', error.message);
        res.status(500).send('Failed to fetch the image.');
    }
}

// Utility function to determine if compression is needed
function shouldCompress({ originType, originSize, webp }) {
    if (!originType?.startsWith('image') || originSize === 0) return false;
    if (webp && originSize < 1024) return false;
    if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < 100 * 1024) {
        return false;
    }
    return true;
}
