export const MAX_BRUSH_SEGMENTS = 16;

const SEGMENT_SPACING = 40;

export type BrushPoint = readonly [number, number];
export type BrushSegment = {
  segment: readonly [number, number, number, number];
  /** Share of this frame's travel, for estimating the segment's velocity. */
  weight: number;
};

/**
 * Keep the pointer's bends within the GPU's bounded segment budget.
 * Excess legs return for the next frame instead of becoming a diagonal shortcut.
 */
export function advanceBrushPath(points: readonly BrushPoint[]) {
  const legs: { from: BrushPoint; to: BrushPoint; length: number; divisions: number }[] = [];
  let remainingPoints: BrushPoint[] = [];
  let totalTravel = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) {
      continue;
    }
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) {
      continue;
    }
    if (legs.length === MAX_BRUSH_SEGMENTS) {
      remainingPoints = points.slice(index - 1);
      break;
    }
    legs.push({ from, to, length, divisions: 1 });
    totalTravel += length;
  }

  const segments: BrushSegment[] = [];
  const stationary = points[0];
  if (totalTravel === 0) {
    if (stationary) {
      segments.push({
        segment: [...stationary, ...stationary],
        weight: 1,
      });
    }
    return { segments, remainingPoints };
  }

  // Reserve one segment per leg first. Only long legs spend spare slots, and
  // no subdivision ever removes an authored bend from the incoming path.
  for (let count = legs.length; count < MAX_BRUSH_SEGMENTS; count += 1) {
    let longest = legs[0];
    for (const leg of legs) {
      if (!longest || leg.length / leg.divisions > longest.length / longest.divisions) {
        longest = leg;
      }
    }
    if (!longest || longest.length / longest.divisions <= SEGMENT_SPACING) {
      break;
    }
    longest.divisions += 1;
  }

  for (const { from, to, length, divisions } of legs) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const travel = length / divisions;
    const weight = travel / totalTravel;
    for (let division = 0; division < divisions; division += 1) {
      const start = division / divisions;
      const end = (division + 1) / divisions;
      segments.push({
        segment: [
          from[0] + dx * start,
          from[1] + dy * start,
          from[0] + dx * end,
          from[1] + dy * end,
        ],
        weight,
      });
    }
  }

  return { segments, remainingPoints };
}
