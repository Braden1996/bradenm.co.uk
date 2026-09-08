import { describe, expect, test } from "bun:test";
import data from "../data/bookshelf.json";
import covers from "../data/bookshelf-covers.json";
import { buildBookshelfViewModel } from "../src/features/bookshelf/lib/bookshelf-data";
import { ATLAS, atlasProfile, atlasCoverSource } from "../src/features/bookshelf/lib/atlas-layout";
import {
  atlasTableLayout,
  atlasFittedView,
  atlasZoomAt,
  atlasClampCamera,
} from "../src/features/bookshelf/lib/atlas-camera";
import { parseAtlasPayload } from "../src/features/bookshelf/lib/atlas-payload";
const { books, payload } = buildBookshelfViewModel(data, covers.covers);
describe("atlas collection", () => {
  test("every title, cover index and owned format survives the browser payload", () => {
    const parsed = parseAtlasPayload(JSON.stringify(payload));
    expect(parsed?.atlas).toHaveLength(books.length);
    for (const [index, book] of books.entries()) {
      expect(parsed?.atlas[index]?.formats).toEqual(book.mediumTags.map((tag) => tag.label));
      expect(parsed?.atlas[index]?.cover.src).toBe(book.coverSrc);
      expect(parsed?.atlas[index]?.atlasIndex).toBe(index);
    }
    expect(parseAtlasPayload('{"books":[],"atlas":[{}]}')).toBeNull();
    expect(parseAtlasPayload("not JSON")).toBeNull();
  });
  test("profiles stay stable and preserve portrait cover proportions", () => {
    for (const book of payload.atlas) {
      expect(book.profile).toEqual(
        atlasProfile(book.title, book.author, book.cover.width, book.cover.height),
      );
      if (book.cover.height / book.cover.width >= 1.15)
        expect(book.profile.width / book.profile.height).toBeCloseTo(
          book.cover.width / book.cover.height,
          6,
        );
    }
  });
  test("the whole spread fills every desktop shape without clipped or colliding books", () => {
    const layout = atlasTableLayout(payload.atlas);
    expect(atlasTableLayout(payload.atlas)).toEqual(layout);
    for (const [width, height] of [
      [1440, 800],
      [800, 1000],
      [1900, 500],
    ]) {
      const view = atlasFittedView(layout, width ?? 1, height ?? 1, { zoom: 1, x: 0, y: 0 });
      for (const [index, position] of view.layout.positions.entries()) {
        const x = position.x * view.unit;
        const y = (ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) * view.unit;
        expect(x - (position.width * view.unit) / 2).toBeGreaterThan(0);
        expect(x + (position.width * view.unit) / 2).toBeLessThan(view.width);
        expect(y - (position.length * Math.sin(ATLAS.pitch) * view.unit) / 2).toBeGreaterThan(0);
        expect(y + (position.length * Math.sin(ATLAS.pitch) * view.unit) / 2).toBeLessThan(
          view.height,
        );
        for (const other of view.layout.positions.slice(index + 1))
          expect(
            Math.abs(position.x - other.x) >= (position.width + other.width) / 2 ||
              Math.abs(position.z - other.z) >= (position.length + other.length) / 2,
          ).toBe(true);
      }
    }
  });
  test("wheel zoom keeps the pointed world position fixed and fit resets both axes", () => {
    const camera = { zoom: 2, x: -300, y: -200 };
    const next = atlasZoomAt(camera, 3, 600, 400, 1200, 800);
    expect((600 - next.x) / next.zoom).toBe((600 - camera.x) / camera.zoom);
    expect((400 - next.y) / next.zoom).toBe((400 - camera.y) / camera.zoom);
    expect(atlasZoomAt(next, 1, 600, 400, 1200, 800)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(atlasClampCamera({ zoom: 2, x: 500, y: -5000 }, 1200, 800)).toEqual({
      zoom: 2,
      x: 0,
      y: -800,
    });
  });
  test("texture selection caps at authentic sources", () => {
    const cover = {
      src: "/original.webp",
      width: 800,
      height: 1200,
      candidates: [
        { src: "/small.webp", width: 256, height: 384 },
        { src: "/medium.webp", width: 512, height: 768 },
      ],
    };
    expect(atlasCoverSource(cover, 400)).toBe("/medium.webp");
    expect(atlasCoverSource(cover, 2000)).toBe("/original.webp");
  });
});
