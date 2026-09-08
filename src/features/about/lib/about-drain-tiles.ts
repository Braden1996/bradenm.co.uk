import { periodicFbm2 } from "../../../components/lib/paper-noise";
import { encodeRgbaPng } from "../../../components/lib/paper-png";
import { generatedAsset, type GeneratedAsset } from "../../../components/lib/generated-asset";

/*
 * The paper's thirst, baked. What eats the ink off the sheet when the letter
 * gives way to the shelf is three seamless fields of noise, each cut to a hard
 * yes/no at build time, laid over the page as mask layers and opened one after
 * another behind a travelling front (about-template's mask, driven by
 * about-rooms).
 *
 * Baked rather than computed because a CSS mask has no threshold operator:
 * masks can be added and intersected, and nothing else. An SVG filter CAN
 * threshold live noise per pixel and it is the better-looking thing, but it
 * costs roughly ten times as much in WebKit — a screenful of text under one
 * runs at single-figure frame rates there even with the turbulence held still.
 * Three cut tiles buy the same read at the price of three images.
 *
 * Three SCALES, not three thresholds of one field: independent fields multiply
 * (0.62 × 0.58 × 0.55 ≈ 0.2 of the ink survives all three), where nested cuts
 * of a single field would stall around the first one's keep fraction and leave
 * the page half-inked at the end of the run. The sizes are chosen against what
 * the eye is reading — a phrase, an x-height, a stroke — so the ink comes away
 * in blotches, then in bites out of the words, then off the stems themselves.
 */

type DrainField = {
  key: "coarse" | "mid" | "fine";
  /** Fraction of the field kept after the cut. */
  keep: number;
  octaves: number;
  /** Noise cells per CSS pixel: the reciprocal is the feature size. */
  scale: number;
  seed: number;
  tile: number;
};

const FIELDS: readonly DrainField[] = [
  // ~50px features: whole phrases lift at once.
  { key: "coarse", keep: 0.62, octaves: 3, scale: 0.02, seed: 613, tile: 256 },
  // ~18px: about an x-height, so words are bitten into.
  { key: "mid", keep: 0.58, octaves: 3, scale: 0.055, seed: 977, tile: 256 },
  // ~7px: the width of a stem, which is what cuts letters through.
  { key: "fine", keep: 0.55, octaves: 2, scale: 0.15, seed: 331, tile: 192 },
];

function field({ octaves, scale, seed, tile }: DrainField) {
  const values = new Float32Array(tile * tile);

  for (let y = 0; y < tile; y += 1) {
    for (let x = 0; x < tile; x += 1) {
      values[y * tile + x] = periodicFbm2(
        x * scale,
        y * scale,
        octaves,
        tile * scale,
        tile * scale,
        seed,
      );
    }
  }

  return values;
}

/*
 * The cut. The level is taken from the field's own sorted values rather than
 * from a fixed number, so `keep` means what it says whatever the noise happens
 * to do — an fbm's distribution is not uniform, and a literal 0.5 would keep
 * wildly different fractions at different octave counts.
 *
 * The field rides in the ALPHA channel: `mask-mode` defaults to `match-source`,
 * which for a PNG resolves to alpha, and the tiles are seamless because
 * periodicFbm2 is periodic — not because of any engine's tiling cleverness.
 */
function cut(values: Float32Array, tile: number, keep: number) {
  const sorted = values.toSorted();
  const level = sorted[Math.floor((1 - keep) * (sorted.length - 1))] ?? 0.5;
  const pixels = new Uint8ClampedArray(tile * tile * 4);

  for (let index = 0; index < values.length; index += 1) {
    pixels[index * 4 + 3] = (values[index] ?? 0) >= level ? 255 : 0;
  }

  return encodeRgbaPng(pixels, tile, tile);
}

type DrainTiles = {
  coarse: GeneratedAsset;
  fine: GeneratedAsset;
  mid: GeneratedAsset;
  /** The px size each tile is painted at, in the order the mask lists them. */
  sizes: { coarse: number; fine: number; mid: number };
};

let baked: DrainTiles | undefined;

/** The unchanged cut fields are requested only when a full scrub is prepared. */
export function getDrainAssets(): DrainTiles {
  if (baked) {
    return baked;
  }

  const [coarse, mid, fine] = FIELDS;

  if (!coarse || !mid || !fine) {
    throw new Error("about-drain-tiles: the three fields are not three fields");
  }

  const asset = (spec: DrainField) => {
    const dataUri = cut(field(spec), spec.tile, spec.keep);
    return generatedAsset(
      `room-drain-${spec.key}.png`,
      Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"),
      "image/png",
    );
  };
  baked = {
    coarse: asset(coarse),
    fine: asset(fine),
    mid: asset(mid),
    sizes: { coarse: coarse.tile, fine: fine.tile, mid: mid.tile },
  };

  return baked;
}
