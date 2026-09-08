export type DogGaze = {
  column: number;
  row: number;
};

const YAW_STEP = 25;
const PITCH_STEP = 15;
const TURN_SPEED = 0.24;
const ARRIVAL_TIME = 70;
const FRAME_HOLD_DISTANCE = 0.62;
const RESTING_GAZE = { column: 1, row: 2 };

/** Aim from the head toward the pointer; radius only controls proximity. */
export function signatureDogGaze(x: number, y: number, radius: number, depth: number): DogGaze {
  if (Math.hypot(x, y) > radius) {
    return RESTING_GAZE;
  }

  const headDepth = Math.max(Number.EPSILON, depth);
  const yaw = (Math.atan2(x, headDepth) * 180) / Math.PI;
  const pitch = (Math.atan2(y, Math.hypot(x, headDepth)) * 180) / Math.PI;

  return {
    column: Math.max(0, Math.min(6, 3 + yaw / YAW_STEP)),
    row: Math.max(0, Math.min(4, 2 + pitch / PITCH_STEP)),
  };
}

/** Turn at most 240 degrees per second, easing into the target over 70ms. */
export function advanceSignatureDogGaze(
  current: DogGaze,
  target: DogGaze,
  elapsed: number,
): DogGaze {
  const yaw = (target.column - current.column) * YAW_STEP;
  const pitch = (target.row - current.row) * PITCH_STEP;
  const distance = Math.hypot(yaw, pitch);
  if (elapsed <= 0 || distance === 0) {
    return current;
  }

  // Integrate the constant-speed segment before the exponential arrival.
  // Splitting a frame at that boundary preserves the same animation timing.
  const arrivalDistance = TURN_SPEED * ARRIVAL_TIME;
  const cruiseTime = Math.max(0, (distance - arrivalDistance) / TURN_SPEED);
  const cruiseElapsed = Math.min(elapsed, cruiseTime);
  const remaining =
    (distance - TURN_SPEED * cruiseElapsed) * Math.exp(-(elapsed - cruiseElapsed) / ARRIVAL_TIME);
  const amount =
    remaining < 0.05 && distance <= TURN_SPEED * elapsed ? 1 : 1 - remaining / distance;

  return {
    column: current.column + (target.column - current.column) * amount,
    row: current.row + (target.row - current.row) * amount,
  };
}

/** A full sit-to-lie movement takes 650ms and can reverse at any point. */
export function advanceSignatureDogPose(current: number, target: number, elapsed: number) {
  const distance = Math.min(Math.abs(target - current), (Math.max(0, elapsed) * 6) / 650);
  return current + Math.sign(target - current) * distance;
}

/** Turn into the shared transition drawing before moving the body. */
export function advanceSignatureDogMotion(
  pose: number,
  targetPose: number,
  gaze: DogGaze,
  targetGaze: DogGaze,
  elapsed: number,
) {
  if (pose === targetPose) {
    return { pose, gaze: advanceSignatureDogGaze(gaze, targetGaze, elapsed) };
  }

  const nextGaze = advanceSignatureDogGaze(gaze, RESTING_GAZE, elapsed);
  const aligned =
    Math.abs(nextGaze.column - RESTING_GAZE.column) < 1 - FRAME_HOLD_DISTANCE &&
    Math.abs(nextGaze.row - RESTING_GAZE.row) < 1 - FRAME_HOLD_DISTANCE;
  if ((pose === 0 || pose === 6) && !aligned) {
    return { pose, gaze: nextGaze };
  }

  // Once the resting cel is selected, keep that same head throughout the body
  // sequence, including a reversal. Pointer tracking resumes after arrival.
  return {
    pose: advanceSignatureDogPose(pose, targetPose, elapsed),
    gaze: RESTING_GAZE,
  };
}

function selectFrameCoordinate(value: number, previous: number | undefined, maximum: number) {
  const bounded = Math.max(0, Math.min(maximum, value));
  if (previous !== undefined) {
    const last = Math.max(0, Math.min(maximum, Math.round(previous)));
    if (Math.abs(bounded - last) <= FRAME_HOLD_DISTANCE) {
      return last;
    }
  }
  return Math.round(bounded);
}

/** Select one sharp drawing, retaining it near a boundary to avoid chatter. */
export function signatureDogFrame(gaze: DogGaze, previousFrame?: DogGaze): DogGaze {
  return {
    column: selectFrameCoordinate(gaze.column, previousFrame?.column, 6),
    row: selectFrameCoordinate(gaze.row, previousFrame?.row, 4),
  };
}
