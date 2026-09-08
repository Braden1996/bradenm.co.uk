import uFuzzy from "@leeoniya/ufuzzy";
import { normalizeNeedle } from "./bookshelf-data";

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraChars: "[a-z\\d' -]",
});

export function findBookshelfMatchIndexes(haystack: string[], rawQuery: string) {
  const query = normalizeNeedle(rawQuery).toLowerCase();

  if (!query) {
    return haystack.map((_, index) => index);
  }

  const [matchIndexes, info, order] = fuzzy.search(haystack, query, 5);

  if (info && order) return order.flatMap((index) => info.idx[index] ?? []);

  return matchIndexes == null ? [] : Array.from(matchIndexes);
}
