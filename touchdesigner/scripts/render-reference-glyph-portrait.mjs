// cspell:words ffmpeg fract greyscale Lanczos oxlint supersampling typogravure

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TOUCHDESIGNER_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_SOURCE_VIDEO = path.join(
  TOUCHDESIGNER_DIRECTORY,
  "input/braden-gelato-clean-loop-v2.mp4",
);
const DEFAULT_MATTE_VIDEO = path.join(
  TOUCHDESIGNER_DIRECTORY,
  "input/braden-gelato-clean-matte-loop-v2.mp4",
);
const PROP_SUPPORT = path.join(TOUCHDESIGNER_DIRECTORY, "assets/prop-support.png");
const REFERENCE_ATLAS = path.join(TOUCHDESIGNER_DIRECTORY, "assets/reference-glyph-atlas.png");

const WIDTH = 1200;
const HEIGHT = 800;
const SUPERSAMPLING = 2;
const MASTER_WIDTH = WIDTH * SUPERSAMPLING;
const MASTER_HEIGHT = HEIGHT * SUPERSAMPLING;
const FRAME_COUNT = 48;
const PORTRAIT_ZOOM = 1.13;
const PORTRAIT_OFFSET_X = 0.018;
const PORTRAIT_OFFSET_Y_TOP_LEFT = -0.031;
const GLYPH_COUNT = 936;
const ATLAS_COLUMNS = 32;
const ATLAS_CELL_SIZE = 32;
const PITCH_X = 5 * SUPERSAMPLING;
const PITCH_Y = 5.375 * SUPERSAMPLING;

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, y, salt = 0) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43_758.545_312_3);
}

function parseFrameIndices(value) {
  if (value === "all") {
    return Array.from({ length: FRAME_COUNT }, (_, index) => index + 1);
  }

  const frames = new Set();
  for (const part of value.split(",")) {
    const range = part.match(/^(\d+)-(\d+)$/);

    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);

      if (start > end) throw new Error(`Invalid descending frame range: ${part}`);
      for (let frame = start; frame <= end; frame += 1) frames.add(frame);
      continue;
    }

    if (!/^\d+$/.test(part)) throw new Error(`Invalid frame index: ${part}`);
    frames.add(Number.parseInt(part, 10));
  }

  const sorted = [...frames].toSorted((left, right) => left - right);
  if (sorted.length === 0 || sorted.some((frame) => frame < 1 || frame > FRAME_COUNT)) {
    throw new Error(`Frame indices must be between 1 and ${FRAME_COUNT}`);
  }

  return sorted;
}

function readOption(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseArguments() {
  const argumentsList = process.argv.slice(2);
  let frameIndices = [7];
  let keepMaster = false;
  let matteVideo = DEFAULT_MATTE_VIDEO;
  let outDirectory = "/private/tmp/braden-reference-glyph-render";
  let sourceVideo = DEFAULT_SOURCE_VIDEO;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === "--frame-indices") {
      frameIndices = parseFrameIndices(readOption(argumentsList, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--keep-master") {
      keepMaster = true;
      continue;
    }

    if (argument === "--matte-video") {
      matteVideo = path.resolve(readOption(argumentsList, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--out-dir") {
      outDirectory = path.resolve(readOption(argumentsList, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--source-video") {
      sourceVideo = path.resolve(readOption(argumentsList, index, argument));
      index += 1;
      continue;
    }

    if (argument === "--help") {
      console.log(`Usage: bun ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} [options]

Options:
  --out-dir PATH          Output directory (default: /private/tmp/braden-reference-glyph-render)
  --frame-indices LIST    One-based frames: 7, 1,7,25,43, 1-12, or all (default: 7)
  --source-video PATH     Override the 48-frame photographic source video
  --matte-video PATH      Override the registered 48-frame greyscale matte video
  --keep-master           Also retain each true 2400x1600 pre-downsample master
  --help                  Show this message`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { frameIndices, keepMaster, matteVideo, outDirectory, sourceVideo };
}

async function run(command, argumentsList) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ["ignore", "ignore", "pipe"] });
    let standardError = "";

    child.stderr.on("data", (chunk) => {
      standardError += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited ${code}: ${standardError.trim()}`));
      }
    });
  });
}

async function extractFrames(videoPath, frameIndices, outputPattern) {
  const expression = frameIndices.map((frameIndex) => `eq(n\\,${frameIndex - 1})`).join("+");
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-vf",
    `select=${expression}`,
    "-fps_mode",
    "passthrough",
    "-start_number",
    "1",
    outputPattern,
  ]);
}

async function loadRaw(file, options = {}) {
  let image = sharp(file);
  if (options.greyscale) image = image.greyscale();
  if (options.blur) image = image.blur(options.blur);
  if (options.removeAlpha) image = image.removeAlpha();
  return image.raw().toBuffer({ resolveWithObject: true });
}

function bilinear(buffer, width, height, channels, x, y, channel = 0) {
  const sampleX = clamp(x, 0, width - 1.001);
  const sampleY = clamp(y, 0, height - 1.001);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fractionX = sampleX - x0;
  const fractionY = sampleY - y0;
  const topLeft = buffer[(y0 * width + x0) * channels + channel];
  const topRight = buffer[(y0 * width + x1) * channels + channel];
  const bottomLeft = buffer[(y1 * width + x0) * channels + channel];
  const bottomRight = buffer[(y1 * width + x1) * channels + channel];
  const top = mix(topLeft, topRight, fractionX);
  const bottom = mix(bottomLeft, bottomRight, fractionX);
  return mix(top, bottom, fractionY);
}

function stageToSource(stageX, stageY) {
  return {
    x: ((stageX / WIDTH - 0.5) / PORTRAIT_ZOOM + 0.5 + PORTRAIT_OFFSET_X) * WIDTH,
    y: ((stageY / HEIGHT - 0.5) / PORTRAIT_ZOOM + 0.5 + PORTRAIT_OFFSET_Y_TOP_LEFT) * HEIGHT,
  };
}

function makeSourceLuma(source) {
  const luma = Buffer.alloc(WIDTH * HEIGHT);

  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    const sourceIndex = index * source.info.channels;
    luma[index] = Math.round(
      source.data[sourceIndex] * 0.2126 +
        source.data[sourceIndex + 1] * 0.7152 +
        source.data[sourceIndex + 2] * 0.0722,
    );
  }

  return luma;
}

function makeFrameSamplers({ matte, propSupport, sourceFar, sourceForm, sourceLuma, sourceNear }) {
  function subjectAt(stageX, stageY) {
    const point = stageToSource(stageX, stageY);
    const dynamic =
      bilinear(matte.data, WIDTH, HEIGHT, matte.info.channels, point.x, point.y) / 255;
    const support =
      bilinear(propSupport.data, WIDTH, HEIGHT, propSupport.info.channels, point.x, point.y) / 255;
    return smoothstep(0.04, 0.92, Math.max(dynamic, support));
  }

  function toneAt(stageX, stageY) {
    const point = stageToSource(stageX, stageY);
    const luma = bilinear(sourceLuma, WIDTH, HEIGHT, 1, point.x, point.y) / 255;
    const near =
      bilinear(sourceNear.data, WIDTH, HEIGHT, sourceNear.info.channels, point.x, point.y) / 255;
    const far =
      bilinear(sourceFar.data, WIDTH, HEIGHT, sourceFar.info.channels, point.x, point.y) / 255;
    const form =
      bilinear(sourceForm.data, WIDTH, HEIGHT, sourceForm.info.channels, point.x, point.y) / 255;
    const step = 3.25;
    const gradientX =
      (bilinear(sourceLuma, WIDTH, HEIGHT, 1, point.x + step, point.y) -
        bilinear(sourceLuma, WIDTH, HEIGHT, 1, point.x - step, point.y)) /
      255;
    const gradientY =
      (bilinear(sourceLuma, WIDTH, HEIGHT, 1, point.x, point.y + step) -
        bilinear(sourceLuma, WIDTH, HEIGHT, 1, point.x, point.y - step)) /
      255;
    const base = 1 - Math.pow(clamp(luma / 0.965), 0.56);
    const signedDetail = 1.12 * (near - luma) + 0.76 * (far - luma) + 0.38 * (form - luma);
    const navySeparation = (1 - smoothstep(0.18, 0.31, luma)) * smoothstep(0.022, 0.15, luma);

    return clamp(
      base + signedDetail + 0.18 * Math.hypot(gradientX, gradientY) - 0.11 * navySeparation,
    );
  }

  return { subjectAt, toneAt };
}

function sampleAtlas(atlas, glyphIndex, localX, localY) {
  const column = glyphIndex % ATLAS_COLUMNS;
  const row = Math.floor(glyphIndex / ATLAS_COLUMNS);
  const sampleX = column * ATLAS_CELL_SIZE + clamp(localX) * (ATLAS_CELL_SIZE - 1);
  const sampleY = row * ATLAS_CELL_SIZE + clamp(localY) * (ATLAS_CELL_SIZE - 1);
  return (
    bilinear(
      atlas.data,
      atlas.info.width,
      atlas.info.height,
      atlas.info.channels,
      sampleX,
      sampleY,
    ) / 255
  );
}

function buildCellField(subjectAt, toneAt) {
  const columns = Math.ceil(MASTER_WIDTH / PITCH_X) + 1;
  const rows = Math.ceil(MASTER_HEIGHT / PITCH_Y) + 1;
  const cells = Array.from({ length: columns * rows });

  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < columns; cellX += 1) {
      const stageX = ((cellX + 0.5) * PITCH_X) / SUPERSAMPLING;
      const stageY = ((cellY + 0.5) * PITCH_Y) / SUPERSAMPLING;
      cells[cellY * columns + cellX] = {
        flipX: hash2(cellX, cellY, 61.1) < 0.34,
        flipY: hash2(cellX, cellY, 67.8) < 0.17,
        glyphIndex: Math.floor(hash2(cellX, cellY, 56.7) * GLYPH_COUNT),
        jitterX: (hash2(cellX, cellY, 71.4) - 0.5) * 0.075,
        jitterY: (hash2(cellX, cellY, 76.3) - 0.5) * 0.06,
        marginX: mix(-0.02, 0.026, hash2(cellX, cellY, 81.2)),
        marginY: mix(-0.018, 0.024, hash2(cellX, cellY, 86.7)),
        matte: subjectAt(stageX, stageY),
        tone: toneAt(stageX, stageY),
        umberVariation: hash2(cellX, cellY, 103.9) - 0.5,
      };
    }
  }

  return { cells, columns };
}

function renderMaster(atlas, cellField, subjectAt) {
  const output = Buffer.alloc(MASTER_WIDTH * MASTER_HEIGHT * 4);

  for (let y = 0; y < MASTER_HEIGHT; y += 1) {
    const cellY = Math.floor(y / PITCH_Y);
    const localY = (y / PITCH_Y) % 1;

    for (let x = 0; x < MASTER_WIDTH; x += 1) {
      const cellX = Math.floor(x / PITCH_X);
      const localX = (x / PITCH_X) % 1;
      const cell = cellField.cells[cellY * cellField.columns + cellX];
      if (cell.matte < 0.002) continue;

      const sampleX = clamp((cell.flipX ? 1 - localX : localX) + cell.jitterX);
      const sampleY = clamp((cell.flipY ? 1 - localY : localY) + cell.jitterY);
      const carrier = sampleAtlas(atlas, cell.glyphIndex, sampleX, sampleY);
      const paperChannel =
        smoothstep(cell.marginX, cell.marginX + 0.043, localX) *
        smoothstep(cell.marginX, cell.marginX + 0.043, 1 - localX) *
        smoothstep(cell.marginY, cell.marginY + 0.041, localY) *
        smoothstep(cell.marginY, cell.marginY + 0.041, 1 - localY);
      const hierarchy = smoothstep(0.1, 0.9, cell.tone);
      const threshold = mix(0.58, 0.085, Math.pow(hierarchy, 0.95));
      const thickness = smoothstep(threshold - 0.085, threshold + 0.085, carrier);
      const mark = thickness * paperChannel * mix(0.48, 0.995, Math.pow(hierarchy, 1.05));
      const edgeMatte = subjectAt(x / SUPERSAMPLING, y / SUPERSAMPLING);
      const alpha = clamp(mark * Math.min(cell.matte, edgeMatte));
      if (alpha <= 0.001) continue;

      const depth = Math.pow(cell.tone, 0.76);
      const colour = [mix(116, 48, depth), mix(78, 36, depth), mix(50, 27, depth)];
      const desaturation = 0.5 * smoothstep(0.45, 0.82, cell.tone);
      const neutral = colour[0] * 0.2126 + colour[1] * 0.7152 + colour[2] * 0.0722;
      const variation = 1 - desaturation;
      const outputIndex = (y * MASTER_WIDTH + x) * 4;
      output[outputIndex] = Math.round(
        mix(colour[0], neutral, desaturation) + 5 * cell.umberVariation * variation,
      );
      output[outputIndex + 1] = Math.round(
        mix(colour[1], neutral, desaturation) + 2 * cell.umberVariation * variation,
      );
      output[outputIndex + 2] = Math.round(mix(colour[2], neutral, desaturation));
      output[outputIndex + 3] = Math.round(alpha * 255);
    }
  }

  return output;
}

async function renderFrame({
  atlas,
  frameIndex,
  keepMaster,
  mattePath,
  mastersDirectory,
  outputPath,
  propSupport,
  sourcePath,
}) {
  const startedAt = performance.now();
  const [source, sourceNear, sourceFar, sourceForm, matte] = await Promise.all([
    loadRaw(sourcePath, { removeAlpha: true }),
    loadRaw(sourcePath, { blur: 2.1, greyscale: true }),
    loadRaw(sourcePath, { blur: 10.5, greyscale: true }),
    loadRaw(sourcePath, { blur: 34, greyscale: true }),
    loadRaw(mattePath, { greyscale: true }),
  ]);
  const sourceLuma = makeSourceLuma(source);
  const { subjectAt, toneAt } = makeFrameSamplers({
    matte,
    propSupport,
    sourceFar,
    sourceForm,
    sourceLuma,
    sourceNear,
  });
  const cellField = buildCellField(subjectAt, toneAt);
  const masterBuffer = renderMaster(atlas, cellField, subjectAt);
  const master = sharp(masterBuffer, {
    raw: { channels: 4, height: MASTER_HEIGHT, width: MASTER_WIDTH },
  });
  const fileName = `frame-${String(frameIndex).padStart(3, "0")}.png`;

  if (keepMaster) {
    await master.clone().png({ compressionLevel: 9 }).toFile(path.join(mastersDirectory, fileName));
  }

  // This is the only portrait downsample: all carrier construction above happens at
  // the true 2400x1600 master, then Lanczos3 resolves the printed microstructure once.
  await master
    .resize(WIDTH, HEIGHT, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return Math.round(performance.now() - startedAt);
}

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function main() {
  const { frameIndices, keepMaster, matteVideo, outDirectory, sourceVideo } = parseArguments();
  const framesDirectory = path.join(outDirectory, "frames");
  const mastersDirectory = path.join(outDirectory, "masters-2400x1600");
  const decodeDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "braden-reference-glyph-decode-"),
  );

  await fs.mkdir(framesDirectory, { recursive: true });
  if (keepMaster) await fs.mkdir(mastersDirectory, { recursive: true });

  try {
    const sourcePattern = path.join(decodeDirectory, "source-%03d.png");
    const mattePattern = path.join(decodeDirectory, "matte-%03d.png");
    await Promise.all([
      extractFrames(sourceVideo, frameIndices, sourcePattern),
      extractFrames(matteVideo, frameIndices, mattePattern),
    ]);

    const [atlas, propSupport] = await Promise.all([
      loadRaw(REFERENCE_ATLAS, { greyscale: true }),
      loadRaw(PROP_SUPPORT, { greyscale: true }),
    ]);
    const timings = [];

    for (let decodedIndex = 0; decodedIndex < frameIndices.length; decodedIndex += 1) {
      const frameIndex = frameIndices[decodedIndex];
      const decodedName = String(decodedIndex + 1).padStart(3, "0");
      const outputPath = path.join(
        framesDirectory,
        `frame-${String(frameIndex).padStart(3, "0")}.png`,
      );
      // Rendering sequentially bounds the 2400x1600 RGBA working set for a full loop.
      // oxlint-disable-next-line no-await-in-loop
      const milliseconds = await renderFrame({
        atlas,
        frameIndex,
        keepMaster,
        mastersDirectory,
        mattePath: path.join(decodeDirectory, `matte-${decodedName}.png`),
        outputPath,
        propSupport,
        sourcePath: path.join(decodeDirectory, `source-${decodedName}.png`),
      });
      timings.push({ frameIndex, milliseconds, output: outputPath });
      console.log(
        `Rendered frame ${frameIndex}/${FRAME_COUNT} in ${(milliseconds / 1000).toFixed(2)}s`,
      );
    }

    const manifest = {
      carrier: {
        atlas: REFERENCE_ATLAS,
        atlasSha256: await sha256(REFERENCE_ATLAS),
        glyphCount: GLYPH_COUNT,
        identity: "stage-locked hash; source tone never selects glyph identity",
        pitchAtMaster: [PITCH_X, PITCH_Y],
      },
      composition: {
        offsetX: PORTRAIT_OFFSET_X,
        offsetYTopLeft: PORTRAIT_OFFSET_Y_TOP_LEFT,
        zoom: PORTRAIT_ZOOM,
      },
      frameIndices,
      input: {
        matte: matteVideo,
        matteSha256: await sha256(matteVideo),
        propSupport: PROP_SUPPORT,
        propSupportSha256: await sha256(PROP_SUPPORT),
        source: sourceVideo,
        sourceSha256: await sha256(sourceVideo),
      },
      output: {
        finalDimensions: [WIDTH, HEIGHT],
        keepMaster,
        masterDimensions: [MASTER_WIDTH, MASTER_HEIGHT],
        singleDownsample: "Lanczos3 2400x1600 -> 1200x800",
      },
      renderer: "B — reference glyph library + tonal hierarchy",
      timings,
      version: 1,
    };
    await fs.writeFile(
      path.join(outDirectory, "render-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await fs.rm(decodeDirectory, { force: true, recursive: true });
  }
}

await main();
