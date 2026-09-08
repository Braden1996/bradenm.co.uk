import { describe, expect, test } from "bun:test";
import { createPortraitPoints } from "../src/features/about/lib/portrait-points";

const columns = 400;
const rows = 207;
const pitchX = 3.6;
const pitchY = 3.87;
const points = createPortraitPoints(columns, rows, pitchX, pitchY);

describe("portrait mark positions", () => {
  test("recreates the same homes without relying on time or shared random state", () => {
    createPortraitPoints(7, 9, 2, 4);
    expect(createPortraitPoints(columns, rows, pitchX, pitchY)).toEqual(points);
  });

  test("keeps every point inside the stage and close to its logical cell", () => {
    expect(points.length).toBe(columns * rows * 2);
    let maxTravel = 0;
    for (let index = 0; index < columns * rows; index += 1) {
      const x = (points[index * 2] ?? Number.NaN) / pitchX;
      const y = (points[index * 2 + 1] ?? Number.NaN) / pitchY;
      // Conversion to stage pixels rounds once to Float32 at the outer edge.
      if (!(x >= -0.0001 && x <= columns + 0.0001 && y >= -0.0001 && y <= rows + 0.0001)) {
        throw new Error(`Point ${index} falls outside the stage`);
      }
      maxTravel = Math.max(
        maxTravel,
        Math.abs(x - (index % columns) - 0.5),
        Math.abs(y - Math.floor(index / columns) - 0.5),
      );
    }
    expect(maxTravel).toBeLessThan(0.751);
  });

  test("separates neighbouring marks so random placement does not produce clumps", () => {
    let closest = Number.POSITIVE_INFINITY;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const index = (y * columns + x) * 2;
        // Given the tested travel bound, cells farther away cannot collide.
        for (let nextY = y; nextY <= Math.min(rows - 1, y + 2); nextY += 1) {
          for (let nextX = Math.max(0, x - 2); nextX <= Math.min(columns - 1, x + 2); nextX += 1) {
            const next = (nextY * columns + nextX) * 2;
            if (next <= index) continue;
            const dx = ((points[index] ?? 0) - (points[next] ?? 0)) / pitchX;
            const dy = ((points[index + 1] ?? 0) - (points[next + 1] ?? 0)) / pitchY;
            closest = Math.min(closest, Math.hypot(dx, dy));
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(0.6);
  });

  test("suppresses the regular row and column frequencies", () => {
    let xCos = 0;
    let xSin = 0;
    let yCos = 0;
    let ySin = 0;
    for (let index = 0; index < points.length; index += 2) {
      const xPhase = ((points[index] ?? 0) / pitchX) * Math.PI * 2;
      const yPhase = ((points[index + 1] ?? 0) / pitchY) * Math.PI * 2;
      xCos += Math.cos(xPhase);
      xSin += Math.sin(xPhase);
      yCos += Math.cos(yPhase);
      ySin += Math.sin(yPhase);
    }
    // Perfect rows produce amplitude 1; small in-cell jitter stays close to
    // that peak even when no two positions are precisely equal.
    expect(Math.hypot(xCos, xSin) / (columns * rows)).toBeLessThan(0.2);
    expect(Math.hypot(yCos, ySin) / (columns * rows)).toBeLessThan(0.2);
  });

  test("supports a single logical cell and rejects unusable dimensions", () => {
    const single = createPortraitPoints(1, 1, 3, 4);
    expect(single.length).toBe(2);
    expect(single[0]).toBeGreaterThanOrEqual(0);
    expect(single[0]).toBeLessThanOrEqual(3);
    expect(single[1]).toBeGreaterThanOrEqual(0);
    expect(single[1]).toBeLessThanOrEqual(4);
    expect(() => createPortraitPoints(0, 1, 3, 4)).toThrow(RangeError);
    expect(() => createPortraitPoints(1, 1, Number.NaN, 4)).toThrow(RangeError);
  });
});
