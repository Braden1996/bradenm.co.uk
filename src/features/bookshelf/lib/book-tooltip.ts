type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Placement = { x: number; y: number; side: "left" | "right" | "top" | "bottom" };

const INSET = 10;
const GAP = 42;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const point = (value: Point) => `${value.x.toFixed(2)} ${value.y.toFixed(2)}`;

/** Place the small paper in the nearest clear gutter, keeping its arrow off the cover. */
export function placeBookTooltip(book: Rect, note: Size, viewport: Size) {
  const center = { x: book.x + book.width / 2, y: book.y + book.height / 2 };
  const maxX = Math.max(INSET, viewport.width - note.width - INSET);
  const maxY = Math.max(INSET, viewport.height - note.height - INSET);
  const x = clamp(center.x - note.width / 2 + 18, INSET, maxX);
  const y = clamp(center.y - note.height / 2 + 16, INSET, maxY);
  const candidates: Placement[] = [
    { side: "right", x: book.x + book.width + GAP, y },
    { side: "left", x: book.x - note.width - GAP, y },
    { side: "bottom", x, y: book.y + book.height + GAP },
    { side: "top", x, y: book.y - note.height - GAP },
  ];
  const overflow = (position: Placement) =>
    Math.max(0, INSET - position.x) +
    Math.max(0, position.x - maxX) +
    Math.max(0, INSET - position.y) +
    Math.max(0, position.y - maxY);
  const candidate = candidates.toSorted((a, b) => overflow(a) - overflow(b))[0];
  if (!candidate) throw new Error("A tooltip needs a placement");
  const placed = {
    ...candidate,
    x: clamp(candidate.x, INSET, maxX),
    y: clamp(candidate.y, INSET, maxY),
  };
  const horizontal = placed.side === "left" || placed.side === "right";
  const direction = placed.side === "right" || placed.side === "bottom" ? -1 : 1;
  const start: Point = horizontal
    ? { x: placed.x + (direction < 0 ? -5 : note.width + 5), y: placed.y + note.height / 2 }
    : { x: placed.x + note.width / 2, y: placed.y + (direction < 0 ? -5 : note.height + 5) };
  const tip: Point = horizontal
    ? { x: direction < 0 ? book.x + book.width + 4 : book.x - 4, y: center.y }
    : { x: center.x, y: direction < 0 ? book.y + book.height + 4 : book.y - 4 };
  // A partially clipped book still gets a visible endpoint at the edge of the table.
  tip.x = clamp(tip.x, INSET, viewport.width - INSET);
  tip.y = clamp(tip.y, INSET, viewport.height - INSET);
  const bend = Math.max(8, Math.abs(horizontal ? tip.x - start.x : tip.y - start.y) * 0.45);
  const first = horizontal
    ? { x: start.x + direction * bend, y: start.y }
    : { x: start.x, y: start.y + direction * bend };
  const second = horizontal
    ? { x: tip.x - direction * bend, y: tip.y }
    : { x: tip.x, y: tip.y - direction * bend };
  const wingOne = horizontal
    ? { x: tip.x - direction * 5, y: tip.y - 2.5 }
    : { x: tip.x - 2.5, y: tip.y - direction * 5 };
  const wingTwo = horizontal
    ? { x: tip.x - direction * 5, y: tip.y + 2.5 }
    : { x: tip.x + 2.5, y: tip.y - direction * 5 };
  return {
    ...placed,
    line: `M ${point(start)} C ${point(first)} ${point(second)} ${point(tip)}`,
    head: `M ${point(wingOne)} L ${point(tip)} L ${point(wingTwo)}`,
    tip,
  };
}
