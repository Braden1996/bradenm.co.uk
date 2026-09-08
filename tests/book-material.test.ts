import { describe, expect, test } from "bun:test";
import {
  bookMaterialCss,
  bookPaintStyles,
  buildBookMaterialProfile,
  type BookMaterialProfile,
} from "../src/features/bookshelf/lib/book-material";

function percentages(value: string) {
  return [...value.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]));
}

function expectValidClip(value: string, minimumPoints: number) {
  const coordinates = percentages(value);

  expect(value.startsWith("polygon(")).toBe(true);
  expect(coordinates.length).toBeGreaterThanOrEqual(minimumPoints * 2);
  expect(coordinates.every((coordinate) => coordinate >= 0 && coordinate <= 100)).toBe(true);
}

function expectWithin(value: number, minimum: number, maximum: number) {
  expect(value).toBeGreaterThanOrEqual(minimum);
  expect(value).toBeLessThanOrEqual(maximum);
}

function expectValidRanges(profile: BookMaterialProfile) {
  expectWithin(profile.caseDepth, 1.65, 2.45);
  expectWithin(profile.pageDepth, 0.72, 1.18);
  expectWithin(profile.spineWidth, 5.35, 6.45);
  expectWithin(profile.warpPitch, 3.2, 4.15);
  expectWithin(profile.weftPitch, 4.4, 5.8);
  expectWithin(profile.linenOpacity, 0.36, 0.47);
  expectWithin(profile.wearOpacity, 0.64, 0.9);
}

describe("buildBookMaterialProfile", () => {
  test("is stable for one title and author, including its complete CSS", () => {
    const first = buildBookMaterialProfile("The Genius of Dogs", "Brian Hare");
    const again = buildBookMaterialProfile("The Genius of Dogs", "Brian Hare");

    expect(again).toEqual(first);
    expect(bookMaterialCss(again, 218)).toBe(bookMaterialCss(first, 218));
  });

  test("gives different books different bindings", () => {
    const dogs = buildBookMaterialProfile("The Genius of Dogs", "Brian Hare");
    const eye = buildBookMaterialProfile("Eye", "Dave Miller");

    expect(eye.coverClip).not.toBe(dogs.coverClip);
    expect(eye.spineClip).not.toBe(dogs.spineClip);
  });

  test("keeps harmless title formatting changes on the same binding", () => {
    const canonical = buildBookMaterialProfile("Eye: A Study", "Dave Miller");
    const reformatted = buildBookMaterialProfile("  EYE — A STUDY ", " DAVE   MILLER ");

    expect(reformatted).toEqual(canonical);
  });

  test("keeps every generated silhouette inside its fixed 2:3 book box", () => {
    const books = [
      ["The Genius of Dogs", "Brian Hare"],
      ["12 Rules for Life", "Jordan B. Peterson"],
      ["Atlas Obscura", "Joshua Ford"],
      ["The Anarchy", "William Dalrymple"],
      ["Why We Sleep", "Matthew Walker"],
    ] as const;

    for (const [title, author] of books) {
      const profile = buildBookMaterialProfile(title, author);

      expectValidClip(profile.caseClip, 20);
      expectValidClip(profile.coverClip, 26);
      expectValidClip(profile.spineClip, 12);
      expectValidRanges(profile);
    }
  });

  test("concentrates a restrained number of wear marks around the cover", () => {
    const profile = buildBookMaterialProfile("The Genius of Dogs", "Brian Hare");
    const markCount = profile.wearPattern.match(/radial-gradient\(/g)?.length ?? 0;
    const fibreCount = profile.fibrePattern.match(/radial-gradient\(/g)?.length ?? 0;

    expectWithin(markCount, 5, 6);
    expectWithin(fibreCount, 7, 11);
    expect(profile.wearPattern).not.toContain("NaN");
  });

  test("serialises only finite, SSR-ready custom properties", () => {
    const profile = buildBookMaterialProfile("The Genius of Dogs", "Brian Hare");
    const css = bookMaterialCss(profile, 144);

    expect(css).toContain("--cover-hue:144");
    expect(css).toContain("--book-cover-clip:polygon(");
    expect(css).not.toContain("--book-wear-pattern:");
    expect(css).not.toContain("--book-fibre-pattern:");
    expect(bookPaintStyles).toContain(`.book.${profile.paintClass}{`);
    expect(css).not.toContain("NaN");
    expect(css).not.toContain("undefined");
  });

  test("shares sixteen stable paint variants across a large shelf", () => {
    const variants = new Map<string, string>();

    for (let index = 0; index < 256; index += 1) {
      const profile = buildBookMaterialProfile(`Book ${index}`, "An Author");
      const paint = `--book-fibre-pattern:${profile.fibrePattern};--book-wear-pattern:${profile.wearPattern}`;

      expect(bookPaintStyles).toContain(`.book.${profile.paintClass}{${paint}}`);
      const existing = variants.get(profile.paintClass);
      if (existing !== undefined) {
        expect(paint).toBe(existing);
      }
      variants.set(profile.paintClass, paint);
    }

    expect(variants.size).toBe(16);
    expect(bookPaintStyles.match(/\.shelf-run > \.book\./g)).toHaveLength(16);
  });
});
