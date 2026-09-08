import { describe, expect, test } from "bun:test";
import { renderPaintedBlock } from "../src/components/lib/paper-paint";

/*
 * Regression pins for the flat gouache blocks, captured from the painter
 * before its helpers were extracted into paper-brush / paper-pigment. The
 * stats are aggregates (not byte hashes) because CI's maths library differs
 * from the workstation's in the last bits of its sines and exponentials,
 * which would otherwise flake an exact hash; ±0.05% is far tighter than any
 * recipe change and far looser than any such rounding.
 */
const pins = [
  {
    alphaSum: 26_808_233,
    covered: 137_549,
    rgbSum: 66_320_455,
    spec: { alpha: 0.78, color: "#96b6a8", rect: { height: 854, width: 177 }, seed: 11 },
  },
  {
    alphaSum: 21_401_907,
    covered: 112_505,
    rgbSum: 39_110_195,
    spec: { alpha: 0.76, color: "#3d82ad", rect: { height: 430, width: 282 }, seed: 47 },
  },
  {
    alphaSum: 9_419_669,
    covered: 42_036,
    rgbSum: 24_385_650,
    spec: { alpha: 0.9, color: "#eec7a2", rect: { height: 165, width: 291 }, seed: 83 },
  },
];

const tolerance = 0.0005;

function measure(pixels: Uint8ClampedArray) {
  let alphaSum = 0;
  let covered = 0;
  let rgbSum = 0;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0;
    alphaSum += alpha;

    if (alpha > 0) {
      covered += 1;
      rgbSum += (pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0);
    }
  }

  return { alphaSum, covered, rgbSum };
}

describe("renderPaintedBlock", () => {
  for (const pin of pins) {
    test(`seed ${pin.spec.seed} keeps its coverage and pigment`, () => {
      const block = renderPaintedBlock(pin.spec);
      const stats = measure(block.pixels);

      expect(block.width).toBe(pin.spec.rect.width);
      expect(block.height).toBe(pin.spec.rect.height);
      expect(block.pixels.length).toBe(pin.spec.rect.width * pin.spec.rect.height * 4);
      expect(Math.abs(stats.alphaSum - pin.alphaSum)).toBeLessThanOrEqual(pin.alphaSum * tolerance);
      expect(Math.abs(stats.covered - pin.covered)).toBeLessThanOrEqual(pin.covered * tolerance);
      expect(Math.abs(stats.rgbSum - pin.rgbSum)).toBeLessThanOrEqual(pin.rgbSum * tolerance);
    });
  }

  test("caches by the whole spec, not the seed alone", () => {
    const first = renderPaintedBlock({
      alpha: 0.5,
      color: "#96b6a8",
      rect: { height: 40, width: 60 },
      seed: 5,
    });
    const second = renderPaintedBlock({
      alpha: 0.5,
      color: "#96b6a8",
      rect: { height: 48, width: 60 },
      seed: 5,
    });

    expect(first.height).toBe(40);
    expect(second.height).toBe(48);
  });
});

/** Variance of luminance over the covered texels: the spread the eye reads as mottle. */
function luminanceVariance(pixels: Uint8ClampedArray) {
  const values: number[] = [];

  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) > 128) {
      values.push(
        0.2126 * (pixels[offset] ?? 0) +
          0.7152 * (pixels[offset + 1] ?? 0) +
          0.0722 * (pixels[offset + 2] ?? 0),
      );
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

describe("renderPaintedBlock in the wet look", () => {
  const flat = { alpha: 0.76, color: "#3d82ad", rect: { height: 200, width: 160 }, seed: 47 };
  const wet = { ...flat, companion: "#7595a3", style: "wet" as const };

  test("is deterministic and distinct from the flat look", () => {
    const first = renderPaintedBlock(wet);
    const again = renderPaintedBlock({ ...wet });

    expect(Buffer.from(again.pixels).equals(Buffer.from(first.pixels))).toBe(true);
    expect(Buffer.from(first.pixels).equals(Buffer.from(renderPaintedBlock(flat).pixels))).toBe(
      false,
    );
  });

  test("varies more in tone than the flat look — the mottle the brief asks for", () => {
    expect(luminanceVariance(renderPaintedBlock(wet).pixels)).toBeGreaterThan(
      luminanceVariance(renderPaintedBlock(flat).pixels) * 1.3,
    );
  });
});

/** Mean sRGB of the covered texels in a window — "what colour is it here". */
function meanColour(
  block: { height: number; pixels: Uint8ClampedArray; width: number },
  left: number,
  top: number,
  size: number,
) {
  let count = 0;
  const total = [0, 0, 0];

  for (let y = top; y < top + size; y += 1) {
    for (let x = left; x < left + size; x += 1) {
      const offset = (y * block.width + x) * 4;

      if ((block.pixels[offset + 3] ?? 0) > 128) {
        count += 1;
        for (let channel = 0; channel < 3; channel += 1) {
          total[channel] = (total[channel] ?? 0) + (block.pixels[offset + channel] ?? 0);
        }
      }
    }
  }

  return total.map((sum) => sum / Math.max(1, count));
}

describe("renderPaintedBlock as a patchwork", () => {
  const pitch = { height: 120, width: 120 };
  const wall = {
    alpha: 0.9,
    color: "#c9d7dd",
    patchwork: {
      falloff: 0.2,
      patches: [
        { color: "#d94141", companion: "#d05a3a", x: 60, y: 90 },
        { color: "#3f5fd9", companion: "#3a78d0", x: 180, y: 90 },
      ],
      pitch,
      wander: 24,
    },
    rect: { height: 180, width: 240 },
    seed: 41,
    style: "wet" as const,
  };

  test("paints each patch in its own pigment", () => {
    const block = renderPaintedBlock(wall);
    const [leftRed = 0, , leftBlue = 0] = meanColour(block, 30, 60, 40);
    const [rightRed = 0, , rightBlue = 0] = meanColour(block, 170, 60, 40);

    expect(leftRed).toBeGreaterThan(leftBlue);
    expect(rightBlue).toBeGreaterThan(rightRed);
  });

  test("leaves no bare texel carrying a colour from the far side of the wall", () => {
    // Bare texels are filled with the pigment UNDER them so a lossy encoder
    // has nothing dark to ring with; on a patchwork that has to be the local
    // patch, not the spec's nominal colour.
    const block = renderPaintedBlock(wall);
    let bare = 0;

    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const offset = (y * block.width + x) * 4;

        if ((block.pixels[offset + 3] ?? 0) === 0) {
          bare += 1;
          expect(block.pixels[offset] ?? 0).toBeGreaterThan(block.pixels[offset + 2] ?? 0);
        }
      }
    }

    expect(bare).toBeGreaterThan(0);
  });

  test("is deterministic, and keyed apart from the same bake without it", () => {
    expect(
      Buffer.from(renderPaintedBlock({ ...wall }).pixels).equals(
        Buffer.from(renderPaintedBlock(wall).pixels),
      ),
    ).toBe(true);

    const { patchwork, ...slab } = wall;

    expect(patchwork.patches).toHaveLength(2);
    expect(
      Buffer.from(renderPaintedBlock(slab).pixels).equals(
        Buffer.from(renderPaintedBlock(wall).pixels),
      ),
    ).toBe(false);
  });
});
