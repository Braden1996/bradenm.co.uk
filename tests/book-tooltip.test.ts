import { describe, expect, test } from "bun:test";
import { placeBookTooltip } from "../src/features/bookshelf/lib/book-tooltip";

const note = { width: 220, height: 84 };
const viewport = { width: 900, height: 600 };

describe("book tooltip placement", () => {
  test("keeps the paper clear of books at every table edge", () => {
    for (const x of [0, 390, 820]) {
      for (const y of [0, 255, 540]) {
        const book = { x, y, width: 80, height: 60 };
        const result = placeBookTooltip(book, note, viewport);
        expect(result.x).toBeGreaterThanOrEqual(10);
        expect(result.y).toBeGreaterThanOrEqual(10);
        expect(result.x + note.width).toBeLessThanOrEqual(viewport.width - 10);
        expect(result.y + note.height).toBeLessThanOrEqual(viewport.height - 10);
        expect(
          result.x > book.x + book.width ||
            result.x + note.width < book.x ||
            result.y > book.y + book.height ||
            result.y + note.height < book.y,
        ).toBe(true);
        expect(result.line + result.head).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  test("points at the book's edge and changes sides when the right gutter is full", () => {
    const right = placeBookTooltip({ x: 300, y: 200, width: 80, height: 60 }, note, viewport);
    expect(right.side).toBe("right");
    expect(right.tip).toEqual({ x: 384, y: 230 });
    const left = placeBookTooltip({ x: 800, y: 200, width: 80, height: 60 }, note, viewport);
    expect(left.side).toBe("left");
    expect(left.tip).toEqual({ x: 796, y: 230 });
  });

  test("uses above or below for a wide, zoomed book", () => {
    const below = placeBookTooltip({ x: 30, y: 200, width: 840, height: 80 }, note, viewport);
    expect(below.side).toBe("bottom");
    expect(below.tip).toEqual({ x: 450, y: 284 });
    const above = placeBookTooltip({ x: 30, y: 480, width: 840, height: 80 }, note, viewport);
    expect(above.side).toBe("top");
    expect(above.tip).toEqual({ x: 450, y: 476 });
  });

  test("keeps an endpoint visible when part of a book is clipped", () => {
    const result = placeBookTooltip({ x: 720, y: -80, width: 210, height: 100 }, note, viewport);
    expect(result.tip.y).toBe(10);
    expect(result.tip.x).toBeGreaterThanOrEqual(10);
    expect(result.tip.x).toBeLessThanOrEqual(890);
  });
});
