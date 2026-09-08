import { periodicFbm2 } from "./paper-noise";

/*
 * A seamless sheet of matte cover stock — the ground the whole site sits on.
 * Built to the statistics of REAL paper rather than generic noise:
 *
 *  - "Formation" clouds carry ~2/3 of the variance: paper's cloudy grammage
 *    mottle is band-limited to the 2-9mm floc range (~8-34px here), a hump
 *    with roll-off both ways — never a scale-free fbm pyramid.
 *  - A darken-only skewed tone map: scanned stock has its histogram mode at
 *    paper-white with a dark tail only. Most texture lands within a few RGB
 *    levels; the shape, not the gain, is what reads as natural.
 *  - Sparse fibre flecks placed as a clumped Poisson process (variable
 *    per-cell counts, full jitter, power-law sizes, two coprime lattices) —
 *    one-point-per-cell speckle is precisely the polka-dot grid tell.
 *  - Whisper-level lit tooth, grain-direction fibre ridges and sheet-scale
 *    drift underneath, each band with one job.
 *
 * Pure maths — the Astro build encodes it to an image; nothing here ever
 * runs in the browser.
 */

/**
 * The tile's repeat in CSS px. Baked once at build time and shipped in the
 * markup, so the sheet is present from the first paint — no client repaint,
 * no refresh flicker.
 */
export const paperSheetTileSize = 448;

// Layer weights into the combined field (normalized to unit sigma after).
// Noise-forward on purpose: the sheet should be discovered, not seen — the
// fine tooth carries most of what registers, the clouds stay just under it.
const formationWeight = 0.8;
const toothWeight = 1;
const fibreWeight = 0.25;
const driftWeight = 0.35;

// The darken-only tone map: mode at near-white, dark tail, faint lightening.
const paperWhite = 0.997;
const darkTailDepth = 0.018;
const darkTailGamma = 1.15;
const lightLift = 0.007;

/** Per-pixel uncorrelated floor; without it the soft clouds band at 8 bits. */
const ditherAmplitude = 0.007;

/**
 * The sheet's overall strength, folded into the bake. The tile multiplies
 * straight onto the page shell now (no separate element to carry opacity),
 * and for multiply compositing a strength of s is exactly equivalent to
 * pulling every level s of the way toward white.
 */
const sheetStrength = 0.5;

function hashCell(x: number, y: number, seed: number) {
  let hash = Math.imul(x, 0x27d4_eb2d) ^ Math.imul(y, 0x1656_67b1) ^ Math.imul(seed, 0x9e37_79b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85eb_ca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2_ae35);

  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffff_ffff;
}

/** One octave of periodic value noise, signed. */
function band(u: number, v: number, cyclesX: number, cyclesY: number, seed: number) {
  return periodicFbm2(u * cyclesX, v * cyclesY, 1, cyclesX, cyclesY, seed) * 2 - 1;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
};

function sigma(values: Float32Array) {
  let sum = 0;
  let sumSquares = 0;

  for (const value of values) {
    sum += value;
    sumSquares += value * value;
  }

  const mean = sum / values.length;

  return Math.sqrt(Math.max(1e-12, sumSquares / values.length - mean * mean));
}

/**
 * Fleck scatter: a clumped Poisson process on two coprime lattices sharing
 * one clustering field. Half the cells are empty, positions take full-cell
 * jitter, radii follow a power-law skew, and distances wrap toroidally —
 * clumps and voids happen, a grid cannot. Sizes and darkness are truncated
 * so no single fleck is memorable enough to expose the 448px repeat.
 */
const fleckLattices = [
  { cells: 23, radius: 1.4, seed: 419 },
  { cells: 61, radius: 0.7, seed: 733 },
] as const;

function fleckDarkness(u: number, v: number, tile: number) {
  const clustering = periodicFbm2(u * 3, v * 3, 2, 3, 3, 907);
  let total = 0;

  for (const lattice of fleckLattices) {
    const cellX = Math.floor(u * lattice.cells);
    const cellY = Math.floor(v * lattice.cells);

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const gridX = cellX + offsetX;
        const gridY = cellY + offsetY;
        const wrappedX = ((gridX % lattice.cells) + lattice.cells) % lattice.cells;
        const wrappedY = ((gridY % lattice.cells) + lattice.cells) % lattice.cells;
        const cellRoll = hashCell(wrappedX, wrappedY, lattice.seed);
        const count = cellRoll < 0.72 ? 0 : cellRoll < 0.94 ? 1 : 2;

        for (let index = 0; index < count; index += 1) {
          const key = wrappedX * 7919 + wrappedY * 104_729 + index * 15_485_863;

          if (hashCell(key, 4, lattice.seed) > 0.25 + 0.75 * clustering) {
            continue;
          }

          const fleckU = (gridX + hashCell(key, 0, lattice.seed)) / lattice.cells;
          const fleckV = (gridY + hashCell(key, 1, lattice.seed)) / lattice.cells;
          const sizeRoll = hashCell(key, 2, lattice.seed);
          const radius = Math.min(2, lattice.radius * (0.5 + 2 * sizeRoll * sizeRoll));
          const darkness = Math.min(0.1, 0.035 + 0.055 * hashCell(key, 3, lattice.seed));
          let deltaU = Math.abs(u - fleckU);
          let deltaV = Math.abs(v - fleckV);
          deltaU = Math.min(deltaU, 1 - deltaU);
          deltaV = Math.min(deltaV, 1 - deltaV);
          const distance = Math.hypot(deltaU, deltaV) * tile;
          total += darkness * smoothstep(radius, 0.55 * radius, distance);
        }
      }
    }
  }

  return Math.min(total, 0.25);
}

/**
 * Fibre ridges: thin filaments where two stretched worley features compete
 * (F2 - F1 near zero), on 6:1 vertical cells so every strand agrees with
 * the sheet's grain direction, masked down to sparse patches.
 */
const fibreCellsX = 48;
const fibreCellsY = 8;

function fibreRidge(u: number, v: number) {
  const pointX = u * fibreCellsX;
  const pointY = v * fibreCellsY;
  const cellX = Math.floor(pointX);
  const cellY = Math.floor(pointY);
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  let nearestHash = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const gridX = cellX + offsetX;
      const gridY = cellY + offsetY;
      const wrappedX = ((gridX % fibreCellsX) + fibreCellsX) % fibreCellsX;
      const wrappedY = ((gridY % fibreCellsY) + fibreCellsY) % fibreCellsY;
      const featureX = gridX + hashCell(wrappedX, wrappedY, 271);
      const featureY = gridY + hashCell(wrappedX, wrappedY, 1249);
      const deltaX = featureX - pointX;
      const deltaY = featureY - pointY;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        nearestHash = hashCell(wrappedX, wrappedY, 3271);
      } else if (distance < second) {
        second = distance;
      }
    }
  }

  const ridge = smoothstep(0.06, 0, second - nearest);
  const mask = smoothstep(0.55, 0.65, periodicFbm2(u * 5, v * 5, 2, 5, 5, 1663));
  const sign = nearestHash < 0.5 ? -1 : 1;

  return sign * ridge * mask;
}

/**
 * The seamless sheet as straight RGBA pixels, paperSheetTileSize square.
 * Two passes: continuous fields first (so each register can be normalized to
 * its measured sigma), then the tone map, flecks and dither per pixel.
 */
export function renderPaperSheet() {
  const tile = paperSheetTileSize;
  const count = tile * tile;
  const formation = new Float32Array(count);
  const tooth = new Float32Array(count);
  const fibre = new Float32Array(count);
  const drift = new Float32Array(count);
  const texel = 1 / tile;

  for (let y = 0; y < tile; y += 1) {
    for (let x = 0; x < tile; x += 1) {
      const index = y * tile + x;
      const u = x / tile;
      const v = y / tile;

      // Formation clouds: periodic domain warp, three single-purpose bands
      // in the floc range with a mild vertical stretch, variance-modulated
      // so how mottled the sheet is itself varies.
      const warpU = u + 0.022 * (periodicFbm2(u * 3, v * 3, 2, 3, 3, 11) - 0.5);
      const warpV = v + 0.022 * (periodicFbm2(u * 3, v * 3, 2, 3, 3, 29) - 0.5);
      const clouds =
        band(warpU, warpV, 30, 25, 47) +
        0.6 * band(warpU, warpV, 13, 11, 89) +
        0.25 * band(warpU, warpV, 75, 62, 149);
      const patchiness = 1 + 0.3 * (band(u, v, 2, 2, 211) / 2);
      formation[index] = clouds * patchiness;

      // Lit tooth: the oblique-light DERIVATIVE of a fine height field, one
      // fixed azimuth — signed, oriented micro-grain, not symmetric static.
      const heightHere = periodicFbm2(u * 150, v * 100, 2, 150, 100, 331);
      const heightLit = periodicFbm2((u - texel) * 150, (v - texel) * 100, 2, 150, 100, 331);
      tooth[index] = heightLit - heightHere;

      fibre[index] = fibreRidge(u, v);
      drift[index] = band(u, v, 2, 1, 499);
    }
  }

  const toothSigma = sigma(tooth);
  const fibreSigma = sigma(fibre);
  const combined = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    combined[index] =
      formationWeight * (formation[index] ?? 0) +
      toothWeight * ((tooth[index] ?? 0) / toothSigma) +
      fibreWeight * ((fibre[index] ?? 0) / fibreSigma) +
      driftWeight * (drift[index] ?? 0);
  }

  const combinedSigma = sigma(combined);
  const pixels = new Uint8ClampedArray(count * 4);

  for (let y = 0; y < tile; y += 1) {
    for (let x = 0; x < tile; x += 1) {
      const index = y * tile + x;
      const n = (combined[index] ?? 0) / combinedSigma;
      let value =
        paperWhite -
        darkTailDepth * Math.pow(Math.max(-n, 0), darkTailGamma) +
        lightLift * Math.max(n, 0);
      value -= fleckDarkness(x / tile, y / tile, tile);
      value += (hashCell(x, y, 5) - 0.5) * 2 * ditherAmplitude;
      value = Math.min(1, Math.max(0, value));

      const level = Math.round(255 - sheetStrength * (1 - value) * 255);
      const offset = index * 4;
      pixels[offset] = level;
      pixels[offset + 1] = level;
      pixels[offset + 2] = level;
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}
