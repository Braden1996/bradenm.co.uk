import { describe, expect, test } from "bun:test";
import { createPortraitScrub } from "../src/features/about/lib/portrait-scrub";

describe("portrait cursor response", () => {
  test("responds immediately and settles shortly after pointer travel stops", () => {
    const scrub = createPortraitScrub(0);
    scrub.move(20);
    expect(scrub.step(1 / 60)).toBeGreaterThan(0.01);
    for (let frame = 0; frame < 18; frame++) scrub.step(1 / 60);
    expect(scrub.isSettled()).toBe(true);
    expect(scrub.step(1)).toBeCloseTo(0.04, 8);
  });

  test.each([30, 60, 120])(
    "preserves ordinary pointer distance at %d display frames per second",
    (fps) => {
      const scrub = createPortraitScrub(0);
      for (let frame = 0; frame < fps; frame++) {
        scrub.move(300 / fps);
        scrub.step(1 / fps);
      }
      for (let frame = 0; frame < fps; frame++) scrub.step(1 / fps);
      expect(scrub.step(1)).toBeCloseTo(0.6, 8);
    },
  );

  test("bounds a burst so it cannot leave seconds of queued animation", () => {
    const scrub = createPortraitScrub(0);
    scrub.move(50_000);
    expect(scrub.step(1)).toBeLessThanOrEqual(0.09);
    expect(scrub.isSettled()).toBe(true);
  });

  test("crosses the loop boundary forward and reset clears pending movement", () => {
    const scrub = createPortraitScrub(3.98);
    scrub.move(20);
    expect(scrub.step(1)).toBeCloseTo(0.02, 8);
    scrub.move(20);
    scrub.reset(6.5 / 12);
    expect(scrub.step(1)).toBe(6.5 / 12);
    expect(scrub.isSettled()).toBe(true);
  });

  test("pausing discards the remaining coast and invalid input cannot corrupt time", () => {
    const scrub = createPortraitScrub(0);
    scrub.move(20);
    const time = scrub.step(1 / 60);
    scrub.hold();
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      scrub.move(invalid);
      expect(scrub.step(invalid)).toBe(time);
    }
    expect(scrub.step(1)).toBe(time);
    expect(scrub.isSettled()).toBe(true);
  });
});
