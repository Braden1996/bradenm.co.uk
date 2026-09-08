import { describe, expect, test } from "bun:test";
import { paperOverscrollColumnHeight } from "../src/components/lib/paper-overscroll-renderer";

for (const canvasHeight of [182, 212]) {
  describe(`paper wash in a ${canvasHeight}px viewport decoration`, () => {
    test("starts at the same 45px resting height across the entire sheet", () => {
      for (let column = 0; column < 240; column += 1) {
        expect(paperOverscrollColumnHeight(column / 239, 0, canvasHeight)).toBe(45);
      }
    });

    test("moves every colour band upward from the first pull through full extension", () => {
      for (let column = 0; column < 240; column += 1) {
        const u = column / 239;
        let previousHeight = 45;

        for (const pull of [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
          const height = paperOverscrollColumnHeight(u, pull, canvasHeight);

          expect(height).toBeGreaterThan(previousHeight);

          for (const sourceProgress of [0, 0.17, 0.34, 0.68, 0.9]) {
            const previousY = canvasHeight - previousHeight * (1 - sourceProgress);
            const nextY = canvasHeight - height * (1 - sourceProgress);

            expect(nextY).toBeLessThan(previousY);
          }

          previousHeight = height;
        }
      }
    });

    test("forms a symmetrical crown with both shoulders higher than the resting wash", () => {
      for (const pull of [0, 0.01, 0.25, 0.5, 1]) {
        let previousHeight = 0;

        for (let step = 0; step <= 120; step += 1) {
          const u = step / 240;
          const height = paperOverscrollColumnHeight(u, pull, canvasHeight);

          expect(height).toBeGreaterThanOrEqual(previousHeight);
          expect(height).toBeCloseTo(paperOverscrollColumnHeight(1 - u, pull, canvasHeight), 10);
          previousHeight = height;
        }
      }

      expect(paperOverscrollColumnHeight(0, 1, canvasHeight)).toBeCloseTo(
        (63.6 * canvasHeight) / 212,
        10,
      );
      expect(paperOverscrollColumnHeight(0.5, 1, canvasHeight)).toBeCloseTo(
        (185.5 * canvasHeight) / 212,
        10,
      );
    });

    test("clamps pull overshoot so neither end can shrink below rest or overextend", () => {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        expect(paperOverscrollColumnHeight(u, -0.1, canvasHeight)).toBe(45);
        expect(paperOverscrollColumnHeight(u, 1.1, canvasHeight)).toBe(
          paperOverscrollColumnHeight(u, 1, canvasHeight),
        );
      }
    });
  });
}
