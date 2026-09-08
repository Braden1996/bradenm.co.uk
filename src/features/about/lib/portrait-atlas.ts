/** Each glyph owns its complete mip chain, down to one coverage sample. */
export const PORTRAIT_ATLAS_COLUMNS = 32;
export const PORTRAIT_ATLAS_CELL = 32;

/**
 * Turn the scanned marks into ink coverage before the GPU averages them.
 * A soft, rounded footprint removes the rectangular stamp edge without
 * introducing a new screen-space gutter. The same coverage is used at all
 * sizes. Four stroke weights occupy RGBA, so tone can blend between already
 * filtered coverages instead of applying a threshold to a minified glyph.
 */
export function portraitAtlasCoverage(rgba: Uint8ClampedArray) {
  const width = PORTRAIT_ATLAS_COLUMNS * PORTRAIT_ATLAS_CELL;
  if (rgba.length !== width * width * 4) throw new Error("Invalid portrait glyph atlas");
  const coverage = new Uint8Array(width * width * 4);
  const footprint = new Float32Array(PORTRAIT_ATLAS_CELL * PORTRAIT_ATLAS_CELL);
  for (let y = 0; y < PORTRAIT_ATLAS_CELL; y += 1) {
    for (let x = 0; x < PORTRAIT_ATLAS_CELL; x += 1) {
      const dx = Math.abs(((x + 0.5) / PORTRAIT_ATLAS_CELL - 0.5) * 2);
      const dy = Math.abs(((y + 0.5) / PORTRAIT_ATLAS_CELL - 0.5) * 2);
      const radius = (dx ** 4 + dy ** 4) ** 0.25;
      const edge = Math.max(0, Math.min(1, (radius - 0.84) / 0.16));
      footprint[y * PORTRAIT_ATLAS_CELL + x] = 1 - edge * edge * (3 - 2 * edge);
    }
  }
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const mask =
        footprint[(y % PORTRAIT_ATLAS_CELL) * PORTRAIT_ATLAS_CELL + (x % PORTRAIT_ATLAS_CELL)] ?? 0;
      const ink = (rgba[index * 4] ?? 0) / 255;
      for (let weight = 0; weight < 4; weight += 1) {
        const threshold = 0.56 - (0.42 * weight) / 3;
        const strength = Math.max(0, Math.min(1, (ink - threshold + 0.085) / 0.17));
        coverage[index * 4 + weight] = Math.round(
          strength * strength * (3 - 2 * strength) * mask * 255,
        );
      }
    }
  }
  return coverage;
}
