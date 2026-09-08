import { describe, expect, test } from "bun:test";
import { portraitFrameTime, portraitSourceFrame } from "../src/features/about/lib/portrait-motion";

describe("portrait video timing", () => {
  test("seeks every held frame away from its decoder boundaries", () => {
    expect(portraitSourceFrame(0.542)).toBe(6);
    for (let frame = 0; frame < 48; frame++) {
      expect(portraitSourceFrame(portraitFrameTime(frame))).toBe(frame);
    }
  });

  test("selects the decoded interval when deciding whether a seek must catch up", () => {
    const boundary = 7 / 12;
    expect(portraitSourceFrame(boundary - 0.0001)).toBe(6);
    expect(portraitSourceFrame(boundary)).toBe(7);
    expect(portraitSourceFrame(boundary - Number.EPSILON)).toBe(7);
  });

  test("wraps the loop and keeps unavailable timestamps at the reference pose", () => {
    expect(portraitSourceFrame(4)).toBe(0);
    expect(portraitSourceFrame(-0.01)).toBe(47);
    expect(portraitFrameTime(48)).toBe(portraitFrameTime(0));
    expect(portraitFrameTime(-1)).toBe(portraitFrameTime(47));
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(portraitSourceFrame(time)).toBe(6);
      expect(portraitFrameTime(time)).toBe(portraitFrameTime(6));
    }
  });
});
