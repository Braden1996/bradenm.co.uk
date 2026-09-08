import bookshelfCoverManifest from "../../../../data/bookshelf-covers.json";
import bookshelfData from "../../../../data/bookshelf.json";
import bookshelfMetadata from "../../../../data/bookshelf-metadata.json";
import { buildBookshelfViewModel } from "./bookshelf-data";

/**
 * One server-side source for the shelf, wherever it is mounted. A stale cover
 * manifest degrades to colour placeholders rather than making the route fail.
 */
export function loadBookshelfSource() {
  const model = buildBookshelfViewModel(bookshelfData, bookshelfCoverManifest.covers);
  const details = new Map(
    bookshelfMetadata.map((record) => [`${record.title}::${record.author}`, record]),
  );
  model.payload.books.forEach((record, index) => {
    const book = model.books[index];
    const metadata = book && details.get(`${book.title}::${book.author}`);
    if (metadata) {
      record.details = {
        firstPublished: metadata.firstPublished,
        pages: metadata.pages,
        categories: metadata.categories,
      };
    }
  });
  return model;
}
