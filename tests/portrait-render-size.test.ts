import { describe, expect, test } from "bun:test";
import { portraitBackingSize } from "../src/features/about/client/typogravure-renderer";

describe("portrait allocation", () => {
  test("keeps exact device pixels while fitting the stage into its CSS box", () => {
    const size = portraitBackingSize(720, 500, 2, "full");
    expect(size.width).toBe(1440);
    expect(size.height).toBe(800);
    expect(size.carrierWidth).toBe(2160);
    expect(size.carrierHeight).toBe(1200);
  });

  test.each([1, 2, 3])("bounds full and light intermediate allocation at DPR %d", (ratio) => {
    const full = portraitBackingSize(1800, 1000, ratio, "full");
    const light = portraitBackingSize(1800, 1000, ratio, "light");
    expect(full.carrierWidth * full.carrierHeight).toBeLessThanOrEqual(2_600_000);
    expect(light).toEqual(full);
    expect(light.carrierWidth / light.carrierHeight).toBeCloseTo(1.8, 2);
  });

  test.each([1, 2, 3])("keeps the same print across responsive sizes at DPR %d", (ratio) => {
    const sizes = [320, 570.453125, 960, 1800].map((width) =>
      portraitBackingSize(width, (width * 800) / 1440, ratio, "full"),
    );
    expect(new Set(sizes.map((size) => `${size.carrierWidth}x${size.carrierHeight}`))).toEqual(
      new Set(["2160x1200"]),
    );
    expect(new Set(sizes.map((size) => size.width)).size).toBe(sizes.length);
  });

  test("a temporarily hidden canvas still gets a valid minimum backing", () => {
    expect(portraitBackingSize(0, 0, 2, "light")).toEqual({
      width: 1,
      height: 1,
      carrierWidth: 2160,
      carrierHeight: 1200,
    });
  });
});
