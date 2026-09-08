const DURATION = 4;
const PIXELS_PER_SECOND = 500;
const RESPONSE_SECONDS = 0.045;
const MAX_PENDING_SECONDS = 0.09;
const SETTLE_SECONDS = 0.0001;

function wrap(time: number) {
  const remainder = time % DURATION;
  return remainder < 0 ? remainder + DURATION : remainder;
}

/** Pointer distance advances a nearby target; stopping never leaves a long coast. */
export function createPortraitScrub(initialTime: number) {
  let time = Number.isFinite(initialTime) ? wrap(initialTime) : 6.5 / 12;
  let target = time;

  return {
    move(distance: number) {
      if (!Number.isFinite(distance) || distance <= 0) return;
      target = Math.min(target + distance / PIXELS_PER_SECOND, time + MAX_PENDING_SECONDS);
    },
    step(deltaSeconds: number) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return wrap(time);
      time += (target - time) * (1 - Math.exp(-deltaSeconds / RESPONSE_SECONDS));
      if (target - time < SETTLE_SECONDS) time = target;
      // Keep the unwrapped interval small without changing its forward direction.
      const loops = Math.floor(time / DURATION);
      time -= loops * DURATION;
      target -= loops * DURATION;
      return time;
    },
    isSettled() {
      return time === target;
    },
    hold() {
      target = time;
    },
    reset(nextTime: number) {
      time = Number.isFinite(nextTime) ? wrap(nextTime) : 6.5 / 12;
      target = time;
    },
  };
}
