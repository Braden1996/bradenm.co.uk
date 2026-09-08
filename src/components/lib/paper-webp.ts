import sharp from "sharp";
import type { PaintedBitmap } from "./paper-brush";

/*
 * Lossy WebP for the painted bakes. Build time only — it reaches for sharp
 * and must never be pulled into a client bundle.
 *
 * Soft gouache compresses to a fraction of lossless PNG with no visible cost,
 * and the bakes ship inline in the markup, so every byte is paid on every
 * route that carries the passage.
 */

export type EncodeWebpOptions = {
  /** Alpha plane quality, 0-100 (sharp's default is lossless alpha, 100). */
  alphaQuality: number;
  /**
   * Integer factor to shrink by before encoding; a bake rendered supersampled
   * lands on the page at its intended size with the tooth averaged down
   * instead of aliased.
   */
  downsample: number;
  /**
   * Memo key. The passage renders on many routes and Astro calls each
   * frontmatter per route, so the encode is done once per distinct bake —
   * callers pass a key that names the spec, typically its JSON. The encode
   * settings are folded in here, so the same bake at two qualities is two
   * entries.
   */
  key: string;
  /** Colour quality, 0-100. */
  quality: number;
};

const encoded = new Map<string, Promise<string>>();

/** Encode an RGBA bake as a WebP data URI, memoised by `options.key`. */
export function encodeRgbaWebp(bitmap: PaintedBitmap, options: EncodeWebpOptions): Promise<string> {
  const key = `${options.key}@q${options.quality}a${options.alphaQuality}d${options.downsample}`;
  const cached = encoded.get(key);

  if (cached) {
    return cached;
  }

  const pending = encode(bitmap, options);
  encoded.set(key, pending);

  return pending;
}

async function encode(bitmap: PaintedBitmap, options: EncodeWebpOptions) {
  let image = sharp(Buffer.from(bitmap.pixels), {
    raw: { channels: 4, height: bitmap.height, width: bitmap.width },
  });

  if (options.downsample > 1) {
    // sharp premultiplies before resampling, so the ragged alpha edge
    // averages toward the pigment underneath rather than toward black;
    // Mitchell keeps the tooth without ringing.
    image = image.resize({
      height: Math.max(1, Math.round(bitmap.height / options.downsample)),
      kernel: "mitchell",
      width: Math.max(1, Math.round(bitmap.width / options.downsample)),
    });
  }

  const webp = await image
    .webp({ alphaQuality: options.alphaQuality, quality: options.quality })
    .toBuffer();

  return `data:image/webp;base64,${webp.toString("base64")}`;
}
