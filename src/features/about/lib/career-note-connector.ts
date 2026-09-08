type Rect = { left: number; top: number; width: number; height: number };
type Point = { x: number; y: number };
type Curve = { first: Point; second: Point; end: Point };

export type CareerNoteConnectorInput = {
  placement: "left" | "right";
  noteRect: Rect;
  /** Viewport y-coordinate of the heading's painted underline. */
  headingY: number;
  triggerRect: Rect;
  columnLeft: number;
  columnRight: number;
  /** Text and painted underlines, excluding the selected link and its punctuation. */
  textRects: Rect[];
};

export type CareerNoteConnector = {
  left: number;
  top: number;
  width: number;
  height: number;
  line: string;
  arrowhead: string;
};

const BOX_PADDING = 8;

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A minimum-jerk transition has zero slope and curvature at both ends, so a
 * bend settles into the whitespace lane without an elbow. SVG only supports
 * cubic curves: four Hermite spans closely approximate the quintic profile,
 * sharing exact positions and tangents at their joins. Linear x progression
 * keeps every span travelling toward the link without loops or overshoot.
 */
function easedCurves(start: Point, end: Point): Curve[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const point = (t: number): Point => ({
    x: start.x + dx * t,
    y: start.y + dy * t ** 3 * (10 + t * (-15 + 6 * t)),
  });
  const slope = (t: number) => dy * 30 * t ** 2 * (1 - t) ** 2;

  return Array.from({ length: 4 }, (_, index) => {
    const t0 = index / 4;
    const t1 = (index + 1) / 4;
    const from = point(t0);
    const to = point(t1);

    return {
      first: { x: from.x + dx / 12, y: from.y + slope(t0) / 12 },
      second: { x: to.x - dx / 12, y: to.y - slope(t1) / 12 },
      end: to,
    };
  });
}

/**
 * Connect directly to an exposed end of the selected underline. When other
 * words occupy the approach, travel below the row and turn upward at the target.
 */
export function createCareerNoteConnector(input: CareerNoteConnectorInput): CareerNoteConnector {
  const right = input.placement === "right";
  const noteLeft = finite(input.noteRect.left);
  const noteWidth = Math.max(0, finite(input.noteRect.width));
  const triggerLeft = finite(input.triggerRect.left);
  const triggerWidth = Math.max(0, finite(input.triggerRect.width));
  const triggerTop = finite(input.triggerRect.top);
  const triggerHeight = Math.max(0, finite(input.triggerRect.height));
  const triggerBottom = triggerTop + triggerHeight;
  const triggerRight = triggerLeft + triggerWidth;
  const textRects = input.textRects.filter(
    (rect) =>
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0,
  );
  const detour = textRects.some(
    (rect) =>
      rect.top < triggerBottom &&
      rect.top + rect.height > triggerTop &&
      (right ? rect.left + rect.width > triggerRight : rect.left < triggerLeft),
  );
  const origin: Point = {
    x: right ? noteLeft - 6 : noteLeft + noteWidth + 6,
    y: finite(input.headingY, finite(input.noteRect.top)),
  };
  const tip: Point = {
    x: right
      ? triggerRight + (detour ? -Math.min(12, triggerWidth / 2) : 5)
      : triggerLeft + (detour ? Math.min(12, triggerWidth / 2) : -5),
    y: triggerBottom - 2,
  };
  const direction = Math.sign(tip.x - origin.x) || (right ? -1 : 1);
  const columnEdge = right ? finite(input.columnRight) + 12 : finite(input.columnLeft) - 12;
  const railX = Math.max(
    Math.min(origin.x, tip.x),
    Math.min(Math.max(origin.x, tip.x), columnEdge),
  );
  const corridorLeft = Math.min(railX, tip.x);
  const corridorRight = Math.max(railX, tip.x);
  const obstacles = textRects.filter(
    (rect) => rect.left < corridorRight && rect.left + rect.width > corridorLeft,
  );
  const rowBottom = Math.max(
    triggerBottom,
    ...obstacles
      .filter((rect) => rect.top < triggerBottom && rect.top + rect.height > triggerTop)
      .map((rect) => rect.top + rect.height),
  );
  const nextRowTop = Math.min(
    ...obstacles.filter((rect) => rect.top >= rowBottom).map((rect) => rect.top),
  );
  const laneY = detour
    ? rowBottom + Math.min(18, triggerHeight * 0.6, (nextRowTop - rowBottom) / 2)
    : tip.y;
  const rail: Point = { x: railX, y: laneY };
  // The turn starts at the word's edge, so neighbouring underlines keep the
  // full lane clearance. Its vertical tangent points into the selected word.
  const turnWidth = Math.min(14, triggerWidth / 2 + 2, Math.abs(tip.x - railX));
  const turn: Point = { x: tip.x - direction * turnWidth, y: laneY };
  const curves: Curve[] = [
    ...easedCurves(origin, rail),
    ...(detour
      ? [
          ...easedCurves(rail, turn),
          {
            first: { x: turn.x + direction * turnWidth * 0.552, y: laneY },
            second: { x: tip.x, y: tip.y + (laneY - tip.y) * 0.552 },
            end: tip,
          },
        ]
      : easedCurves(rail, tip)),
  ];

  const tangent: Point = detour ? { x: 0, y: -1 } : { x: direction, y: 0 };
  const headLength = Math.min(5, detour ? laneY - tip.y : Math.abs(tip.x - origin.x));
  const wingWidth = Math.min(2, headLength * 0.4);
  const base: Point = { x: tip.x - tangent.x * headLength, y: tip.y - tangent.y * headLength };
  const wingOne: Point = { x: base.x + tangent.y * wingWidth, y: base.y - tangent.x * wingWidth };
  const wingTwo: Point = { x: base.x - tangent.y * wingWidth, y: base.y + tangent.x * wingWidth };
  const points = [
    origin,
    ...curves.flatMap((curve) => [curve.first, curve.second, curve.end]),
    wingOne,
    wingTwo,
  ];
  const left = Math.min(...points.map((point) => point.x)) - BOX_PADDING;
  const top = Math.min(...points.map((point) => point.y)) - BOX_PADDING;
  const width = Math.max(1, Math.max(...points.map((point) => point.x)) + BOX_PADDING - left);
  const height = Math.max(1, Math.max(...points.map((point) => point.y)) + BOX_PADDING - top);
  const coordinates = (point: Point) => `${point.x - left} ${point.y - top}`;

  return {
    left,
    top,
    width,
    height,
    line: `M ${coordinates(origin)} ${curves.map((curve) => `C ${coordinates(curve.first)} ${coordinates(curve.second)} ${coordinates(curve.end)}`).join(" ")}`,
    arrowhead: `M ${coordinates(wingOne)} L ${coordinates(tip)} L ${coordinates(wingTwo)}`,
  };
}
