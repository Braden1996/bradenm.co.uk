import { describe, expect, test } from "bun:test";
import {
  createCareerNoteConnector,
  type CareerNoteConnector,
  type CareerNoteConnectorInput,
} from "../src/features/about/lib/career-note-connector";

const right: CareerNoteConnectorInput = {
  placement: "right",
  noteRect: { left: 1100, top: 400, width: 220, height: 350 },
  headingY: 432,
  triggerRect: { left: 840, top: 455, width: 70, height: 26 },
  columnLeft: 350,
  columnRight: 1010,
  textRects: [
    { left: 920, top: 459, width: 90, height: 24 },
    { left: 800, top: 508, width: 210, height: 26 },
  ],
};

function elementAt<T>(items: T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) {
    throw new Error(`Missing path coordinate at ${index}`);
  }
  return item;
}

function points(path: string, connector: CareerNoteConnector) {
  const coordinates = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  return Array.from({ length: coordinates.length / 2 }, (_, index) => ({
    x: elementAt(coordinates, index * 2) + connector.left,
    y: elementAt(coordinates, index * 2 + 1) + connector.top,
  }));
}

function reflect(input: CareerNoteConnectorInput): CareerNoteConnectorInput {
  return {
    ...input,
    placement: input.placement === "right" ? "left" : "right",
    noteRect: { ...input.noteRect, left: -input.noteRect.left - input.noteRect.width },
    triggerRect: {
      ...input.triggerRect,
      left: -input.triggerRect.left - input.triggerRect.width,
    },
    columnLeft: -input.columnRight,
    columnRight: -input.columnLeft,
    textRects: input.textRects.map((rect) => ({ ...rect, left: -rect.left - rect.width })),
  };
}

function sampleLine(connector: CareerNoteConnector) {
  const controls = points(connector.line, connector);
  const samples: { x: number; y: number }[] = [];
  for (let i = 0; i < controls.length - 1; i += 3) {
    const start = elementAt(controls, i);
    const first = elementAt(controls, i + 1);
    const second = elementAt(controls, i + 2);
    const end = elementAt(controls, i + 3);
    for (let step = 0; step <= 40; step += 1) {
      const t = step / 40;
      const u = 1 - t;
      samples.push({
        x: u ** 3 * start.x + 3 * u ** 2 * t * first.x + 3 * u * t ** 2 * second.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * first.y + 3 * u * t ** 2 * second.y + t ** 3 * end.y,
      });
    }
  }
  return samples;
}

describe("createCareerNoteConnector", () => {
  test("connects the heading to the actual selected underline", () => {
    const connector = createCareerNoteConnector(right);
    const curve = points(connector.line, connector);
    const arrow = points(connector.arrowhead, connector);

    expect(curve[0]).toEqual({ x: 1094, y: 432 });
    expect(curve.at(-1)).toEqual({ x: 898, y: 479 });
    expect(arrow[1]).toEqual(curve.at(-1));
    expect(connector.width).toBe(214);
  });

  test("mirrors the same geometry for notes in the left gutter", () => {
    const original = createCareerNoteConnector(right);
    const mirrored = createCareerNoteConnector(reflect(right));
    const originalCurve = points(original.line, original);
    const mirroredCurve = points(mirrored.line, mirrored);

    expect(mirrored.width).toBeCloseTo(original.width);
    expect(mirrored.height).toBeCloseTo(original.height);
    expect(mirrored.top).toBeCloseTo(original.top);
    expect(mirrored.left).toBeCloseTo(-original.left - original.width);
    for (const [index, point] of originalCurve.entries()) {
      expect(elementAt(mirroredCurve, index).x).toBeCloseTo(-point.x);
      expect(elementAt(mirroredCurve, index).y).toBeCloseTo(point.y);
    }
    const originalArrow = points(original.arrowhead, original);
    const mirroredArrow = points(mirrored.arrowhead, mirrored).toReversed();
    for (const [index, point] of originalArrow.entries()) {
      expect(elementAt(mirroredArrow, index).x).toBeCloseTo(-point.x);
      expect(elementAt(mirroredArrow, index).y).toBeCloseTo(point.y);
    }
  });

  test("keeps the underline endpoint fixed when the note is viewport-clamped", () => {
    for (const headingY of [-400, 42, 200, 500, 1500]) {
      const connector = createCareerNoteConnector({ ...right, headingY });
      const curve = points(connector.line, connector);

      expect(curve[0]).toEqual({ x: 1094, y: headingY });
      expect(curve.at(-1)).toEqual({ x: 898, y: 479 });
      for (const point of curve) {
        if (point.x <= right.columnRight + 12) {
          expect(point.y).toBeGreaterThanOrEqual(479);
          expect(point.y).toBeLessThanOrEqual(495.5);
        }
      }
    }
  });

  test("travels midway through whitespace until it reaches the selected word", () => {
    for (const input of [right, reflect(right)]) {
      const connector = createCareerNoteConnector(input);
      const neighbour = elementAt(input.textRects, 0);
      const nextRow = elementAt(input.textRects, 1);
      const travel = sampleLine(connector).filter(
        (point) => point.x >= neighbour.left && point.x <= neighbour.left + neighbour.width,
      );

      expect(travel.length).toBeGreaterThan(10);
      for (const point of travel) {
        expect(point.y - neighbour.top - neighbour.height).toBeCloseTo(12.5);
        expect(nextRow.top - point.y).toBeCloseTo(12.5);
      }
    }
  });

  test("fits tighter line spacing and ignores text outside the route", () => {
    const neighbour = elementAt(right.textRects, 0);
    const input = {
      ...right,
      textRects: [
        neighbour,
        { left: 920, top: 491, width: 90, height: 20 },
        { left: 350, top: 484, width: 100, height: 20 },
      ],
    };
    const travel = sampleLine(createCareerNoteConnector(input)).filter(
      (point) => point.x >= 920 && point.x <= 1010,
    );
    expect(travel.length).toBeGreaterThan(10);
    for (const point of travel) expect(point.y).toBeCloseTo(487);
  });

  test("caps the detour for a last line with no text beneath it", () => {
    const connector = createCareerNoteConnector({
      ...right,
      textRects: [elementAt(right.textRects, 0)],
    });
    const travel = sampleLine(connector).filter((point) => point.x >= 920 && point.x <= 1010);
    expect(travel.length).toBeGreaterThan(10);
    for (const point of travel) {
      expect(point.y).toBeGreaterThan(489);
      expect(point.y).toBeLessThanOrEqual(499);
    }
  });

  test("connects horizontally to an exposed end without dipping below the underline", () => {
    const exposed = {
      ...right,
      textRects: [
        { left: 350, top: 459, width: 480, height: 24 },
        { left: 800, top: 508, width: 210, height: 26 },
      ],
    };
    for (const input of [exposed, reflect(exposed)]) {
      for (const headingY of [-400, 432, 479, 600]) {
        const connector = createCareerNoteConnector({ ...input, headingY });
        const curve = points(connector.line, connector);
        const tip = elementAt(curve, -1);
        const left = input.placement === "left";
        expect(tip).toEqual({ x: left ? -915 : 915, y: 479 });
        expect(elementAt(curve, -2).y).toBe(tip.y);
        const travel = sampleLine(connector).filter((point) =>
          left ? point.x >= input.columnLeft : point.x <= input.columnRight,
        );
        expect(travel.length).toBeGreaterThan(10);
        for (const point of travel) expect(point.y).toBeCloseTo(tip.y);

        const arrow = points(connector.arrowhead, connector);
        expect(elementAt(arrow, 1)).toEqual(tip);
        expect(elementAt(arrow, 0).x).toBeCloseTo(tip.x + (left ? -5 : 5));
        expect(elementAt(arrow, 2).x).toBeCloseTo(elementAt(arrow, 0).x);
        expect(Math.abs(elementAt(arrow, 0).y - tip.y)).toBeCloseTo(2);
      }
    }
  });

  test("keeps a short connection inside a narrow gutter without overshooting its link", () => {
    const input = { ...right, columnRight: 1050, headingY: 467 };
    const connector = createCareerNoteConnector(input);
    const curve = points(connector.line, connector);

    expect(curve[0]).toEqual({ x: 1094, y: 467 });
    expect(curve.at(-1)).toEqual({ x: 898, y: 479 });
    for (const point of curve) {
      expect(point.x).toBeGreaterThanOrEqual(898);
      expect(point.x).toBeLessThanOrEqual(1094);
    }
  });

  test("turns upward into the word and joins its curves without abrupt tangent changes", () => {
    for (const input of [
      right,
      reflect(right),
      { ...right, headingY: 500 },
      { ...right, triggerRect: { ...right.triggerRect, left: 400 } },
    ]) {
      const connector = createCareerNoteConnector(input);
      const curve = points(connector.line, connector);
      const first = elementAt(curve, 0);
      const last = elementAt(curve, -1);
      const direction = Math.sign(last.x - first.x);

      expect(elementAt(curve, 1).y).toBeCloseTo(first.y);
      expect(elementAt(curve, -2).x).toBeCloseTo(last.x);
      expect(elementAt(curve, -2).y).toBeGreaterThan(last.y);
      for (let i = 1; i < curve.length; i += 1) {
        expect(
          (elementAt(curve, i).x - elementAt(curve, i - 1).x) * direction,
        ).toBeGreaterThanOrEqual(0);
      }
      for (let i = 3; i < curve.length - 1; i += 3) {
        const before = elementAt(curve, i - 1);
        const join = elementAt(curve, i);
        const after = elementAt(curve, i + 1);

        const incoming = { x: join.x - before.x, y: join.y - before.y };
        const outgoing = { x: after.x - join.x, y: after.y - join.y };
        expect(incoming.x * outgoing.y - incoming.y * outgoing.x).toBeCloseTo(0, 8);
      }
    }
  });

  test("orients the arrowhead along the final curve tangent", () => {
    const connector = createCareerNoteConnector(right);
    const curve = points(connector.line, connector);
    const arrow = points(connector.arrowhead, connector);
    const tip = elementAt(curve, -1);
    const control = elementAt(curve, -2);
    const wingOne = elementAt(arrow, 0);
    const wingTwo = elementAt(arrow, 2);
    const base = { x: (wingOne.x + wingTwo.x) / 2, y: (wingOne.y + wingTwo.y) / 2 };
    const tangent = { x: tip.x - control.x, y: tip.y - control.y };
    const head = { x: tip.x - base.x, y: tip.y - base.y };

    expect(head.x * tangent.y - head.y * tangent.x).toBeCloseTo(0);
    expect(head.x * tangent.x + head.y * tangent.y).toBeGreaterThan(0);
    expect(Math.hypot(head.x, head.y)).toBeCloseTo(5);
    expect(head.x).toBeCloseTo(0);
    expect(head.y).toBeLessThan(0);
    expect(Math.hypot(wingOne.x - wingTwo.x, wingOne.y - wingTwo.y)).toBeCloseTo(4);
  });

  test("contains every curve control and arrow point inside the padded SVG bounds", () => {
    for (const input of [right, reflect(right), { ...right, headingY: -400 }]) {
      const connector = createCareerNoteConnector(input);
      for (const point of [
        ...points(connector.line, connector),
        ...points(connector.arrowhead, connector),
      ]) {
        expect(point.x).toBeGreaterThanOrEqual(connector.left + 8 - 0.0001);
        expect(point.x).toBeLessThanOrEqual(connector.left + connector.width - 8 + 0.0001);
        expect(point.y).toBeGreaterThanOrEqual(connector.top + 8 - 0.0001);
        expect(point.y).toBeLessThanOrEqual(connector.top + connector.height - 8 + 0.0001);
      }
    }
  });

  test("keeps narrow gaps, collapsed geometry and invalid inputs finite", () => {
    const collapsed = {
      ...right,
      noteRect: { left: 11, top: 0, width: 0, height: 0 },
      triggerRect: { left: 0, top: 0, width: 0, height: 0 },
      headingY: 0,
    };
    const invalid = {
      ...collapsed,
      headingY: Number.NaN,
      columnRight: Number.POSITIVE_INFINITY,
      triggerRect: { left: Number.NaN, top: Number.NaN, width: -4, height: -8 },
    };
    for (const input of [collapsed, reflect(collapsed), invalid]) {
      const connector = createCareerNoteConnector(input);
      const curve = points(connector.line, connector);
      const minimumX = Math.min(elementAt(curve, 0).x, elementAt(curve, -1).x);
      const maximumX = Math.max(elementAt(curve, 0).x, elementAt(curve, -1).x);

      for (const point of curve) {
        expect(point.x).toBeGreaterThanOrEqual(minimumX);
        expect(point.x).toBeLessThanOrEqual(maximumX);
      }
      expect(connector.line).not.toMatch(/NaN|Infinity/);
      expect(connector.arrowhead).not.toMatch(/NaN|Infinity/);
      expect(connector.width).toBeGreaterThanOrEqual(1);
      expect(connector.height).toBeGreaterThanOrEqual(1);
      for (const value of [connector.left, connector.top, connector.width, connector.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
