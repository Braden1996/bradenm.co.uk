import { fbm2 } from "./paper-noise";

type PaperWashFrame = {
  time: number;
};

export type PaperWashOptions = {
  /**
   * Breaks up the stair steps an eight-bit ramp shows across so gentle a
   * gradient. Worth it on the live canvas; switched off for the baked frame,
   * where per-pixel noise is incompressible and costs far more in bytes than a
   * single ramp step is worth once the image has been scaled up.
   */
  dither?: boolean;
};

/** Structural rather than `ImageData`, so the build can render without a DOM. */
type PaperWashTarget = {
  data: Uint8ClampedArray;
};

export type PaperWashRenderer = {
  render: (image: PaperWashTarget, frame: PaperWashFrame) => void;
};

const bendScale = 1.15;
const bendOctaves = 2;
const bendAmount = 0.22;
const coverageBend = 0.16;
const coverageFloor = 0.04;
const coverageCeiling = 0.64;
const sweepGain = 1.06;
const sweepOffset = -0.04;
const sweepTilt = 0.2;
const driftRate = 0.021;
/*
 * The bends are sampled in the sheet's own normalized space rather than in
 * absolute field units, so they stretch with the window instead of staying
 * pinned to its bottom edge. That is what lets the whole wash be baked once at
 * build time and still match this renderer at every viewport size — anchored,
 * the two would only ever agree at the size the bake happened to assume. The
 * spans below are the field extents of a typical desktop sheet, so the
 * undulation keeps the scale it had while it was anchored.
 */
const bendSpanX = 1.6;
const bendSpanY = 1;

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

function hashPixel(x: number, y: number) {
  let hash = Math.imul(x, 0x27d4_eb2d) ^ Math.imul(y, 0x1656_67b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85eb_ca6b);

  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffff_ffff;
}

/**
 * A broad, soft gradient rather than a simulated wash.
 *
 * Two low-frequency noise fields do all the shaping: one gently bends the
 * diagonal sweep that drives colour, the other bends where the colour fades
 * back into bare paper. Both are deliberately large and shallow, so bands
 * undulate without breaking into the wispy fronts a turbulent field produces.
 * Colour itself comes from a lookup table baked at build time, so the perceptual
 * colour work that keeps the warm end reaching the cool end without passing
 * through grey costs the browser nothing.
 */
export function createPaperWashRenderer(
  width: number,
  height: number,
  ramp: Uint8Array,
  options: PaperWashOptions = {},
): PaperWashRenderer {
  const lastIndex = Math.max(0, Math.floor(ramp.length / 3) - 1);
  const { dither = true } = options;

  return {
    render(image, frame) {
      const { time } = frame;
      const drift = time * driftRate;
      const driftA = Math.sin(drift * 0.37) * 0.9;
      const driftB = Math.cos(drift * 0.28) * 0.8;
      const driftC = Math.sin(drift * 0.21 + 2.1) * 0.7;
      const pixels = image.data;

      for (let y = 0; y < height; y += 1) {
        const v = y / (height - 1);
        const row = y * width;
        const py = (v - 1) * bendSpanY * bendScale;
        const veilY = py * 0.7 + driftC;
        const bendY = py + driftB;

        for (let x = 0; x < width; x += 1) {
          const u = x / (width - 1);
          const px = (u - 0.5) * bendSpanX * bendScale;

          const bend = fbm2(px + driftA, bendY, bendOctaves, 11) - 0.5;
          const veilBend = fbm2(px * 0.7 + 4.3, veilY, bendOctaves, 29) - 0.5;

          const sweep = v * sweepGain + sweepOffset + (u - 0.5) * sweepTilt + bend * bendAmount;
          const coverage = smoothstep(coverageFloor, coverageCeiling, v + veilBend * coverageBend);

          // Dithering the ramp lookup rather than the output is what keeps the
          // correction below one step of the ramp itself.
          const jitter = dither ? hashPixel(x, y) - 0.5 : 0;
          const rampIndex = Math.max(
            0,
            Math.min(lastIndex, Math.round(Math.max(0, Math.min(1, sweep)) * lastIndex + jitter)),
          );
          const rampOffset = rampIndex * 3;
          const offset = (row + x) * 4;

          pixels[offset] = ramp[rampOffset] ?? 0;
          pixels[offset + 1] = ramp[rampOffset + 1] ?? 0;
          pixels[offset + 2] = ramp[rampOffset + 2] ?? 0;
          pixels[offset + 3] = Math.round(coverage * 255);
        }
      }
    },
  };
}
