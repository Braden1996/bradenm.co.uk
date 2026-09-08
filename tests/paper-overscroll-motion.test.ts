import { describe, expect, test } from "bun:test";
import {
  advancePaperPull,
  paperPullForDistance,
} from "../src/components/lib/paper-overscroll-motion";

describe("paper pull resistance", () => {
  test("moves progressively less for equal 100px drags", () => {
    let previousDisplacement = Number.POSITIVE_INFINITY;

    for (let distance = 0; distance < 1000; distance += 100) {
      const displacement = paperPullForDistance(distance + 100) - paperPullForDistance(distance);

      expect(displacement).toBeGreaterThan(0);
      expect(displacement).toBeLessThan(previousDisplacement);
      previousDisplacement = displacement;
    }
  });

  test("approaches full extension without reaching it on long pulls", () => {
    let previousPull = 0;

    for (const distance of [1000, 10_000, 100_000, 1_000_000]) {
      const pull = paperPullForDistance(distance);

      expect(pull).toBeGreaterThan(previousPull);
      expect(pull).toBeLessThan(1);
      previousPull = pull;
    }

    expect(previousPull).toBeGreaterThan(0.999);
  });

  test("returns to exactly the same distance and pull regardless of input batching", () => {
    const initialDistance = 160;
    const initialPull = paperPullForDistance(initialDistance);

    for (const deltas of [
      [100, -100],
      [25, 25, 25, 25, -50, -50],
      [40, 60, -10, -30, -60],
    ]) {
      const distance = deltas.reduce((current, delta) => current + delta, initialDistance);

      expect(distance).toBe(initialDistance);
      expect(paperPullForDistance(distance)).toBe(initialPull);
    }
  });

  test("keeps the sheet at rest before entering its reserved scroll tail", () => {
    expect(paperPullForDistance(-100)).toBe(0);
    expect(paperPullForDistance(0)).toBe(0);
  });
});

for (const { name, travel, maximumLift } of [
  { name: "desktop", travel: 480, maximumLift: 133 },
  { name: "mobile", travel: 410, maximumLift: 114 },
]) {
  describe(`${name} native scroll tail`, () => {
    const fullPull = paperPullForDistance(travel);

    test("reaches its intended lift with decreasing increments of movement", () => {
      let previousLift = 0;
      let previousIncrement = Number.POSITIVE_INFINITY;

      for (let step = 1; step <= 8; step += 1) {
        const distance = (travel * step) / 8;
        const lift = (paperPullForDistance(distance) / fullPull) * maximumLift;
        const increment = lift - previousLift;

        expect(increment).toBeGreaterThan(0);
        expect(increment).toBeLessThan(previousIncrement);
        previousLift = lift;
        previousIncrement = increment;
      }

      expect(previousLift).toBe(maximumLift);
    });

    test("compensates native movement without exceeding the reserved tail", () => {
      for (let step = 0; step <= 16; step += 1) {
        const distance = (travel * step) / 16;
        const lift = (paperPullForDistance(distance) / fullPull) * maximumLift;
        const compensation = distance - lift;

        expect(lift).toBeGreaterThanOrEqual(0);
        expect(lift).toBeLessThanOrEqual(maximumLift);
        expect(compensation).toBeGreaterThanOrEqual(0);
        expect(compensation).toBeLessThanOrEqual(travel - maximumLift);
        expect(compensation).toBeLessThanOrEqual(distance);
        expect(-distance + compensation).toBeCloseTo(-lift, 10);
      }
    });

    test("returns the native scroll position consistently across frame rates", () => {
      const bottom = 1200;
      const initialDistance = travel * 0.75;
      const elapsed = 1 / 6;
      const whole = advancePaperPull(initialDistance, 0, 0, elapsed);

      for (const frameRate of [30, 60, 120, 144]) {
        let spring = { position: initialDistance, velocity: 0 };
        let previousScrollTop = bottom + initialDistance;

        for (let frame = 0; frame < frameRate / 6; frame += 1) {
          spring = advancePaperPull(spring.position, spring.velocity, 0, 1 / frameRate);
          const scrollTop = bottom + spring.position;

          expect(scrollTop).toBeGreaterThanOrEqual(bottom);
          expect(scrollTop).toBeLessThan(previousScrollTop);
          expect(scrollTop).toBeLessThanOrEqual(bottom + travel);
          previousScrollTop = scrollTop;
        }

        expect(spring.position).toBeCloseTo(whole.position, 10);
        expect(spring.velocity).toBeCloseTo(whole.velocity, 10);
        expect(previousScrollTop - bottom).toBeLessThan(0.5);
        expect(Math.abs(spring.velocity)).toBeLessThan(10);
      }
    });
  });
}

describe("advancePaperPull", () => {
  test("begins a large pull with a small, continuous first frame", () => {
    const shortFrame = advancePaperPull(0, 0, 0.5, 1 / 120);
    const firstFrame = advancePaperPull(0, 0, 0.5, 1 / 60);

    expect(shortFrame.position).toBeGreaterThan(0);
    expect(firstFrame.position).toBeGreaterThan(shortFrame.position);
    expect(firstFrame.position).toBeLessThan(0.1);
    expect(firstFrame.velocity).toBeGreaterThan(0);
  });

  test("reaches the same state when elapsed time is split between frames", () => {
    const whole = advancePaperPull(0.2, -1, 0.8, 0.15);
    let split = { position: 0.2, velocity: -1 };

    for (let frame = 0; frame < 9; frame += 1) {
      split = advancePaperPull(split.position, split.velocity, 0.8, 1 / 60);
    }

    expect(split.position).toBeCloseTo(whole.position, 12);
    expect(split.velocity).toBeCloseTo(whole.velocity, 12);
  });

  test("comes to rest at the target after a long frame", () => {
    const settled = advancePaperPull(0.1, 12, 0.6, 2);

    expect(settled.position).toBeCloseTo(0.6, 12);
    expect(settled.velocity).toBeCloseTo(0, 12);
  });

  test("preserves outward momentum briefly when the pull is released", () => {
    const outward = advancePaperPull(0, 0, 0.5, 1 / 60);
    const reversed = advancePaperPull(outward.position, outward.velocity, 0, 1 / 240);
    const returning = advancePaperPull(reversed.position, reversed.velocity, 0, 0.1);
    const settled = advancePaperPull(returning.position, returning.velocity, 0, 0.8);

    expect(reversed.position).toBeGreaterThan(outward.position);
    expect(reversed.velocity).toBeGreaterThan(0);
    expect(reversed.velocity).toBeLessThan(outward.velocity);
    expect(returning.position).toBeLessThan(reversed.position);
    expect(returning.velocity).toBeLessThan(0);
    expect(settled.position).toBeCloseTo(0, 10);
    expect(settled.velocity).toBeCloseTo(0, 10);
  });

  test("returns over 95 percent in 80ms and nearly settles in 150ms", () => {
    const initialPosition = 0.5;
    const returning = advancePaperPull(initialPosition, 4, 0, 0.08);
    const nearlySettled = advancePaperPull(initialPosition, 4, 0, 0.15);

    expect(returning.position).toBeGreaterThan(0);
    expect(returning.position).toBeLessThan(initialPosition * 0.05);
    expect(returning.velocity).toBeLessThan(0);
    expect(nearlySettled.position).toBeLessThan(initialPosition * 0.001);
    expect(Math.abs(nearlySettled.velocity)).toBeLessThan(0.025);
  });

  test("keeps the faster return identical across uneven frame durations", () => {
    const whole = advancePaperPull(0.5, 4, 0, 0.08);
    let split = { position: 0.5, velocity: 4 };

    for (const elapsed of [0.007, 0.019, 0.011, 0.043]) {
      split = advancePaperPull(split.position, split.velocity, 0, elapsed);
    }

    expect(split.position).toBeCloseTo(whole.position, 12);
    expect(split.velocity).toBeCloseTo(whole.velocity, 12);
  });

  test("leaves motion unchanged when no positive time has elapsed", () => {
    const initial = { position: 0.25, velocity: -2 };

    expect(advancePaperPull(initial.position, initial.velocity, 0.75, 0)).toEqual(initial);
    expect(advancePaperPull(initial.position, initial.velocity, 0.75, -0.1)).toEqual(initial);
  });
});
