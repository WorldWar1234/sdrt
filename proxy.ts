"use strict";

import _ from "lodash";
import axios, { AxiosResponse } from "axios";
import sharp from "sharp";
import { Request, Response } from "express";

const { pick } = _;
const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Helper: Should compress
function shouldCompress(req: Request): boolean {
  const { originType, originSize, webp } = req.params as {
    originType: string;
    originSize: string;
    webp: boolean;
  };

  if (!originType.startsWith("image")) return false;
  if (Number(originSize) === 0) return false;
  if (req.headers.range) return false;
  if (webp && Number(originSize) < MIN_COMPRESS_LENGTH) return false;
  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    Number(originSize) < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Helper: Copy headers
function copyHeaders(source: AxiosResponse, target: Response): void {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value as string);
    } catch (e) {
      console.error((e as Error).message);
    }
  }
}

// Helper: Redirect
function redirect(req: Request, res: Response): void {
  if (res.headersSent) return;

  res.setHeader("content-length", "0");
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");
  res.setHeader("location", encodeURI(req.params.url as string));
  res.status(302).end();
}

// Helper: Compress
function compress(req: Request, res: Response, input: AxiosResponse): void {
  const format = "jpeg";

  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(require("os").availableParallelism());

  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false,
  });

  input.data
    .pipe(
      sharpInstance
        .resize(null, 16383, {
          withoutEnlargement: true,
        })
        .grayscale(req.params.grayscale === "true")
        .toFormat(format, {
          quality: parseInt(req.params.quality, 10),
          effort: 0,
        })
        .on("error", () => redirect(req, res))
        .on("info", (info) => {
          res.setHeader("content-type", "image/" + format);
          res.setHeader("content-length", info.size.toString());
          res.setHeader("x-original-size", req.params.originSize as string);
          res.setHeader(
            "x-bytes-saved",
            (Number(req.params.originSize) - info.size).toString()
          );
          res.status(200);
        })
    )
    .pipe(res);
}

// Main: Proxy
function proxy(req: Request, res: Response): void {
  let url = req.query.url as string;
  if (!url) return res.send("bandwidth-hero-proxy");

  req.params = {
    url: decodeURIComponent(url),
    webp: !(req.query.jpeg as boolean),
    grayscale: req.query.bw !== "0",
    quality: parseInt(req.query.l as string, 10) || DEFAULT_QUALITY,
  };

  if (
    req.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes((req.headers["x-forwarded-for"] as string) || req.ip)
  ) {
    return redirect(req, res);
  }

  axios
    .get(req.params.url, {
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
        "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
        via: "1.1 bandwidth-hero",
      },
      responseType: "stream",
      maxRedirects: 4,
    })
    .then((origin) => {
      if (origin.status >= 400 || (origin.status >= 300 && origin.headers.location)) {
        return redirect(req, res);
      }

      copyHeaders(origin, res);
      res.setHeader("content-encoding", "identity");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

      req.params.originType = origin.headers["content-type"] || "";
      req.params.originSize = origin.headers["content-length"] || "0";

      if (shouldCompress(req)) {
        compress(req, res, origin);
      } else {
        res.setHeader("x-proxy-bypass", "1");
        ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
          if (origin.headers[header]) {
            res.setHeader(header, origin.headers[header] as string);
          }
        });
        origin.data.pipe(res);
      }
    })
    .catch((err) => {
      if (err.code === "ERR_INVALID_URL") {
        return res.status(400).send("Invalid URL");
      }
      console.error(err);
      redirect(req, res);
    });
}

export { proxy };
