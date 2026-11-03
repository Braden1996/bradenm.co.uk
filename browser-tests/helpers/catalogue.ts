import type { Page } from "@playwright/test";
import bookshelfCoverManifest from "../../data/bookshelf-covers.json";
import bookshelfData from "../../data/bookshelf.json";
import {
  buildBookshelfViewModel,
  buildHaystackValue,
} from "../../src/features/bookshelf/lib/bookshelf-data";
import { findBookshelfMatchIndexes } from "../../src/features/bookshelf/lib/bookshelf-search";

// The shelf grows whenever a book is added. Tests read its size, its search
// results and its books by title from the catalogue itself rather than from
// counts or positions that every addition would move.
const shelf = buildBookshelfViewModel(bookshelfData, bookshelfCoverManifest.covers);

/** The number of distinct books the shelf prints. */
export const BOOK_COUNT = shelf.books.length;

/** How many books the shelf's own search finds for a query. */
export function searchMatchCount(query: string) {
  return findBookshelfMatchIndexes(shelf.payload.atlas.map(buildHaystackValue), query).length;
}

/** A book's button by its title, wherever that title now sorts. */
export function bookButton(page: Page, title: string) {
  return page.locator(`[data-book-open][aria-label^="${title} — "]`);
}
