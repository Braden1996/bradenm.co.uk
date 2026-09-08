import { describe, expect, test } from "bun:test";
import { createSmearTrail } from "../src/features/about/lib/about-paint-smear";

const blue = { pigment: [40, 90, 130] as const, alpha: 0.8 };
type Mark = Parameters<Parameters<typeof createSmearTrail>[1]>[0];

describe("the dry paint smear", () => {
  test("a near miss and stationary contact cannot load paint", () => {
    const marks: Mark[] = [];
    let contacts = 0;
    const trail = createSmearTrail(
      ([x, y]) => {
        contacts += 1;
        return x >= 10 && x <= 20 && y >= 10 && y <= 20 ? blue : undefined;
      },
      (mark) => marks.push(mark),
    );
    trail.move([15, 15], [15, 15]);
    expect(contacts).toBe(0);
    trail.move([0, 9], [100, 9]);
    expect(marks).toHaveLength(0);
  });

  test("actual contact fades out after only 45 pixels of travel", () => {
    const marks: Mark[] = [];
    const trail = createSmearTrail(
      ([x]) => (x < 10 ? blue : undefined),
      (mark) => marks.push(mark),
    );
    trail.move([0, 0], [200, 0]);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.at(-1)?.to[0]).toBeLessThanOrEqual(55);
    expect(marks.at(-1)?.load).toBeLessThan(0.04);
    const count = marks.length;
    trail.move([200, 0], [400, 0]);
    expect(marks).toHaveLength(count);
  });

  test("sparse input samples a narrow real paint edge along the path", () => {
    const marks: Mark[] = [];
    const trail = createSmearTrail(
      ([x]) => (x >= 49 && x <= 51 ? blue : undefined),
      (mark) => marks.push(mark),
    );
    trail.move([0, 0], [300, 0]);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]?.from[0]).toBeGreaterThanOrEqual(48);
    expect(marks.at(-1)?.to[0]).toBeLessThanOrEqual(97);
  });

  test("faint transparent texture holes do not supply pigment", () => {
    const marks: Mark[] = [];
    const trail = createSmearTrail(
      () => ({ ...blue, alpha: 0.01 }),
      (mark) => marks.push(mark),
    );
    trail.move([0, 0], [100, 0]);
    expect(marks).toHaveLength(0);
  });

  test("lifting leaves no pigment to carry into another gesture", () => {
    const marks: Mark[] = [];
    const trail = createSmearTrail(
      ([x]) => (x < 10 ? blue : undefined),
      (mark) => marks.push(mark),
    );
    trail.move([0, 0], [10, 0]);
    trail.lift();
    const count = marks.length;
    trail.move([10, 0], [30, 0]);
    expect(marks).toHaveLength(count);
  });

  test("invalid or implausibly large jumps do not spend unbounded work", () => {
    let samples = 0;
    const trail = createSmearTrail(
      () => {
        samples += 1;
        return blue;
      },
      () => {},
    );
    trail.move([0, 0], [Number.NaN, 1]);
    trail.move([0, 0], [1_000_000, 0]);
    expect(samples).toBe(0);
  });
});
