import { expect, test } from "bun:test";
import data from "../data/bookshelf.json";
import covers from "../data/bookshelf-covers.json";
import { buildBookshelfViewModel } from "../src/features/bookshelf/lib/bookshelf-data";
import { ATLAS } from "../src/features/bookshelf/lib/atlas-layout";
import {
  atlasFittedView,
  atlasSearchLayout,
  atlasTableLayout,
  type AtlasView,
} from "../src/features/bookshelf/lib/atlas-camera";
import { atlasTransition } from "../src/features/bookshelf/lib/atlas-transition";

const books = buildBookshelfViewModel(data, covers.covers).payload.atlas;
const camera = { zoom: 1, x: 0, y: 0 };
const fitted = (layout: AtlasView["layout"]) => atlasFittedView(layout, 1440, 850, camera);
function screenPosition(view: AtlasView, index: number) {
  const position = view.layout.positions[index];
  if (!position) throw new Error("Missing book placement");
  return {
    x: position.x * view.unit * view.camera.zoom + view.camera.x,
    y:
      (ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) * view.unit * view.camera.zoom +
      view.camera.y,
    width: position.width * view.unit * view.camera.zoom,
  };
}

test("search rows read left to right, stay straight and leave space around every cover", () => {
  for (const count of [0, 1, 4, 30, books.length]) {
    const layout = atlasSearchLayout(books.slice(0, count));
    expect(layout.positions).toHaveLength(count);
    expect(Number.isFinite(fitted(layout).unit)).toBe(true);
    for (const [index, position] of layout.positions.entries()) {
      expect(position.rotation).toBe(0);
      const previous = layout.positions[index - 1];
      if (previous)
        expect(
          position.z > previous.z || (position.z === previous.z && position.x > previous.x),
        ).toBe(true);
      for (const other of layout.positions.slice(index + 1))
        expect(
          Math.abs(position.x - other.x) > (position.width + other.width) / 2 ||
            Math.abs(position.z - other.z) > (position.length + other.length) / 2,
        ).toBe(true);
    }
  }
});

test("relevance reordering starts at the same on-screen pose, including a zoomed camera", () => {
  const before = { ...fitted(atlasTableLayout(books)), camera: { zoom: 2.4, x: -650, y: -320 } };
  const matches = [books[70], books[3], books[90]].filter((book) => book !== undefined);
  const target = fitted(atlasSearchLayout(matches));
  const tween = atlasTransition(before, books, target, matches);
  for (const [index, book] of matches.entries()) {
    const original = screenPosition(before, books.indexOf(book));
    const start = screenPosition(tween(0), index);
    expect(start.x).toBeCloseTo(original.x, 8);
    expect(start.y).toBeCloseTo(original.y, 8);
    expect(start.width).toBeCloseTo(original.width, 8);
    expect(tween(0).layout.positions[index]?.rotation).toBe(book.profile.rotation);
  }
  expect(tween(1)).toEqual(target);
  const intermediate = tween(0.4);
  const reordered = matches.toReversed();
  const next = atlasTransition(
    intermediate,
    matches,
    fitted(atlasSearchLayout(reordered)),
    reordered,
  )(0);
  for (const [index, book] of reordered.entries()) {
    const current = screenPosition(intermediate, matches.indexOf(book));
    expect(screenPosition(next, index).x).toBeCloseTo(current.x, 8);
    expect(screenPosition(next, index).y).toBeCloseTo(current.y, 8);
  }
});
