/**
 * A logo's bezel: the colour its squircle ring is built out of.
 *
 * Measured at build time by `scripts/sync-site-image-metadata.mjs` and carried
 * through `data/career-images.json`. Everything here is plain sRGB hex, because
 * the perceptual colour library that derived it stays on the build side — see
 * `paper-gradient.ts` for the same arrangement.
 */
export type LogoBezel = {
  /**
   * The hairline between the ring and the sheet, held clear of the paper's own
   * lightness so a white logo still has an outline.
   */
  edge: string;
  /**
   * Flat colour behind the image. Icons that ship with their own rounded mask
   * show this through the corners they cut away, which is what frees our corner
   * radius from having to agree with theirs.
   */
  fill: string;
  /** The ring band, sampled clockwise from twelve o'clock. */
  rim: string[];
};

/**
 * Lays the sampled ring out as a conic sweep. `conic-gradient` starts at twelve
 * o'clock and runs clockwise, which is the order the stops were measured in, so
 * a sector lands on the arc of ring it was read from. The first stop is repeated
 * at 360deg to close the loop; without it the sweep snaps back across the last
 * arc instead of wrapping.
 */
export function createLogoBezelRim(rim: string[]) {
  if (rim.length === 0) {
    return undefined;
  }

  const step = 360 / rim.length;
  const stops = rim.map((colour, index) => `${colour} ${(index * step).toFixed(2)}deg`);

  return `conic-gradient(from 0deg, ${stops.join(", ")}, ${rim[0]} 360deg)`;
}
