import { describe, expect, test } from "bun:test";
import { paperWashAccents, paperWashTints } from "../src/components/lib/paper-accents";
import { parseHex } from "../src/components/lib/paper-pigment";
import { type PaintedStrokeSpec, renderPaintedStroke } from "../src/components/lib/paper-stroke";

const thin: PaintedStrokeSpec = {
  alpha: 0.78,
  height: 24,
  load: 1.3,
  pigments: [paperWashAccents.green, paperWashTints.sky],
  scale: 2.2,
  seed: 211,
  thickness: 10,
  width: 300,
};

const foot: PaintedStrokeSpec = {
  alpha: 0.82,
  height: 140,
  load: 1.05,
  pigments: [paperWashAccents.green, paperWashAccents.blue, paperWashAccents.orange],
  reverse: true,
  scale: 1,
  seed: 139,
  thickness: 88,
  width: 1160,
};

type Bitmap = ReturnType<typeof renderPaintedStroke>;

const alphaAt = (bitmap: Bitmap, x: number, y: number) =>
  bitmap.pixels[(y * bitmap.width + x) * 4 + 3] ?? 0;

function columnHasPaint(bitmap: Bitmap, x: number) {
  for (let y = 0; y < bitmap.height; y += 1) {
    if (alphaAt(bitmap, x, y) > 0) {
      return true;
    }
  }

  return false;
}

function rowHasPaint(bitmap: Bitmap, y: number) {
  for (let x = 0; x < bitmap.width; x += 1) {
    if (alphaAt(bitmap, x, y) > 0) {
      return true;
    }
  }

  return false;
}

function meanAlpha(bitmap: Bitmap, fromX: number, toX: number) {
  let total = 0;
  let count = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      total += alphaAt(bitmap, x, y);
      count += 1;
    }
  }

  return total / count;
}

const toLinear = (channel: number) =>
  channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** Alpha-weighted mean colour of a column range, in linear RGB. */
function meanLinearRgb(bitmap: Bitmap, fromX: number, toX: number) {
  const sum = [0, 0, 0];
  let weight = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      const offset = (y * bitmap.width + x) * 4;
      const alpha = bitmap.pixels[offset + 3] ?? 0;

      if (alpha === 0) {
        continue;
      }

      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] =
          (sum[channel] ?? 0) + alpha * toLinear((bitmap.pixels[offset + channel] ?? 0) / 255);
      }

      weight += alpha;
    }
  }

  return sum.map((value) => value / weight);
}

/** Linear RGB divided by its sum: the colour's hue and saturation without its lightness. */
function chromaticity(rgb: readonly number[]) {
  const sum = (rgb[0] ?? 0) + (rgb[1] ?? 0) + (rgb[2] ?? 0);

  return rgb.map((channel) => channel / Math.max(1e-6, sum));
}

/**
 * Distance in chromaticity. The glaze deepens dense paint in-hue, so a
 * pooled head is much darker than its pigment but still the same colour;
 * a plain RGB distance would call a dark green "blue".
 */
function chromaticityDistance(rgb: number[], hex: string) {
  const from = chromaticity(rgb);
  const target = chromaticity(parseHex(hex).map(toLinear));

  return Math.hypot(
    (from[0] ?? 0) - (target[0] ?? 0),
    (from[1] ?? 0) - (target[1] ?? 0),
    (from[2] ?? 0) - (target[2] ?? 0),
  );
}

describe("renderPaintedStroke", () => {
  test("is deterministic for one spec and distinct across seeds", () => {
    const first = renderPaintedStroke(thin);
    const again = renderPaintedStroke({ ...thin });
    const other = renderPaintedStroke({ ...thin, seed: thin.seed + 1 });

    expect(again.pixels).toEqual(first.pixels);
    expect(Buffer.from(other.pixels).equals(Buffer.from(first.pixels))).toBe(false);
  });

  for (const [name, spec] of [
    ["thin underline", thin],
    ["foot wash", foot],
  ] as const) {
    describe(name, () => {
      const bitmap = renderPaintedStroke(spec);
      const { width } = bitmap;

      test("fills its box and nothing clips the edges", () => {
        expect(bitmap.width).toBe(spec.width);
        expect(bitmap.height).toBe(spec.height);
        expect(rowHasPaint(bitmap, 0)).toBe(false);
        expect(rowHasPaint(bitmap, bitmap.height - 1)).toBe(false);
        expect(columnHasPaint(bitmap, 0)).toBe(false);
        expect(columnHasPaint(bitmap, width - 1)).toBe(false);
      });

      test("paints nearly every column through the middle of the span", () => {
        const from = Math.floor(width * 0.1);
        const to = Math.floor(width * 0.9);
        let painted = 0;

        for (let x = from; x < to; x += 1) {
          if (columnHasPaint(bitmap, x)) {
            painted += 1;
          }
        }

        expect(painted / (to - from)).toBeGreaterThanOrEqual(0.85);
      });

      test("carries a wet head and a dry tail", () => {
        const left = meanAlpha(bitmap, 0, Math.floor(width * 0.15));
        const right = meanAlpha(bitmap, Math.floor(width * 0.85), width);
        const [head, tail] = spec.reverse ? [right, left] : [left, right];

        expect(head).toBeGreaterThan(tail);
      });

      test("runs from the first pigment to the last", () => {
        const left = meanLinearRgb(bitmap, 0, Math.floor(width * 0.2));
        const right = meanLinearRgb(bitmap, Math.floor(width * 0.8), width);
        const [headEnd, tailEnd] = spec.reverse ? [right, left] : [left, right];
        const first = spec.pigments[0];
        const last = spec.pigments[spec.pigments.length - 1] ?? first;

        expect(chromaticityDistance(headEnd, first)).toBeLessThan(
          chromaticityDistance(headEnd, last),
        );
        expect(chromaticityDistance(tailEnd, last)).toBeLessThan(
          chromaticityDistance(tailEnd, first),
        );
      });
    });
  }

  test("reverse mirrors which side is denser", () => {
    const forward = renderPaintedStroke(thin);
    const reversed = renderPaintedStroke({ ...thin, reverse: true });
    const { width } = forward;
    const head = Math.floor(width * 0.15);
    const tail = Math.floor(width * 0.85);

    expect(meanAlpha(forward, 0, head)).toBeGreaterThan(meanAlpha(forward, tail, width));
    expect(meanAlpha(reversed, tail, width)).toBeGreaterThan(meanAlpha(reversed, 0, head));
    expect(meanAlpha(reversed, tail, width)).toBeCloseTo(meanAlpha(forward, 0, head), 0);
  });

  test("front slides the pigment boundary along the stroke", () => {
    const even = renderPaintedStroke(thin);
    const early = renderPaintedStroke({ ...thin, front: 0.35 });
    const { width } = even;
    // Just past a third of the way along, an even stroke is still mostly its
    // first pigment while a front at 0.35 has already crossed to the second.
    const from = Math.floor(width * 0.4);
    const to = Math.floor(width * 0.5);
    const [firstPigment, lastPigment] = thin.pigments;

    expect(chromaticityDistance(meanLinearRgb(even, from, to), firstPigment)).toBeLessThan(
      chromaticityDistance(meanLinearRgb(even, from, to), lastPigment),
    );
    expect(chromaticityDistance(meanLinearRgb(early, from, to), lastPigment)).toBeLessThan(
      chromaticityDistance(meanLinearRgb(early, from, to), firstPigment),
    );
  });
});

describe("renderPaintedStroke across seeds", () => {
  // The bow, wobble, swell, cap bulge and erosion are each budgeted so that,
  // whatever the rolls, the paint stays off every edge of the bake.
  test("never touches the bake's edges", () => {
    const boxes: PaintedStrokeSpec[] = [
      thin,
      { ...thin, width: 64 },
      { ...thin, width: 40 },
      { ...thin, height: 19, load: 1.2, thickness: 10.4, width: 308 },
      { ...thin, height: 28, scale: 2, thickness: 20, width: 400 },
    ];

    for (const box of boxes) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const bitmap = renderPaintedStroke({ ...box, seed });

        expect(rowHasPaint(bitmap, 0)).toBe(false);
        expect(rowHasPaint(bitmap, bitmap.height - 1)).toBe(false);
        expect(columnHasPaint(bitmap, 0)).toBe(false);
        expect(columnHasPaint(bitmap, bitmap.width - 1)).toBe(false);
      }
    }
  });
});
