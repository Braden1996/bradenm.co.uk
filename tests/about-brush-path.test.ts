import { describe, expect, test } from "bun:test";
import {
  advanceBrushPath,
  type BrushPoint,
  MAX_BRUSH_SEGMENTS,
} from "../src/features/about/lib/about-brush-path";

describe("advanceBrushPath", () => {
  test("short movement retains its endpoints and full travel weight", () => {
    expect(
      advanceBrushPath([
        [0, 0],
        [36, 0],
      ]),
    ).toEqual({
      segments: [{ segment: [0, 0, 36, 0], weight: 1 }],
      remainingPoints: [],
    });
  });

  test("subdivision preserves bends and adjoining seams", () => {
    const { segments } = advanceBrushPath([
      [0, 0],
      [120, 0],
      [120, 120],
    ]);
    expect(segments).toHaveLength(6);
    for (const {
      segment: [x0, y0, x1, y1],
    } of segments) {
      expect((y0 === 0 && y1 === 0) || (x0 === 120 && x1 === 120)).toBe(true);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThanOrEqual(40);
    }
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]?.segment.slice(0, 2)).toEqual(segments[index - 1]?.segment.slice(2));
    }
    expect(segments.reduce((sum, segment) => sum + segment.weight, 0)).toBeCloseTo(1, 12);
  });

  test("velocity weights reflect distance along unequal legs", () => {
    const { segments } = advanceBrushPath([
      [0, 0],
      [20, 0],
      [20, 30],
    ]);
    expect(segments).toEqual([
      { segment: [0, 0, 20, 0], weight: 0.4 },
      { segment: [20, 0, 20, 30], weight: 0.6 },
    ]);
  });

  test("empty paths do nothing while stationary contact still moves dots", () => {
    expect(advanceBrushPath([])).toEqual({ segments: [], remainingPoints: [] });
    const stationary: ReturnType<typeof advanceBrushPath> = {
      segments: [{ segment: [64, 12, 64, 12], weight: 1 }],
      remainingPoints: [],
    };
    expect(advanceBrushPath([[64, 12]])).toEqual(stationary);
    expect(
      advanceBrushPath([
        [64, 12],
        [64, 12],
      ]),
    ).toEqual(stationary);
  });

  test("duplicate samples do not consume segment slots", () => {
    expect(
      advanceBrushPath([
        [0, 0],
        [0, 0],
        [20, 0],
        [20, 0],
        [20, 30],
      ]),
    ).toEqual(
      advanceBrushPath([
        [0, 0],
        [20, 0],
        [20, 30],
      ]),
    );
  });

  test("overloaded input retains every bend across consecutive frames", () => {
    const points: BrushPoint[] = Array.from({ length: 34 }, (_, index) => [index, index % 2]);
    const first = advanceBrushPath(points);
    const second = advanceBrushPath(first.remainingPoints);
    const third = advanceBrushPath(second.remainingPoints);

    expect(first.segments).toHaveLength(MAX_BRUSH_SEGMENTS);
    expect(first.remainingPoints).toEqual(points.slice(MAX_BRUSH_SEGMENTS));
    expect(second.segments).toHaveLength(MAX_BRUSH_SEGMENTS);
    expect(third.segments).toHaveLength(1);
    expect(third.remainingPoints).toEqual([]);

    const segments = [...first.segments, ...second.segments, ...third.segments];
    expect(segments.map(({ segment }): BrushPoint => [segment[0], segment[1]])).toEqual(
      points.slice(0, -1),
    );
    expect(segments.map(({ segment }): BrushPoint => [segment[2], segment[3]])).toEqual(
      points.slice(1),
    );
  });

  test("very long coordinates cannot create unbounded work", () => {
    const { segments, remainingPoints } = advanceBrushPath([
      [0, 0],
      [1_000_000, 0],
    ]);
    expect(segments).toHaveLength(MAX_BRUSH_SEGMENTS);
    expect(segments[0]?.segment.slice(0, 2)).toEqual([0, 0]);
    expect(segments.at(-1)?.segment.slice(2)).toEqual([1_000_000, 0]);
    expect(segments.reduce((sum, segment) => sum + segment.weight, 0)).toBeCloseTo(1, 12);
    expect(remainingPoints).toEqual([]);
  });
});
