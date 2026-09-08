import { describe, expect, test } from "bun:test";
import bookshelfCoverManifest from "../data/bookshelf-covers.json";
import bookshelfData from "../data/bookshelf.json";
import {
  buildBookshelfViewModel,
  buildHaystackValue,
  compareBooks,
  formatBookshelfResultsCount,
  getNextBookshelfSortState,
} from "../src/features/bookshelf/lib/bookshelf-data";
import { findBookshelfMatchIndexes } from "../src/features/bookshelf/lib/bookshelf-search";

// cspell:ignore dfsjnafsdhbfehjbbbhjewhj324523

/** @param {string} query */
function searchBooks(query) {
  const { books } = buildBookshelfViewModel(bookshelfData, bookshelfCoverManifest.covers ?? {});
  const haystack = books.map((book) => buildHaystackValue(book));
  const matchIndexes = findBookshelfMatchIndexes(haystack, query);

  return matchIndexes.flatMap((index) => {
    const book = books[index];

    return book ? [book] : [];
  });
}

describe("bookshelf search matcher", () => {
  test("ranks exact and whole-word matches ahead of partial matches", () => {
    const haystack = ["cartography", "art", "modern art", "artist"];
    expect(findBookshelfMatchIndexes(haystack, "art")).toEqual([1, 2, 3, 0]);
    expect(findBookshelfMatchIndexes(haystack, "")).toEqual([0, 1, 2, 3]);
  });

  test("returns no matches for a nonsense query", () => {
    const results = searchBooks("dfsjnafsdhbfehjbbbhjewhj324523");

    expect(results).toHaveLength(0);
  });

  test("returns known books for a concrete title query", () => {
    const results = searchBooks("foundation");

    expect(results.map((book) => book.title)).toEqual(["Foundation"]);
  });

  test("returns an author's books for an author query", () => {
    const results = searchBooks("Jordan B. Peterson");

    expect(results.map((book) => book.title).toSorted()).toEqual([
      "12 Rules for Life",
      "Beyond Order",
      "Maps of Meaning",
    ]);
  });

  test("normalizes equivalent author queries through the same matcher", () => {
    expect(searchBooks("  jordan   b. peterson  ")).toEqual(searchBooks("Jordan B. Peterson"));
  });

  test("returns every book for a cleared query", () => {
    expect(searchBooks("   ")).toHaveLength(
      buildBookshelfViewModel(bookshelfData, bookshelfCoverManifest.covers ?? {}).books.length,
    );
  });
});

describe("bookshelf result status", () => {
  test("uses a total-only label before filtering", () => {
    expect(formatBookshelfResultsCount(165, 165, false)).toBe("165 titles");
  });

  test("uses a visible-of-total label while filtered", () => {
    expect(formatBookshelfResultsCount(23, 165, true)).toBe("23 of 165 titles");
    expect(formatBookshelfResultsCount(0, 165, true)).toBe("0 of 165 titles");
    expect(formatBookshelfResultsCount(165, 165, true)).toBe("165 of 165 titles");
  });

  test("handles a singular collection", () => {
    expect(formatBookshelfResultsCount(1, 1, false)).toBe("1 title");
  });
});

describe("bookshelf sorting", () => {
  const alpha = {
    firstIndex: 0,
    sortAuthor: "Zulu",
    sortTitle: "Alpha",
  };
  const beta = {
    firstIndex: 1,
    sortAuthor: "Beta",
    sortTitle: "Beta",
  };

  test("sorts in both directions for title and author", () => {
    expect(compareBooks(alpha, beta, "title", "asc")).toBeLessThan(0);
    expect(compareBooks(alpha, beta, "title", "desc")).toBeGreaterThan(0);
    expect(compareBooks(alpha, beta, "author", "asc")).toBeGreaterThan(0);
    expect(compareBooks(alpha, beta, "author", "desc")).toBeLessThan(0);
  });

  test("toggles direction on the active key and resets a new key to ascending", () => {
    expect(getNextBookshelfSortState("title", "asc", "title")).toEqual({
      direction: "desc",
      key: "title",
    });
    expect(getNextBookshelfSortState("title", "desc", "title")).toEqual({
      direction: "asc",
      key: "title",
    });
    expect(getNextBookshelfSortState("title", "desc", "author")).toEqual({
      direction: "asc",
      key: "author",
    });
    expect(getNextBookshelfSortState("author", "desc", "title")).toEqual({
      direction: "asc",
      key: "title",
    });
  });
});

describe("bookshelf browser payload", () => {
  test("compact pre-normalized index preserves matches and server order", () => {
    const { books, payload } = buildBookshelfViewModel(
      bookshelfData,
      bookshelfCoverManifest.covers,
    );
    const original = books.map(buildHaystackValue);
    const compact = payload.books.map((book) => book.text);
    expect(payload.books.map((book) => book.id)).toEqual(books.map((book) => book.id));
    for (const query of [
      "",
      "foundation",
      "Jordan B. Peterson",
      "  jordan  ",
      "no-such-title-123",
    ]) {
      expect(findBookshelfMatchIndexes(compact, query)).toEqual(
        findBookshelfMatchIndexes(original, query),
      );
    }
    expect(JSON.stringify(payload.books).length).toBeLessThan(12000);
    expect(payload.atlas.map((book) => book.id)).toEqual(books.map((book) => book.id));
  });

  test("responsive covers include the original and never upscale", () => {
    for (const cover of Object.values(bookshelfCoverManifest.covers)) {
      const widths = cover.candidates.map((candidate) => candidate.width);
      expect(widths).toEqual([...new Set(widths)].toSorted((left, right) => left - right));
      expect(cover.candidates.at(-1)?.src).toBe(cover.src);
      for (const candidate of cover.candidates) {
        expect(candidate.width).toBeLessThanOrEqual(cover.width);
        expect(candidate.height).toBeLessThanOrEqual(cover.height);
        expect(candidate.width / candidate.height).toBeCloseTo(cover.width / cover.height, 2);
      }
    }
  });
});
