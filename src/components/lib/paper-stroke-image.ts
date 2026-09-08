import { trimTransparentColumns } from "./paper-brush";
import { type PaintedStrokeSpec, renderPaintedStroke } from "./paper-stroke";
import { encodeRgbaWebp } from "./paper-webp";

/*
 * A painted stroke as a WebP data URI. Build time only (sharp); the
 * underlines and the motto bar bake through here in their frontmatter.
 */

// Soft paint survives aggressive lossy settings; the strokes are small and
// ship inline on every route that carries the passage, so bytes matter.
const STROKE_QUALITY = 80;
const STROKE_ALPHA_QUALITY = 80;
// The bake is cut to its painted span before encoding, so the CSS that
// stretches it under a word lands the paint on the word: a stroke's round
// head and sputtered tail pad the box unevenly and would otherwise sit the
// paint left of centre. Texels fainter than this are the tail's last breath.
const TRIM_MIN_ALPHA = 10;
const TRIM_MARGIN_TEXELS = 2;

/**
 * Render `spec` (already sized in supersampled texels) and encode it at
 * 1 / supersample of its size, so the tooth averages down instead of aliasing.
 */
export function bakeStrokeImage(spec: PaintedStrokeSpec, supersample: number): Promise<string> {
  const bitmap = trimTransparentColumns(
    renderPaintedStroke(spec),
    TRIM_MIN_ALPHA,
    TRIM_MARGIN_TEXELS,
  );

  return encodeRgbaWebp(bitmap, {
    alphaQuality: STROKE_ALPHA_QUALITY,
    downsample: supersample,
    key: `${JSON.stringify(spec)}@${supersample}`,
    quality: STROKE_QUALITY,
  });
}
