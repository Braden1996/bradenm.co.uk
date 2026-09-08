/**
 * The three wash anchor colours, shared by the footer wash gradient and the
 * about portrait's collage blocks. A standalone module (rather than living in
 * paper-gradient) because the blocks need these hexes CLIENT-side — the
 * gradient module reaches for Helmlab, which must never ship to the browser.
 */
export const paperWashAccents = {
  green: "#96b6a8",
  blue: "#3d82ad",
  orange: "#eec7a2",
} as const;

/**
 * The wash ramp's own in-between stops, top of the sheet to base: ivory is
 * the canvas itself, shell and clay carry the warm half, dust is the
 * warm-to-cool bridge, slate and sky the cool half. Named here so the ramp
 * (paper-gradient) and the painted underlines (paper-stroke's pigment sets)
 * agree on one palette rather than repeating the hexes.
 */
export const paperWashTints = {
  ivory: "#f5efe4",
  shell: "#f3e0c8",
  clay: "#d3ac97",
  dust: "#b0a49c",
  slate: "#7595a3",
  sky: "#4c92aa",
  // The green ink thinned with water — the pale end of the foot wash, a
  // little under halfway from the green to the ivory.
  mint: "#c4d5c8",
} as const;
