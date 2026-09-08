import { describe, expect, test } from "bun:test";
import {
  PORTRAIT_ATLAS_CELL,
  PORTRAIT_ATLAS_COLUMNS,
  portraitAtlasCoverage,
} from "../src/features/about/lib/portrait-atlas";

const width = PORTRAIT_ATLAS_CELL * PORTRAIT_ATLAS_COLUMNS;

describe("portrait ink coverage", () => {
  test("keeps empty paper empty and preserves the ordering of ink strength", () => {
    const paper = portraitAtlasCoverage(new Uint8ClampedArray(width * width * 4));
    expect(paper.some((value) => value !== 0)).toBe(false);
    const mid = portraitAtlasCoverage(new Uint8ClampedArray(width * width * 4).fill(128));
    const dark = portraitAtlasCoverage(new Uint8ClampedArray(width * width * 4).fill(255));
    expect(mid.every((value, index) => value <= (dark[index] ?? 0))).toBe(true);
    const middle = (PORTRAIT_ATLAS_CELL / 2) * width + PORTRAIT_ATLAS_CELL / 2;
    expect(mid[middle * 4]).toBeLessThan(mid[middle * 4 + 3] ?? 0);
    expect(dark[middle * 4]).toBe(255);
    expect(dark[middle * 4 + 3]).toBe(255);
  });

  test("isolates a solid glyph from its empty neighbours without changing their coverage", () => {
    const rgba = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < PORTRAIT_ATLAS_CELL; y += 1) {
      for (let x = 0; x < PORTRAIT_ATLAS_CELL; x += 1) rgba[(y * width + x) * 4] = 255;
    }
    const result = portraitAtlasCoverage(rgba);
    let ink = 0;
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          const sample = result[(y * width + x) * 4 + channel] ?? 0;
          if (x < PORTRAIT_ATLAS_CELL && y < PORTRAIT_ATLAS_CELL) ink += sample;
          else if (sample !== 0) throw new Error("Glyph coverage leaked into a neighbouring tile");
        }
      }
    }
    expect(ink).toBeGreaterThan(0);
    expect(ink).toBeLessThan(PORTRAIT_ATLAS_CELL ** 2 * 255 * 4);
    expect(result[0]).toBe(0);
  });
});
