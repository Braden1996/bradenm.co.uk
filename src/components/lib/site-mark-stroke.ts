import { paperWashAccents } from "./paper-accents";
import { bakeStrokeImage } from "./paper-stroke-image";

/*
 * The letterhead's painted strokes share one weight and texture. Tabs choose
 * their own pigments from the body link palette; other marks keep the green
 * to peach ramp of the foot wash. Encodes are memoised by spec (paper-webp).
 *
 * Sized in em of the capitals it sits under: 12px caps at 2 device px,
 * supersampled 2×, so the bake is 4 texels per CSS px. It is pulled ~9 caps
 * wide (0.72em each) and 0.4em tall with a 0.13em core, then stretched by the
 * CSS to whatever word or tab it underlines — a low-frequency stroke tolerates
 * that within a wide margin.
 */
const SUPERSAMPLE = 2;
const TEXELS_PER_EM = 11.87 * 2 * SUPERSAMPLE;
const HEIGHT_EM = 0.4;

/**
 * The line as an inline style: the bake, plus the plain ramp it falls back to
 * should the bake ever be absent. The custom properties are read by whoever
 * paints it (`--site-mark-stroke`, `--site-mark-start`, `--site-mark-end`).
 */
export async function siteMarkStrokeStyle(
  pigments: readonly [string, string] = [paperWashAccents.green, paperWashAccents.orange],
) {
  const stroke = await bakeStrokeImage(
    {
      alpha: 0.85,
      height: Math.round(HEIGHT_EM * TEXELS_PER_EM),
      load: 1.2,
      pigments,
      scale: 2.2,
      seed: 131,
      thickness: 0.13 * TEXELS_PER_EM,
      width: Math.round(9 * 0.72 * TEXELS_PER_EM),
    },
    SUPERSAMPLE,
  );

  return [
    `--site-mark-stroke:url("${stroke}")`,
    `--site-mark-start:${pigments[0]}`,
    `--site-mark-end:${pigments[1]}`,
  ].join(";");
}
