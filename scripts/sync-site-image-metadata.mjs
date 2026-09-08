#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Helmlab } from "helmlab";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const imageSourceDir = path.join(projectRoot, "images", "source");
const careerSourceDir = path.join(imageSourceDir, "career");
const brandSourceDir = path.join(imageSourceDir, "brands");
const publicDir = path.join(projectRoot, "public");
const dataDir = path.join(projectRoot, "data");
const careerOutputDir = path.join(publicDir, "career", "generated");
const careerManifestPath = path.join(dataDir, "career-images.json");
const profileManifestPath = path.join(dataDir, "profile-image.json");
const careerMaxEdge = 384;
const careerViewerMaxEdge = 2048;
const profileMaxEdge = 144;
const supportedImageExtensions = new Set([".avif", ".jpg", ".jpeg", ".png", ".webp"]);
// These marks also appear in biography detail cards. Keep the social-only
// assets out of the career manifest, while letting the content entries use the
// same stable `/career/*` keys as the original timeline images.
const careerBrandFileNames = new Set([
  "cleo.png",
  "contentsquare.png",
  "isembard.png",
  "minecraft.png",
]);

/*
 * Bezel sampling.
 *
 * A logo is shown edge to edge inside a squircle, and the squircle is wrapped
 * by a ring painted with colour lifted out of the logo itself — the frame is
 * made of whatever material the icon is made of, and never paints over it. All
 * of that is measured here, at build time, and baked into the manifest as plain
 * hex, so the colour library never reaches the browser.
 *
 * Colour is read in Helmlab's LCh space rather than sRGB because every decision
 * below is really about lightness or chroma independently of hue, and only a
 * perceptual space lets those be moved without dragging the others along.
 */
const bezelSectorCount = 12;
const bezelSampleSize = 48;
/**
 * The sample annulus starts well inside the border. Most company icons are a
 * flat plate with the mark floating in the middle, so an annulus hugging the
 * outer pixels reads back one uniform colour and the ring has nothing to say.
 * Biting this far in lets an off-centre mark push its hue into the nearest
 * sector, which is where the variation in a logo like Theodo's actually lives.
 */
const bezelInnerRadius = 0.34;
/**
 * Peak chroma beneath which a logo has no colour of its own. Past this point the
 * dominant hue is being recovered from rounding error, and a bezel built on it
 * belongs to no icon at all — Thought Machine's pure greyscale mark resolved to
 * a confident teal before this guard existed.
 */
const bezelAchromaticChroma = 0.02;
/** What an achromatic logo borrows instead: the warm hue the ink scale is built on. */
const bezelPaperHue = 74;
/**
 * The ring sits on ivory paper, not on top of the icon, so it wants mid
 * lightness: dark enough to hold an edge against the sheet, light enough that
 * the gloss drawn over it still reads as light on glass. An earlier, paler band
 * all but vanished at nav size.
 */
const bezelRimMinLightness = 0.58;
const bezelRimMaxLightness = 0.85;
/**
 * The hairline is capped well below the paper's lightness so a white logo still
 * has an outline instead of dissolving into the sheet.
 */
const bezelEdgeMaxLightness = 0.68;

const helmlabGen = new Helmlab().gen;

function toHexChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function toHex(red, green, blue) {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

function toLch(hex) {
  const [lightness = 0, chroma = 0, hue = 0] = Array.from(
    helmlabGen.toLch(helmlabGen.fromHex(hex)),
  );

  return { chroma, hue, lightness };
}

function fromLch(lightness, chroma, hue) {
  return helmlabGen.toHex(helmlabGen.gamutMap(helmlabGen.fromLch([lightness, chroma, hue])));
}

function interpolateHue(from, to, t) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;

  return from + delta * t;
}

/**
 * Reads an image the same way the browser will: cropped square to `cover`, so a
 * sample's colour lines up with the stretch of image drawn in front of it.
 */
async function readSquarePixels(inputPath, size) {
  const { data } = await sharp(inputPath)
    .rotate()
    .ensureAlpha()
    .resize(size, size, { fit: "cover", position: "centre" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = [];

  for (let offset = 0; offset < data.length; offset += 4) {
    // Transparent corners belong to the icon's own rounded mask, not to its
    // colour, and averaging them in would drag every sector toward black.
    if (data[offset + 3] < 128) {
      continue;
    }

    const index = offset / 4;

    pixels.push({
      blue: data[offset + 2],
      green: data[offset + 1],
      red: data[offset],
      x: index % size,
      y: Math.floor(index / size),
    });
  }

  return pixels;
}

function readBezelPixels(inputPath) {
  return readSquarePixels(inputPath, bezelSampleSize);
}

/**
 * The colour a logo would name as its own.
 *
 * Weighted by chroma squared rather than by pixel count, because the colour a
 * logo is known by is rarely the colour most of it is made of: Theodo's icon is
 * 99% white card and the 1% that matters is the orange mark.
 */
function measureKeyHue(samples) {
  let x = 0;
  let y = 0;

  for (const { chroma, hue } of samples) {
    const weight = chroma * chroma;

    x += Math.cos((hue * Math.PI) / 180) * weight;
    y += Math.sin((hue * Math.PI) / 180) * weight;
  }

  if (x === 0 && y === 0) {
    return bezelPaperHue;
  }

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function accumulateSectors(pixels, lchFor) {
  const sectors = Array.from({ length: bezelSectorCount }, () => ({
    chroma: 0,
    lightness: 0,
    weight: 0,
    x: 0,
    y: 0,
  }));

  for (const pixel of pixels) {
    const u = ((pixel.x + 0.5) / bezelSampleSize) * 2 - 1;
    const v = ((pixel.y + 0.5) / bezelSampleSize) * 2 - 1;
    // Chebyshev distance, not Euclidean: the frame being filled is a square, so
    // "how close to the border" means the nearer of the two axes, not the radius.
    const distance = Math.max(Math.abs(u), Math.abs(v));

    if (distance < bezelInnerRadius) {
      continue;
    }

    // Angle measured from twelve o'clock clockwise, matching `conic-gradient`'s
    // own zero, so a sector lands on the arc of rim it was read from.
    let angle = Math.atan2(u, -v);

    if (angle < 0) {
      angle += Math.PI * 2;
    }

    const { chroma, hue, lightness } = lchFor(pixel);
    const index = Math.min(
      bezelSectorCount - 1,
      Math.floor((angle / (Math.PI * 2)) * bezelSectorCount),
    );
    const reach = 0.35 + (distance - bezelInnerRadius) / (1 - bezelInnerRadius);
    const weight = reach * (1 + chroma * 10);
    const sector = sectors[index];

    sector.chroma += chroma * weight;
    sector.lightness += lightness * weight;
    sector.weight += weight;
    sector.x += Math.cos((hue * Math.PI) / 180) * chroma * chroma;
    sector.y += Math.sin((hue * Math.PI) / 180) * chroma * chroma;
  }

  return sectors;
}

/**
 * Blurs the ring across neighbouring sectors. Twelve hard readings would render
 * as twelve facets; a logo's colour should bleed around its frame rather than
 * step around it, and this is cheaper and steadier than blurring in the browser.
 */
function smoothSectors(sectors, fallback) {
  const kernel = [0.25, 0.5, 0.25];

  return sectors.map((_, index) => {
    let chroma = 0;
    let lightness = 0;
    let x = 0;
    let y = 0;

    kernel.forEach((weight, offset) => {
      const neighbour = sectors[(index + offset - 1 + bezelSectorCount) % bezelSectorCount];
      const neighbourChroma = neighbour.weight
        ? neighbour.chroma / neighbour.weight
        : fallback.chroma;
      const neighbourHue =
        neighbour.x || neighbour.y
          ? ((Math.atan2(neighbour.y, neighbour.x) * 180) / Math.PI + 360) % 360
          : fallback.hue;

      chroma += neighbourChroma * weight;
      lightness +=
        (neighbour.weight ? neighbour.lightness / neighbour.weight : fallback.lightness) * weight;
      x += Math.cos((neighbourHue * Math.PI) / 180) * weight * neighbourChroma;
      y += Math.sin((neighbourHue * Math.PI) / 180) * weight * neighbourChroma;
    });

    return {
      chroma,
      hue: x || y ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : fallback.hue,
      lightness,
    };
  });
}

/** A memoised pixel → LCh reader; icons repeat a handful of colours thousands of times. */
function createLchReader() {
  const cache = new Map();

  return (pixel) => {
    const key = (pixel.red << 16) | (pixel.green << 8) | pixel.blue;
    let value = cache.get(key);

    if (!value) {
      value = toLch(toHex(pixel.red, pixel.green, pixel.blue));
      cache.set(key, value);
    }

    return value;
  };
}

async function createBezel(inputPath) {
  const pixels = await readBezelPixels(inputPath);

  if (pixels.length === 0) {
    return undefined;
  }

  const lchFor = createLchReader();
  const samples = pixels.map(lchFor);
  const peakChroma = samples.reduce((peak, sample) => Math.max(peak, sample.chroma), 0);
  const achromatic = peakChroma < bezelAchromaticChroma;
  const keyHue = achromatic ? bezelPaperHue : measureKeyHue(samples);

  let lightnessTotal = 0;
  let chromaTotal = 0;
  let weightTotal = 0;

  for (const { chroma, lightness } of samples) {
    const weight = 1 + chroma * 6;

    chromaTotal += chroma * weight;
    lightnessTotal += lightness * weight;
    weightTotal += weight;
  }

  const fallback = {
    chroma: achromatic ? 0 : chromaTotal / weightTotal,
    hue: keyHue,
    lightness: lightnessTotal / weightTotal,
  };
  const sectors = smoothSectors(accumulateSectors(pixels, lchFor), fallback);

  /*
   * Hue survives untouched and chroma very nearly so — those two are what make a
   * rim read as *this* logo's rim. Only lightness is moved: dark logos are
   * lifted toward the middle and light ones pulled gently down, so every ring
   * lands where it holds against both the paper and its own icon. An earlier
   * pass normalised all three into one narrow band and turned Cardiff's crimson
   * and Garry's Mod's cobalt into the same dusty mauve.
   */
  const toRimStop = ({ chroma, hue, lightness }) =>
    fromLch(
      Math.max(
        bezelRimMinLightness,
        Math.min(
          bezelRimMaxLightness,
          lightness < 0.5
            ? lightness + (0.5 - lightness) * 0.5
            : lightness - (lightness - 0.5) * 0.2,
        ),
      ),
      achromatic ? 0.014 : Math.max(0.04, Math.min(0.17, chroma * 1.15)),
      achromatic ? bezelPaperHue : interpolateHue(keyHue, hue, 0.85),
    );

  return {
    /*
     * The hairline that separates the squircle from the sheet, and the flat
     * colour behind the image. The latter matters for icons that carry their own
     * rounded mask: where their corners are cut away this shows through instead
     * of the paper, so our corner radius never has to agree with theirs.
     */
    edge: fromLch(
      Math.min(
        bezelEdgeMaxLightness,
        Math.max(0.4, fallback.lightness - (fallback.lightness - 0.5) * 0.6),
      ),
      achromatic ? 0.014 : Math.max(0.03, fallback.chroma * 1.05),
      keyHue,
    ),
    fill: fromLch(fallback.lightness, achromatic ? 0 : fallback.chroma, keyHue),
    rim: sectors.map(toRimStop),
  };
}

/*
 * Palette sampling.
 *
 * An image is also the source of the paint behind its career tooltip, so the
 * manifest carries the two or three pigments the picture is actually MADE of,
 * most telling first. The bezel above cannot answer this: it deliberately
 * normalises every ring into one narrow band of lightness and chroma, which is
 * exactly what turns Cardiff's crimson and Cleo's brown into the same dusty
 * rose once they are flattened.
 *
 * "Most telling" is not "most of it". A mark is known by its colour, and
 * Theodo's icon is white card around a chevron that covers a twentieth of it.
 * So samples are grouped by hue and lightness and the groups ranked by their
 * share of the picture lifted by a chroma boost — which puts the chevron
 * first and keeps the card behind it as the second, quieter pigment.
 */
const paletteSampleSize = 64;
const paletteHueSectors = 24;
const paletteLightnessBands = 4;
const paletteSize = 3;
/** Below this a sample has no hue of its own, and joins one achromatic group per band. */
const paletteAchromaticChroma = 0.02;
/** How hard chroma outranks area. Squared, so a vivid twentieth beats a flat half. */
const paletteChromaBoost = 12;
/**
 * Two pigments nearer than this are one pigment: the grid fragments a single
 * ink across neighbouring sectors, and a palette of three shades of the same
 * green tells the paint nothing a single green would not.
 */
const paletteMinDistance = 0.14;

function paletteGroupKey({ chroma, hue, lightness }) {
  const band = Math.min(paletteLightnessBands - 1, Math.floor(lightness * paletteLightnessBands));

  if (chroma < paletteAchromaticChroma) {
    return `grey:${band}`;
  }

  const sector = Math.floor((((hue % 360) + 360) % 360) / (360 / paletteHueSectors));

  return `${sector}:${band}`;
}

/** Perceptual gap between two pigments; hue only counts as far as chroma carries it. */
function paletteDistance(left, right) {
  const hueGap = Math.abs(((((right.hue - left.hue) % 360) + 540) % 360) - 180);
  const chroma = Math.min(left.chroma, right.chroma);

  return Math.hypot(
    left.lightness - right.lightness,
    (left.chroma - right.chroma) * 2,
    (hueGap / 180) * chroma * 4,
  );
}

function measurePalette(samples) {
  const groups = new Map();

  for (const sample of samples) {
    const key = paletteGroupKey(sample);
    const group = groups.get(key) ?? { chroma: 0, count: 0, lightness: 0, x: 0, y: 0 };

    group.chroma += sample.chroma;
    group.count += 1;
    group.lightness += sample.lightness;
    // Hue averaged as a chroma-weighted vector, so a near-grey member of a
    // sector cannot drag the group's hue anywhere.
    group.x += Math.cos((sample.hue * Math.PI) / 180) * sample.chroma;
    group.y += Math.sin((sample.hue * Math.PI) / 180) * sample.chroma;
    groups.set(key, group);
  }

  const ranked = Array.from(groups.values(), (group) => {
    const chroma = group.chroma / group.count;

    return {
      chroma,
      hue:
        group.x || group.y
          ? ((Math.atan2(group.y, group.x) * 180) / Math.PI + 360) % 360
          : bezelPaperHue,
      lightness: group.lightness / group.count,
      score: (group.count / samples.length) * (1 + chroma * paletteChromaBoost) ** 2,
    };
  }).toSorted((left, right) => right.score - left.score);

  const palette = [];

  for (const candidate of ranked) {
    if (palette.every((kept) => paletteDistance(kept, candidate) >= paletteMinDistance)) {
      palette.push(candidate);
    }

    if (palette.length === paletteSize) {
      break;
    }
  }

  return palette.map(({ chroma, hue, lightness }) => fromLch(lightness, chroma, hue));
}

async function createPalette(inputPath) {
  const pixels = await readSquarePixels(inputPath, paletteSampleSize);

  if (pixels.length === 0) {
    return undefined;
  }

  const lchFor = createLchReader();
  const palette = measurePalette(pixels.map(lchFor));

  return palette.length > 0 ? palette : undefined;
}

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
  const careerFileNames = (await readdir(careerSourceDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && supportedImageExtensions.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
  const brandFileNames = (await readdir(brandSourceDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        careerBrandFileNames.has(entry.name) &&
        supportedImageExtensions.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
  const imageSources = [
    ...careerFileNames.map((fileName) => ({ fileName, sourceDir: careerSourceDir })),
    ...brandFileNames.map((fileName) => ({ fileName, sourceDir: brandSourceDir })),
  ];

  await rm(careerOutputDir, { recursive: true, force: true });
  await mkdir(careerOutputDir, { recursive: true });

  const imageEntries = await Promise.all(
    imageSources.map(async ({ fileName, sourceDir }) => {
      // Career content keeps its existing source path as a stable manifest lookup key.
      const sourceKey = `/career/${fileName}`;
      const sourcePath = path.join(sourceDir, fileName);
      const { data, width, height } = await createOptimizedWebp(sourcePath, careerMaxEdge);
      const fingerprint = createHash("sha256").update(data).digest("hex").slice(0, 12);
      const outputFileName = `${path.parse(fileName).name}.${fingerprint}.webp`;
      const isViewerImage = fileName.includes("-explainer.");
      const viewerImage = isViewerImage
        ? await createOptimizedWebp(sourcePath, careerViewerMaxEdge)
        : undefined;
      const viewerFingerprint = viewerImage
        ? createHash("sha256").update(viewerImage.data).digest("hex").slice(0, 12)
        : undefined;
      const viewerOutputFileName = viewerFingerprint
        ? `${path.parse(fileName).name}.viewer.${viewerFingerprint}.webp`
        : undefined;
      // Sampled from the source rather than the resized copy: the bezel is read
      // with the same square `cover` crop the browser applies, so a sector lines
      // up with the arc of rim drawn over it whatever the source aspect was.
      const bezel = await createBezel(sourcePath);
      const palette = await createPalette(sourcePath);

      await Promise.all([
        writeFile(path.join(careerOutputDir, outputFileName), data),
        ...(viewerImage && viewerOutputFileName
          ? [writeFile(path.join(careerOutputDir, viewerOutputFileName), viewerImage.data)]
          : []),
      ]);

      const imageEntry = {};
      if (bezel) {
        imageEntry.bezel = bezel;
      }
      imageEntry.height = height;
      if (palette) {
        imageEntry.palette = palette;
      }
      imageEntry.src = `/career/generated/${outputFileName}`;
      imageEntry.width = width;
      if (viewerImage && viewerOutputFileName) {
        imageEntry.viewerHeight = viewerImage.height;
        imageEntry.viewerSrc = `/career/generated/${viewerOutputFileName}`;
        imageEntry.viewerWidth = viewerImage.width;
      }
      return [sourceKey, imageEntry];
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
