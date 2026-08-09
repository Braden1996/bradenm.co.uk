import { describe, expect, test } from "bun:test";
import uFuzzy from "@leeoniya/ufuzzy";
import bookshelfCoverManifest from "../data/bookshelf-covers.json";
import bookshelfData from "../data/bookshelf.json";
import {
  buildBookshelfViewModel,
  buildHaystackValue,
  normalizeNeedle,
} from "../src/features/bookshelf/lib/bookshelf-data";

// cspell:ignore dfsjnafsdhbfehjbbbhjewhj324523

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraChars: "[a-z\\d' -]",
});

/** @param {string} query */
function searchBooks(query) {
  const { books } = buildBookshelfViewModel(bookshelfData, bookshelfCoverManifest.covers ?? {});
  const haystack = books.map((book) => buildHaystackValue(book));
  const [matchIndexes] = fuzzy.search(haystack, normalizeNeedle(query).toLowerCase(), 5);

  return (matchIndexes ?? []).flatMap((index) => {
    const book = books[index];

    return book ? [book] : [];
  });
}

describe("bookshelf search matcher", () => {
  test("returns no matches for a nonsense query", () => {
    const results = searchBooks("dfsjnafsdhbfehjbbbhjewhj324523");

    expect(results).toHaveLength(0);
  });

  test("returns known books for a concrete title query", () => {
    const results = searchBooks("foundation");

    expect(results.some((book) => book.title === "Foundation")).toBe(true);
  });
});
