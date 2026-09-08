import { fbm2 } from "./paper-noise";

/*
 * The hand the painters share: deterministic rolls, the hand-laid wobble of
 * a brush edge, and the coarse lattices the per-pixel loops sample their slow
 * fields from. Pure maths on purpose — the block painter (paper-paint) and
 * the stroke painter (paper-stroke) both run at build time AND, for the
 * blocks, inside the portrait's WebGL boot, so nothing here may reach for a
 * platform API.
 */

/** An RGBA bake, row major, `width * height * 4` bytes. */
export type PaintedBitmap = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

// Aperiodic worley: the lattice period is far larger than any bake, so the
// cells never repeat within one image.
export const WORLEY_PERIOD = 2048;

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
};

/** Deterministic per-bake rolls; mulberry32 keeps build and client in step. */
export function createRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * The body of a hand-laid line: a 1/k² harmonic series (measured pen lines
 * hold 3-5 visible direction changes, never more — higher harmonics decay
 * fast enough that they read as texture, not as intent) over a sub-pixel
 * tremor floor. Sampled to a lookup so the per-pixel loop stays cheap; the
 * caller adds any bow, because a bow belongs to the whole stroke and not to
 * the edge.
 */
export function buildWobble(
  length: number,
  primary: number,
  harmonics: number,
  tremor: number,
  random: () => number,
  seed: number,
): Float32Array {
  const phases = Array.from({ length: harmonics }, () => random() * Math.PI * 2);
  const values = new Float32Array(Math.max(2, Math.ceil(length)));

  for (let index = 0; index < values.length; index += 1) {
    const t = index / (values.length - 1);
    let value = 0;

    for (let k = 1; k <= harmonics; k += 1) {
      value += (primary / (k * k)) * Math.sin(2 * Math.PI * k * t + (phases[k - 1] ?? 0));
    }

    value += tremor * (2 * fbm2(t * 30, seed * 13.7, 2, seed) - 1);
    values[index] = value;
  }

  return values;
}

/** Linear read of a lookup at a 0..1 position, clamped at both ends. */
export function sampleLookup(values: Float32Array, t: number) {
  const position = Math.min(1, Math.max(0, t)) * (values.length - 1);
  const low = Math.floor(position);
  const high = Math.min(values.length - 1, low + 1);
  const mix = position - low;

  return (values[low] ?? 0) * (1 - mix) + (values[high] ?? 0) * mix;
}

/** A coarse-lattice field with bilinear sampling, for the low-frequency noise. */
export function buildCoarseField(
  width: number,
  height: number,
  step: number,
  sample: (x: number, y: number) => number,
) {
  const columns = Math.ceil(width / step) + 2;
  const rows = Math.ceil(height / step) + 2;
  const values = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      values[row * columns + column] = sample(column * step, row * step);
    }
  }

  return (x: number, y: number) => {
    const fx = Math.min(columns - 2, Math.max(0, x / step));
    const fy = Math.min(rows - 2, Math.max(0, y / step));
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    const mx = fx - cx;
    const my = fy - cy;
    const base = cy * columns + cx;
    const top = (values[base] ?? 0) * (1 - mx) + (values[base + 1] ?? 0) * mx;
    const bottom =
      (values[base + columns] ?? 0) * (1 - mx) + (values[base + columns + 1] ?? 0) * mx;

    return top * (1 - my) + bottom * my;
  };
}

/**
 * The columns a bake actually painted: the first and last with any texel over
 * `minAlpha`, widened by `margin` each side and clamped to the bitmap. A
 * stroke's head and tail pad the box unevenly (a round cap here, a sputtered
 * taper there), so a consumer that stretches the bake under a word wants the
 * painted span, not the box, or the paint sits off-centre.
 */
export function trimTransparentColumns(
  bitmap: PaintedBitmap,
  minAlpha: number,
  margin: number,
): PaintedBitmap {
  const { height, pixels, width } = bitmap;
  let first = width;
  let last = -1;

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) > minAlpha) {
        first = Math.min(first, x);
        last = Math.max(last, x);
        break;
      }
    }
  }

  if (last < first) {
    return bitmap;
  }

  const left = Math.max(0, first - margin);
  const right = Math.min(width - 1, last + margin);
  const trimmedWidth = right - left + 1;
  const trimmed = new Uint8ClampedArray(trimmedWidth * height * 4);

  for (let y = 0; y < height; y += 1) {
    const from = (y * width + left) * 4;
    trimmed.set(pixels.subarray(from, from + trimmedWidth * 4), y * trimmedWidth * 4);
  }

  return { height, pixels: trimmed, width: trimmedWidth };
}
