// Matte plumbing for the text-flow silhouette bake. The union of the motion
// mattes reserves enough space for every pose in the portrait sequence.
import { readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "../..");

// Media (matte) space is 1200x800 and sits in the stage's central band.
export const MEDIA_WIDTH = 1200;
const MEDIA_HEIGHT = 800;
export const STAGE_WIDTH = 1440;
export const STAGE_HEIGHT = 800;
export const MEDIA_TO_STAGE_X = (STAGE_WIDTH - MEDIA_WIDTH) / 2;

const matteDirectory = path.join(
  projectRoot,
  "images/source/about-motion/keyframes/v2/matte-sequence",
);

const propSupportPath = path.join(
  projectRoot,
  "images/source/about-motion/packed/prop-support.png",
);

async function readMatteChannel(filePath) {
  const { data, info } = await sharp(filePath)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== MEDIA_WIDTH || info.height !== MEDIA_HEIGHT) {
    throw new Error(`${filePath} is ${info.width}x${info.height}, expected 1200x800`);
  }

  return data;
}

/**
 * The per-pixel maximum over all motion-frame mattes: the union of everywhere
 * the moving body ever reaches, so nothing laid out against it is touched or
 * uncovered mid-animation. Pass `includeProps: true` to also fold in the
 * fixed prop matte (cup and upright utensils) — the props are part of the
 * printed subject even though they never move.
 */
export async function loadMatteUnion({ includeProps = false } = {}) {
  const frames = readdirSync(matteDirectory)
    .filter((name) => name.endsWith(".png"))
    .toSorted();

  if (frames.length === 0) {
    throw new Error(`No matte frames found in ${matteDirectory}`);
  }

  const sources = frames.map((frame) => path.join(matteDirectory, frame));

  if (includeProps) {
    sources.push(propSupportPath);
  }

  const union = new Uint8Array(MEDIA_WIDTH * MEDIA_HEIGHT);
  const reads = await Promise.all(sources.map((source) => readMatteChannel(source)));

  for (const data of reads) {
    for (let index = 0; index < union.length; index += 1) {
      if (data[index] > union[index]) {
        union[index] = data[index];
      }
    }
  }

  return { frameCount: frames.length, union };
}
