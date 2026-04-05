#!/usr/bin/env node

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { rgbaToThumbHash, thumbHashToRGBA } from "thumbhash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const dataDir = path.join(projectRoot, "data");
const careerDir = path.join(publicDir, "career");
const careerManifestPath = path.join(dataDir, "career-images.json");
const profileManifestPath = path.join(dataDir, "profile-image.json");

async function createImageMetadata(inputPath) {
  const image = sharp(inputPath).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height) {
    throw new Error(`Missing dimensions for image: ${inputPath}`);
  }

  const { data, info } = await image
    .resize({
      width: 100,
      height: 100,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const thumbhashBytes = rgbaToThumbHash(info.width, info.height, data);
  const { w, h, rgba } = thumbHashToRGBA(thumbhashBytes);
  const placeholderBuffer = await sharp(Buffer.from(rgba), {
    raw: {
      width: w,
      height: h,
      channels: 4,
    },
  })
    .png({
      compressionLevel: 9,
    })
    .toBuffer();

  return {
    width,
    height,
    thumbhash: Buffer.from(thumbhashBytes).toString("base64"),
    placeholderDataUrl: `data:image/png;base64,${placeholderBuffer.toString("base64")}`,
  };
}

async function syncCareerImages() {
  const fileNames = (await readdir(careerDir))
    .filter((fileName) => !fileName.startsWith("."))
    .toSorted((left, right) => left.localeCompare(right));
  const imageEntries = await Promise.all(
    fileNames.map(async (fileName) => {
      const publicPath = `/career/${fileName}`;
      const metadata = await createImageMetadata(path.join(careerDir, fileName));

      return [publicPath, metadata];
    }),
  );
  const images = Object.fromEntries(imageEntries);

  await writeFile(careerManifestPath, `${JSON.stringify({ images }, null, 2)}\n`, "utf8");
}

async function syncProfileImage() {
  const src = "/braden.jpg";
  const metadata = await createImageMetadata(path.join(publicDir, src));

  await writeFile(
    profileManifestPath,
    `${JSON.stringify({ src, ...metadata }, null, 2)}\n`,
    "utf8",
  );
}

await Promise.all([syncCareerImages(), syncProfileImage()]);
