// cspell:words faststart libvips libx264 vsync

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const execute = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_OUTPUT = "/private/tmp/braden-clean-motion-v2-continuity";
const WIDTH = 1200;
const HEIGHT = 800;
const FRAME_COUNT = 48;
const FPS = 12;

const CAVITY_OPACITY = [
  0.55,
  0.72,
  0.88,
  ...Array.from({ length: 39 }, () => 1),
  0.92,
  0.82,
  0.72,
  0.63,
  0.57,
  0.55,
];

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

function manifestPath(file) {
  const relative = path.relative(REPOSITORY, file);
  return relative.startsWith("../") ? file : relative;
}

async function clearPngs(directory) {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".png"))
      .map((entry) => fs.unlink(path.join(directory, entry))),
  );
}

async function buildCavityPatch(rawSource) {
  const localMask = await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="520" height="520">
        <ellipse cx="275" cy="335" rx="58" ry="46" fill="white" />
      </svg>
    `),
  )
    .blur(5)
    .png()
    .toBuffer();
  const localPatch = await sharp(rawSource)
    .resize(520, 520, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .composite([{ blend: "dest-in", input: localMask }])
    .png()
    .toBuffer();
  const authoredPatch = await sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 1023,
      width: 1537,
    },
  })
    .composite([{ input: localPatch, left: 640, top: 480 }])
    .png()
    .toBuffer();

  return sharp(authoredPatch)
    .resize(1200, 800, { fit: "fill", kernel: "lanczos3" })
    .resize(1560, 880, { fit: "fill", kernel: "lanczos3" })
    .extract({ height: 800, left: 253, top: 12, width: 1200 })
    .png()
    .toBuffer();
}

async function patchWithOpacity(patch, opacity) {
  if (opacity === 1) {
    return patch;
  }
  const opacityMask = await sharp({
    create: {
      background: { alpha: opacity, b: 255, g: 255, r: 255 },
      channels: 4,
      height: HEIGHT,
      width: WIDTH,
    },
  })
    .png()
    .toBuffer();
  return sharp(patch)
    .composite([{ blend: "dest-in", input: opacityMask }])
    .png()
    .toBuffer();
}

async function main() {
  if (CAVITY_OPACITY.length !== FRAME_COUNT) {
    throw new Error("The cavity opacity schedule must contain exactly 48 frames");
  }

  const output = path.resolve(argumentValue("--output-dir", DEFAULT_OUTPUT));
  if (!output.startsWith("/private/tmp/")) {
    throw new Error("The continuity build directory must be inside /private/tmp");
  }
  const baseVideo = path.resolve(
    argumentValue(
      "--base-video",
      path.join(REPOSITORY, "touchdesigner/input/braden-gelato-clean-loop-v2-base.mp4"),
    ),
  );
  const suppliedBaseFrameDirectory = argumentValue("--base-frame-dir", "");
  const baseFrameDirectory = suppliedBaseFrameDirectory
    ? path.resolve(suppliedBaseFrameDirectory)
    : undefined;
  const baseMatteVideo = path.resolve(
    argumentValue(
      "--base-matte-video",
      path.join(REPOSITORY, "touchdesigner/input/braden-gelato-clean-matte-loop-v2-base.mp4"),
    ),
  );
  const baseMotionManifest = path.resolve(
    argumentValue(
      "--base-manifest",
      path.join(REPOSITORY, "touchdesigner/input/clean-motion-v2-base-manifest.json"),
    ),
  );
  const cavitySource = path.join(
    REPOSITORY,
    "images/source/about-motion/keyframes/v2/raw/cup-depleted.png",
  );
  const baseFrames = path.join(output, "base-frames");
  const sourceFrames = path.join(output, "source-frames");
  const matteFrames = path.join(output, "matte-frames");
  await Promise.all([
    ...(baseFrameDirectory ? [] : [clearPngs(baseFrames)]),
    clearPngs(sourceFrames),
    clearPngs(matteFrames),
  ]);

  await Promise.all([
    ...(baseFrameDirectory
      ? []
      : [
          execute("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            baseVideo,
            "-vsync",
            "0",
            "-start_number",
            "1",
            "-y",
            path.join(baseFrames, "frame-%03d.png"),
          ]),
        ]),
    execute("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      baseMatteVideo,
      "-vsync",
      "0",
      "-start_number",
      "1",
      "-y",
      path.join(matteFrames, "frame-%03d.png"),
    ]),
  ]);

  const cavityPatch = await buildCavityPatch(cavitySource);
  await fs.writeFile(path.join(output, "chocolate-cavity.png"), cavityPatch);
  const opacityPatches = new Map();
  for (const opacity of new Set(CAVITY_OPACITY)) {
    // Render sequentially to bound libvips memory while retaining each small reusable variant.
    // eslint-disable-next-line no-await-in-loop
    opacityPatches.set(opacity, await patchWithOpacity(cavityPatch, opacity));
  }

  for (let index = 1; index <= FRAME_COUNT; index += 1) {
    const name = `frame-${String(index).padStart(3, "0")}.png`;
    // Keep 48 full-resolution composites sequential so the offline build has a stable memory ceiling.
    // eslint-disable-next-line no-await-in-loop
    await sharp(path.join(baseFrameDirectory ?? baseFrames, name))
      .ensureAlpha()
      .composite([{ blend: "over", input: opacityPatches.get(CAVITY_OPACITY[index - 1]) }])
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(path.join(sourceFrames, name));
  }

  const sourceVideo = path.join(output, "braden-gelato-clean-loop-v2.mp4");
  const matteVideo = path.join(output, "braden-gelato-clean-matte-loop-v2.mp4");
  await execute("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    path.join(sourceFrames, "frame-%03d.png"),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "8",
    "-g",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    sourceVideo,
  ]);
  await fs.copyFile(baseMatteVideo, matteVideo);

  const frameNames = Array.from(
    { length: FRAME_COUNT },
    (_, index) => `frame-${String(index + 1).padStart(3, "0")}.png`,
  );
  const sourceFrameHashes = Object.fromEntries(
    await Promise.all(
      frameNames.map(async (name) => [name, await sha256(path.join(sourceFrames, name))]),
    ),
  );
  const baseFrameHashes = baseFrameDirectory
    ? Object.fromEntries(
        await Promise.all(
          frameNames.map(async (name) => [name, await sha256(path.join(baseFrameDirectory, name))]),
        ),
      )
    : undefined;
  const manifest = {};
  if (baseFrameHashes) {
    manifest.base_frames = { directory: baseFrameDirectory, sha256: baseFrameHashes };
  }
  Object.assign(manifest, {
    base_matte_video: { file: manifestPath(baseMatteVideo), sha256: await sha256(baseMatteVideo) },
    base_motion_manifest: {
      file: manifestPath(baseMotionManifest),
      sha256: await sha256(baseMotionManifest),
    },
    base_video: { file: manifestPath(baseVideo), sha256: await sha256(baseVideo) },
    cavity_opacity: CAVITY_OPACITY,
    cavity_patch: {
      file: "chocolate-cavity.png",
      sha256: await sha256(path.join(output, "chocolate-cavity.png")),
    },
    cavity_source: { file: manifestPath(cavitySource), sha256: await sha256(cavitySource) },
    fps: FPS,
    frame_count: FRAME_COUNT,
    height: HEIGHT,
    method:
      "The independently approved clean motion remains pixel-identical outside one feathered chocolate-cavity patch when built from its PNG sequence. The patch deepens after the scoop and returns to the same partial state at both sides of the loop seam.",
    source_frames: sourceFrameHashes,
    source_video: { file: path.basename(sourceVideo), sha256: await sha256(sourceVideo) },
    matte_video: { file: path.basename(matteVideo), sha256: await sha256(matteVideo) },
    width: WIDTH,
  });
  await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(output);
}

await main();
