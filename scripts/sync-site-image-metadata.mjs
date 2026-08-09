#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const imageSourceDir = path.join(projectRoot, "images", "source");
const careerSourceDir = path.join(imageSourceDir, "career");
const publicDir = path.join(projectRoot, "public");
const dataDir = path.join(projectRoot, "data");
const careerOutputDir = path.join(publicDir, "career", "generated");
const careerManifestPath = path.join(dataDir, "career-images.json");
const profileManifestPath = path.join(dataDir, "profile-image.json");
const careerMaxEdge = 384;
const profileMaxEdge = 144;
const supportedImageExtensions = new Set([".avif", ".jpg", ".jpeg", ".png", ".webp"]);

async function createOptimizedWebp(inputPath, maxEdge) {
  const { data, info } = await sharp(inputPath)
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: 82,
      alphaQuality: 100,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  if (!width || !height) {
    throw new Error(`Missing dimensions for image: ${inputPath}`);
  }

  return {
    data,
    width,
    height,
  };
}

async function syncCareerImages() {
  const fileNames = (await readdir(careerSourceDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && supportedImageExtensions.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));

  await rm(careerOutputDir, { recursive: true, force: true });
  await mkdir(careerOutputDir, { recursive: true });

  const imageEntries = await Promise.all(
    fileNames.map(async (fileName) => {
      // Career content keeps its existing source path as a stable manifest lookup key.
      const sourceKey = `/career/${fileName}`;
      const { data, width, height } = await createOptimizedWebp(
        path.join(careerSourceDir, fileName),
        careerMaxEdge,
      );
      const fingerprint = createHash("sha256").update(data).digest("hex").slice(0, 12);
      const outputFileName = `${path.parse(fileName).name}.${fingerprint}.webp`;

      await writeFile(path.join(careerOutputDir, outputFileName), data);

      return [
        sourceKey,
        {
          src: `/career/generated/${outputFileName}`,
          width,
          height,
        },
      ];
    }),
  );
  const images = Object.fromEntries(imageEntries);

  await writeFile(careerManifestPath, `${JSON.stringify({ images }, null, 2)}\n`, "utf8");
}

async function syncProfileImage() {
  const src = "/braden.webp";
  const { data, width, height } = await createOptimizedWebp(
    path.join(imageSourceDir, "braden.jpg"),
    profileMaxEdge,
  );

  await writeFile(path.join(publicDir, src), data);

  await writeFile(
    profileManifestPath,
    `${JSON.stringify({ src, width, height }, null, 2)}\n`,
    "utf8",
  );
}

await Promise.all([syncCareerImages(), syncProfileImage()]);
