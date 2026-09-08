const PORTRAIT_MOTION_FRAME_COUNT = 48;
const PORTRAIT_MOTION_FPS = 12;
const PORTRAIT_MOTION_REFERENCE_FRAME = 6;
const DURATION = PORTRAIT_MOTION_FRAME_COUNT / PORTRAIT_MOTION_FPS;

function wrap(value: number, length: number) {
  return ((value % length) + length) % length;
}

/** Seek the middle of a video's held frame to avoid decoder boundaries. */
export function portraitFrameTime(frame: number): number {
  const index = Number.isFinite(frame) ? Math.floor(frame) : PORTRAIT_MOTION_REFERENCE_FRAME;
  return (wrap(index, PORTRAIT_MOTION_FRAME_COUNT) + 0.5) / PORTRAIT_MOTION_FPS;
}

/** Select the actual held frame, including when a final seek catches up. */
export function portraitSourceFrame(mediaTimeSeconds: number): number {
  if (!Number.isFinite(mediaTimeSeconds)) return PORTRAIT_MOTION_REFERENCE_FRAME;
  const position = wrap(mediaTimeSeconds, DURATION) * PORTRAIT_MOTION_FPS;
  // Decoder timestamps can land a few floating-point units below a boundary.
  return Math.floor(position + 1e-7) % PORTRAIT_MOTION_FRAME_COUNT;
}
