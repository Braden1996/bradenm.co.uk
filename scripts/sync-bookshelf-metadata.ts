// cspell:words picklist olid
import { readFile, rename, writeFile } from "node:fs/promises";
import { format } from "prettier";
import { array, literal, nullish, object, optional, parse, picklist, string } from "valibot";
import catalogue from "../data/bookshelf.json";
import covers from "../data/bookshelf-covers.json";
import overrides from "../data/bookshelf-details.json";
import { bookDetailsRecordSchema } from "../src/features/bookshelf/lib/book-details";
import {
  authorMatches,
  catalogueCategories,
  chooseWork,
  makeDetails,
  mergeDetails,
  metadataKey,
  readEdition,
  readSearch,
  readWork,
  type CatalogueBook,
  type CoverMatch,
  type MetadataEntry,
} from "./lib/bookshelf-metadata";

const cachePath = new URL("../data/bookshelf-metadata-cache.json", import.meta.url);
const outputPath = new URL("../data/bookshelf-metadata.json", import.meta.url);
const reportPath = new URL("../data/bookshelf-metadata-report.json", import.meta.url);
const cacheSchema = object({
  version: literal(1),
  entries: array(
    object({
      title: string(),
      author: string(),
      checkedAt: string(),
      status: picklist(["matched", "unmatched", "error"]),
      reason: optional(string()),
      work: optional(string()),
      edition: optional(string()),
      details: optional(bookDetailsRecordSchema),
      subjects: optional(array(string())),
    }),
  ),
});
const flags = new Set(process.argv.slice(2));
const offline =
  flags.has("--offline") || flags.has("--check") || process.env.BOOKSHELF_METADATA_OFFLINE === "1";
const refresh = flags.has("--refresh");
const retry = flags.has("--retry");
const build = flags.has("--build");
const books = [
  ...new Map(
    catalogue.map(({ title, author }) => {
      const book = { title, author };
      return [metadataKey(book), book] as const;
    }),
  ).values(),
].toSorted((a, b) => metadataKey(a).localeCompare(metadataKey(b), "en"));
const coverMap = new Map<string, CoverMatch>(
  Object.values(covers.covers).map((cover) => [metadataKey(cover), cover]),
);
let entries: MetadataEntry[] = [];
try {
  entries = parse(cacheSchema, JSON.parse(await readFile(cachePath, "utf8"))).entries;
} catch (error) {
  // Missing caches are expected on first use; malformed committed data is an error.
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const byBook = new Map(entries.map((entry) => [metadataKey(entry), entry]));
const deadline = Date.now() + (build ? 45_000 : Infinity);
let nextRequest = 0;
let failures = 0;
let requests = 0;

async function get(url: string) {
  if (offline) throw new Error("Network disabled");
  if (Date.now() >= deadline || failures >= 3 || (build && requests >= 24)) {
    throw new Error("Lookup budget reached; saved metadata retained");
  }
  const start = Math.max(Date.now(), nextRequest);
  nextRequest = start + 400;
  await Bun.sleep(Math.max(0, start - Date.now()));
  requests++;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "BradenBookshelf/1.0 (https://bradenm.co.uk; braden1996@hotmail.co.uk)",
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
    failures = 0;
    return await response.text();
  } catch (error) {
    failures++;
    throw error;
  }
}

async function lookup(book: CatalogueBook): Promise<MetadataEntry> {
  const cover = coverMap.get(metadataKey(book));
  const result: MetadataEntry = {
    ...book,
    checkedAt: new Date().toISOString(),
    status: "unmatched",
  };
  const search = new URL("https://openlibrary.org/search.json");
  search.searchParams.set("title", book.title.split(":")[0] ?? book.title);
  search.searchParams.set(
    "author",
    (book.author.split(/[&;]/)[0] ?? book.author).replace(/\([^)]*\)|\b(?:Dr|M\.?D\.?)\b/gi, ""),
  );
  search.searchParams.set("limit", "6");
  search.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,subject,cover_i,edition_count",
  );
  let match = chooseWork(book, readSearch(await get(search.href)), cover);
  if (!match && cover?.matchedTitle && cover.matchedTitle !== book.title) {
    search.searchParams.set("title", cover.matchedTitle);
    match = chooseWork(book, readSearch(await get(search.href)), cover);
  }
  let edition: ReturnType<typeof readEdition>;
  const coverId = cover?.sourceUrl?.match(/^https:\/\/covers\.openlibrary\.org\/b\/id\/(\d+)/)?.[1];
  if (coverId && cover?.matchedAuthor && authorMatches(book.author, [cover.matchedAuthor])) {
    const image = parse(
      object({ olid: nullish(string()) }),
      JSON.parse(await get(`https://covers.openlibrary.org/b/id/${coverId}.json`)),
    );
    if (image.olid && /^OL\d+M$/.test(image.olid)) {
      edition = readEdition(
        await get(`https://openlibrary.org/books/${image.olid}.json`),
        book,
        cover,
      );
    }
  }
  const workKey = edition?.works?.[0]?.key ?? match?.key;
  if (!workKey || !/^\/works\/OL\d+W$/.test(workKey)) {
    result.reason = "No confident title and author match";
    return result;
  }
  const work = readWork(await get(`https://openlibrary.org${workKey}.json`));
  result.work = work.key;
  if (edition) result.edition = edition.key;
  result.details = makeDetails(book, work, match, edition);
  result.subjects = work.subjects ?? match?.subject ?? edition?.subjects ?? [];
  result.status = "matched";
  return result;
}

async function save(path: URL, value: string) {
  const temporary = new URL(`${path.href}.${process.pid}.tmp`);
  await writeFile(temporary, await format(value, { parser: "json", printWidth: 100 }));
  await rename(temporary, path);
}

if (!offline) {
  const pending = books.filter((book) => {
    const entry = byBook.get(metadataKey(book));
    return refresh || !entry || (retry && entry.status !== "matched");
  });
  // Two workers share one rate gate. Cache writes are serial and atomic.
  let checkpoint = Promise.resolve();
  const queue = [...pending];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length) {
        if (failures >= 3 || Date.now() >= deadline || (build && requests >= 24)) break;
        const book = queue.shift();
        if (!book) break;
        const previous = byBook.get(metadataKey(book));
        let result: MetadataEntry;
        try {
          // eslint-disable-next-line no-await-in-loop -- Keep catalogue traffic bounded to two workers.
          result = await lookup(book);
          // Never erase a successful record because a catalogue stopped finding it.
          if (previous?.details && !result.details) result.details = previous.details;
        } catch (error) {
          result = {
            ...previous,
            ...book,
            checkedAt: new Date().toISOString(),
            status: "error",
            reason: error instanceof Error ? error.message : "Lookup failed",
          };
        }
        byBook.set(metadataKey(book), result);
        const snapshot =
          JSON.stringify({ version: 1, entries: [...byBook.values()] }, null, 2) + "\n";
        checkpoint = checkpoint.then(() => save(cachePath, snapshot));
        console.log(
          `${pending.length - queue.length}/${pending.length} ${result.status}: ${book.title}`,
        );
      }
    }),
  );
  await checkpoint;
}
entries = books.flatMap((book) => {
  const entry = byBook.get(metadataKey(book));
  return entry ? [entry] : [];
});
// Canonical field order makes a fresh network sync identical to an offline rebuild.
entries = parse(cacheSchema, { version: 1, entries }).entries;
for (const entry of entries) {
  if (entry.details && entry.subjects) {
    const categories = catalogueCategories(entry.subjects);
    if (categories.length) entry.details.categories = categories;
    else delete entry.details.categories;
  }
}
const details = mergeDetails(books, entries, parse(array(bookDetailsRecordSchema), overrides));
const detailsMap = new Map(details.map((detail) => [metadataKey(detail), detail]));
const fields = ["description", "categories", "firstPublished", "publisher", "pages"] as const;
const report = {
  total: books.length,
  matched: details.length,
  coverage: Object.fromEntries(
    fields.map((field) => [field, details.filter((detail) => detail[field]?.length).length]),
  ),
  unresolved: books.flatMap((book) => {
    const detail = detailsMap.get(metadataKey(book));
    const missing = fields.filter((field) => !detail?.[field]?.length);
    const entry = byBook.get(metadataKey(book));
    return missing.length
      ? [
          {
            ...book,
            status: entry?.status ?? "pending",
            missing,
            reason: entry?.reason ?? "Not provided by the matched catalogue record",
          },
        ]
      : [];
  }),
};
const outputs: [URL, string][] = [
  [cachePath, JSON.stringify({ version: 1, entries }, null, 2) + "\n"],
  [outputPath, JSON.stringify(details, null, 2) + "\n"],
  [reportPath, JSON.stringify(report, null, 2) + "\n"],
];
await Promise.all(
  outputs.map(async ([path, content]) => {
    if (flags.has("--check")) {
      if (
        (await readFile(path, "utf8")) !==
        (await format(content, { parser: "json", printWidth: 100 }))
      )
        throw new Error(`Stale ${path.pathname}; run bun run bookshelf:metadata --offline`);
    } else {
      await save(path, content);
    }
  }),
);
console.log(
  `Metadata: ${details.length}/${books.length} books; ${report.coverage.description} descriptions; ${requests} requests. See data/bookshelf-metadata-report.json.`,
);
