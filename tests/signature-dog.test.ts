import { describe, expect, test } from "bun:test";
import {
  advanceSignatureDogGaze,
  advanceSignatureDogMotion,
  advanceSignatureDogPose,
  signatureDogFrame,
  signatureDogGaze,
  type DogGaze,
} from "../src/features/about/lib/signature-dog";

const forward = { column: 3, row: 2 };
const resting = { column: 1, row: 2 };

function angularDistance(first: DogGaze, second: DogGaze) {
  return Math.hypot((first.column - second.column) * 25, (first.row - second.row) * 15);
}

describe("signature dog gaze", () => {
  test("looks toward the pointer on each side of the head", () => {
    expect(signatureDogGaze(-40, 0, 180, 40).column).toBeCloseTo(1.2, 12);
    expect(signatureDogGaze(40, 0, 180, 40).column).toBeCloseTo(4.8, 12);
    expect(signatureDogGaze(0, -40, 180, 40)).toEqual({ column: 3, row: 0 });
    expect(signatureDogGaze(0, 40, 180, 40)).toEqual({ column: 3, row: 4 });
  });

  test("uses the proximity radius without changing the active gaze direction", () => {
    const active = signatureDogGaze(40, -30, 60, 40);
    expect(signatureDogGaze(40, -30, 180, 40)).toEqual(active);
    expect(signatureDogGaze(40, -30, 50, 40)).toEqual(active);
    expect(signatureDogGaze(40, -30, 49, 40)).toEqual(resting);
    expect(signatureDogGaze(181, 0, 180, 40)).toEqual(resting);
    expect(signatureDogGaze(130, 130, 180, 40)).toEqual(resting);
    expect(signatureDogGaze(0, -181, 180, 40)).toEqual(resting);
  });

  test("preserves gaze when the displayed dog and pointer offsets scale together", () => {
    const gaze = signatureDogGaze(24, -12, 180, 40);
    for (const scale of [0.5, 1.5, 2]) {
      const scaled = signatureDogGaze(24 * scale, -12 * scale, 180 * scale, 40 * scale);
      expect(scaled.column).toBeCloseTo(gaze.column, 12);
      expect(scaled.row).toBeCloseTo(gaze.row, 12);
    }
  });

  test("moves continuously through the head center without a forward-facing dead zone", () => {
    expect(signatureDogGaze(0, 0, 180, 40)).toEqual(forward);
    const justLeft = signatureDogGaze(-0.001, 0, 180, 40);
    const justRight = signatureDogGaze(0.001, 0, 180, 40);
    expect(justLeft.column).toBeLessThan(3);
    expect(justRight.column).toBeGreaterThan(3);
    expect(justRight.column - justLeft.column).toBeLessThan(0.001);
    const before = signatureDogGaze(13.999, 0, 180, 40);
    const after = signatureDogGaze(14.001, 0, 180, 40);
    expect(after.column - before.column).toBeLessThan(0.001);
  });

  test("reduces the vertical angle for a pointer farther to the side", () => {
    const above = signatureDogGaze(0, -20, 180, 40);
    const diagonal = signatureDogGaze(40, -20, 180, 40);
    expect(diagonal.column).toBeGreaterThan(above.column);
    expect(diagonal.row).toBeGreaterThan(above.row);
    expect(diagonal.row).toBeLessThan(2);
    expect(diagonal.row).toBeCloseTo(
      2 - (Math.atan2(20, Math.hypot(40, 40)) * 180) / Math.PI / 15,
      12,
    );
  });

  test("keeps extreme targets inside the authored head-angle range", () => {
    for (let x = -180; x <= 180; x += 36) {
      for (let y = -180; y <= 180; y += 36) {
        const gaze = signatureDogGaze(x, y, 180, 40);
        expect(gaze.column).toBeGreaterThanOrEqual(0);
        expect(gaze.column).toBeLessThanOrEqual(6);
        expect(gaze.row).toBeGreaterThanOrEqual(0);
        expect(gaze.row).toBeLessThanOrEqual(4);
      }
    }
    expect(signatureDogGaze(-180, 0, 180, 40)).toEqual({ column: 0, row: 2 });
    expect(signatureDogGaze(180, 0, 180, 40)).toEqual({ column: 6, row: 2 });
  });
});

describe("signature dog movement", () => {
  test("a sudden opposite target starts from the displayed angle and limits combined speed", () => {
    const start = { column: 0, row: 0 };
    const target = { column: 6, row: 4 };
    expect(advanceSignatureDogGaze(start, target, 0)).toEqual(start);
    for (const elapsed of [1, 16, 33, 50]) {
      const next = advanceSignatureDogGaze(start, target, elapsed);
      expect(angularDistance(start, next)).toBeLessThanOrEqual(0.24 * elapsed + 1e-10);
      expect(next.column).toBeGreaterThan(start.column);
      expect(next.row).toBeGreaterThan(start.row);
    }
  });

  test("visits every intervening sharp drawing during a left-to-right turn", () => {
    let current = { column: 0, row: 2 };
    let frame = signatureDogFrame(current);
    const target = { column: 6, row: 2 };
    const seen = new Set([frame.column]);
    for (let elapsed = 0; elapsed < 1200; elapsed += 50) {
      const previous = current;
      current = advanceSignatureDogGaze(current, target, 50);
      expect(angularDistance(previous, current)).toBeLessThanOrEqual(12 + 1e-10);
      const nextFrame = signatureDogFrame(current, frame);
      expect(nextFrame.column - frame.column).toBeLessThanOrEqual(1);
      frame = nextFrame;
      seen.add(frame.column);
    }
    expect([...seen]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(current).toEqual(target);
  });

  test("leaving and re-entering reverses from the current angle", () => {
    const lookingRight = advanceSignatureDogGaze({ column: 0, row: 2 }, { column: 6, row: 2 }, 400);
    const returning = advanceSignatureDogGaze(lookingRight, resting, 16);
    expect(returning.column).toBeLessThan(lookingRight.column);
    expect(returning.column).toBeGreaterThan(resting.column);
    expect(angularDistance(lookingRight, returning)).toBeLessThanOrEqual(3.84 + 1e-10);

    const backInside = advanceSignatureDogGaze(returning, { column: 6, row: 0 }, 16);
    expect(backInside.column).toBeGreaterThan(returning.column);
    expect(backInside.column).toBeLessThan(6);
    expect(backInside.row).toBeGreaterThan(0);
    expect(backInside.row).toBeLessThan(2);
    expect(angularDistance(returning, backInside)).toBeLessThanOrEqual(3.84 + 1e-10);
  });

  test("preserves timing across frame intervals and the eased arrival boundary", () => {
    const start = { column: 0, row: 0 };
    const target = { column: 6, row: 4 };
    const intervals = [16, 24, 100, 230, 180, 160];
    const whole = advanceSignatureDogGaze(
      start,
      target,
      intervals.reduce((sum, value) => sum + value, 0),
    );
    let split = start;
    for (const elapsed of intervals) {
      split = advanceSignatureDogGaze(split, target, elapsed);
    }
    expect(split.column).toBeCloseTo(whole.column, 12);
    expect(split.row).toBeCloseTo(whole.row, 12);
    expect(split.column).toBeLessThan(target.column);
  });

  test("slows near the destination and settles exactly without exceeding its speed limit", () => {
    const start = { column: 5.8, row: 3.8 };
    const target = { column: 6, row: 4 };
    const first = advanceSignatureDogGaze(start, target, 16);
    const second = advanceSignatureDogGaze(first, target, 16);
    expect(angularDistance(first, second)).toBeLessThan(angularDistance(start, first));
    let current = second;
    for (let elapsed = 0; elapsed < 800; elapsed += 16) {
      const next = advanceSignatureDogGaze(current, target, 16);
      expect(angularDistance(current, next)).toBeLessThanOrEqual(3.84 + 1e-10);
      current = next;
    }
    expect(current).toEqual(target);
  });

  test("can reverse the sit-to-lie movement between authored poses", () => {
    expect(advanceSignatureDogPose(0, 6, 325)).toBe(3);
    const lowering = advanceSignatureDogPose(0, 6, 200);
    expect(Number.isInteger(lowering)).toBe(false);
    expect(advanceSignatureDogPose(lowering, 0, 0)).toBe(lowering);
    const rising = advanceSignatureDogPose(lowering, 0, 16);
    expect(rising).toBeLessThan(lowering);
    expect(lowering - rising).toBeLessThan(0.15);
    expect(advanceSignatureDogPose(0, 6, 650)).toBe(6);
    expect(advanceSignatureDogPose(rising, 0, 650)).toBe(0);
  });
});

describe("signature dog sharp frames", () => {
  test("selects exactly one valid drawing for fractional angles", () => {
    for (const column of [-1, 0, 0.15, 3.25, 5.8, 6, 7]) {
      for (const row of [-1, 0, 1.5, 3.9, 4, 5]) {
        const frame = signatureDogFrame({ column, row });
        expect(Number.isInteger(frame.column)).toBe(true);
        expect(Number.isInteger(frame.row)).toBe(true);
        expect(frame.column).toBeGreaterThanOrEqual(0);
        expect(frame.column).toBeLessThanOrEqual(6);
        expect(frame.row).toBeGreaterThanOrEqual(0);
        expect(frame.row).toBeLessThanOrEqual(4);
      }
    }
  });

  test("holds a drawing around the halfway point and switches beyond the hysteresis", () => {
    let frame = { column: 2, row: 2 };
    for (const coordinate of [2.49, 2.51, 2.48, 2.6, 2.51]) {
      frame = signatureDogFrame({ column: coordinate, row: coordinate }, frame);
      expect(frame).toEqual({ column: 2, row: 2 });
    }
    frame = signatureDogFrame({ column: 2.63, row: 2.63 }, frame);
    expect(frame).toEqual({ column: 3, row: 3 });
    for (const coordinate of [2.51, 2.49, 2.4]) {
      frame = signatureDogFrame({ column: coordinate, row: coordinate }, frame);
      expect(frame).toEqual({ column: 3, row: 3 });
    }
    expect(signatureDogFrame({ column: 2.37, row: 2.37 }, frame)).toEqual({ column: 2, row: 2 });
  });

  test("selects exact neutral and endpoint drawings after arrival", () => {
    expect(signatureDogFrame(forward)).toEqual(forward);
    expect(signatureDogFrame(forward, { column: 2, row: 1 })).toEqual(forward);
    expect(signatureDogFrame(forward, { column: 4, row: 3 })).toEqual(forward);
    expect(signatureDogFrame({ column: 6, row: 4 }, { column: 5, row: 3 })).toEqual({
      column: 6,
      row: 4,
    });
    expect(signatureDogFrame({ column: 0, row: 0 }, { column: 1, row: 1 })).toEqual({
      column: 0,
      row: 0,
    });
  });
});

describe("signature dog pose sequencing", () => {
  test("turns into the transition direction before lowering or rising, then resumes tracking", () => {
    const pointerGaze = { column: 6, row: 0 };
    for (const startPose of [0, 6]) {
      const targetPose = 6 - startPose;
      let motion = { pose: startPose, gaze: pointerGaze };
      let frame = signatureDogFrame(motion.gaze);
      let bodyStarted = false;
      for (let elapsed = 0; elapsed < 1800 && motion.pose !== targetPose; elapsed += 50) {
        const previous = motion;
        motion = advanceSignatureDogMotion(motion.pose, targetPose, motion.gaze, pointerGaze, 50);
        const nextFrame = signatureDogFrame(motion.gaze, frame);
        expect(Math.abs(nextFrame.column - frame.column)).toBeLessThanOrEqual(1);
        expect(Math.abs(nextFrame.row - frame.row)).toBeLessThanOrEqual(1);
        frame = nextFrame;
        if (motion.pose !== startPose) {
          bodyStarted = true;
          expect(motion.gaze).toEqual(resting);
          expect(frame).toEqual(resting);
        } else {
          expect(bodyStarted).toBe(false);
          expect(angularDistance(previous.gaze, motion.gaze)).toBeLessThanOrEqual(12 + 1e-10);
        }
      }
      expect(bodyStarted).toBe(true);
      expect(motion).toEqual({ pose: targetPose, gaze: resting });
      const tracking = advanceSignatureDogMotion(
        motion.pose,
        targetPose,
        motion.gaze,
        pointerGaze,
        16,
      );
      expect(tracking.pose).toBe(targetPose);
      expect(tracking.gaze.column).toBeGreaterThan(resting.column);
      expect(tracking.gaze.row).toBeLessThan(resting.row);
      expect(angularDistance(resting, tracking.gaze)).toBeLessThanOrEqual(3.84 + 1e-10);
    }
  });

  test("reverses an unfinished body movement immediately while retaining its head direction", () => {
    const pointerGaze = { column: 6, row: 4 };
    const lowering = advanceSignatureDogMotion(0, 6, resting, pointerGaze, 200);
    expect(lowering.pose).toBeGreaterThan(0);
    expect(lowering.pose).toBeLessThan(6);
    expect(lowering.gaze).toEqual(resting);
    const rising = advanceSignatureDogMotion(lowering.pose, 0, lowering.gaze, pointerGaze, 16);
    expect(rising.pose).toBeLessThan(lowering.pose);
    expect(lowering.pose - rising.pose).toBeLessThan(0.15);
    expect(rising.gaze).toEqual(resting);
    const loweringAgain = advanceSignatureDogMotion(
      rising.pose,
      6,
      rising.gaze,
      { column: 0, row: 0 },
      16,
    );
    expect(loweringAgain.pose).toBeGreaterThan(rising.pose);
    expect(loweringAgain.gaze).toEqual(resting);
  });

  test("a second click during the preparatory turn cancels it without resetting the head", () => {
    const pointerGaze = { column: 6, row: 2 };
    for (const pose of [0, 6]) {
      const preparing = advanceSignatureDogMotion(pose, 6 - pose, pointerGaze, pointerGaze, 50);
      expect(preparing.pose).toBe(pose);
      expect(preparing.gaze.column).toBeLessThan(pointerGaze.column);
      const cancelled = advanceSignatureDogMotion(pose, pose, preparing.gaze, pointerGaze, 16);
      expect(cancelled.pose).toBe(pose);
      expect(cancelled.gaze.column).toBeGreaterThan(preparing.gaze.column);
      expect(cancelled.gaze.column).toBeLessThan(pointerGaze.column);
      expect(angularDistance(preparing.gaze, cancelled.gaze)).toBeLessThanOrEqual(3.84 + 1e-10);
    }
  });
});
