// cspell:words philosoph psycholog autobiograph theater collectionid
import { array, number, object, optional, parse, pipe, string, transform, union } from "valibot";
import type { BookDetails } from "../../src/features/bookshelf/lib/book-details";

const text = optional(string());
const strings = optional(array(string()));
const reference = object({ key: string() });
const description = optional(
  union([
    string(),
    pipe(
      object({ value: string() }),
      transform((record) => record.value),
    ),
  ]),
);
const searchSchema = object({
  docs: array(
    object({
      key: string(),
      title: string(),
      author_name: strings,
      subject: strings,
      first_publish_year: optional(number()),
      cover_i: optional(number()),
      edition_count: optional(number()),
    }),
  ),
});
const editionSchema = object({
  key: string(),
  title: string(),
  works: optional(array(reference)),
  description,
  publishers: strings,
  publish_date: text,
  number_of_pages: optional(number()),
  subjects: strings,
});
const workSchema = object({ key: string(), title: string(), description, subjects: strings });

export type CatalogueBook = { title: string; author: string };
export type CoverMatch = CatalogueBook & {
  sourceUrl?: string;
  matchedTitle?: string;
  matchedAuthor?: string;
};
export type MetadataEntry = {
  title: string;
  author: string;
  checkedAt: string;
  status: "matched" | "unmatched" | "error";
  reason?: string | undefined;
  work?: string | undefined;
  edition?: string | undefined;
  details?: BookDetails | undefined;
  subjects?: string[] | undefined;
};
type SearchBook = ReturnType<typeof readSearch>[number];

function normalizeMetadata(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function metadataKey(book: CatalogueBook) {
  return `${normalizeMetadata(book.title)}::${normalizeMetadata(book.author)}`;
}

function titleMatches(title: string, candidate: string) {
  return (
    normalizeMetadata(title.split(":")[0] ?? title) ===
    normalizeMetadata(candidate.split(":")[0] ?? candidate)
  );
}

export function authorMatches(author: string, candidates: string[]) {
  const actual = normalizeMetadata(candidates.join(" ")).split(" ");
  return author.split(/\s*[&;]\s*/).every((part) => {
    const tokens = normalizeMetadata(part.replace(/\([^)]*\)|\b(?:Dr|M\.?D\.?|ed)\b/gi, ""))
      .split(" ")
      .filter((token) => token.length > 1 && token !== "and");
    return tokens.length > 0 && tokens.every((token) => actual.includes(token));
  });
}

export function readSearch(json: string) {
  return parse(searchSchema, JSON.parse(json)).docs;
}

export function chooseWork(book: CatalogueBook, candidates: SearchBook[], cover?: CoverMatch) {
  const eligible = candidates.filter(
    (candidate) =>
      (titleMatches(book.title, candidate.title) ||
        (cover?.matchedTitle && titleMatches(cover.matchedTitle, candidate.title))) &&
      authorMatches(book.author, candidate.author_name ?? []),
  );
  const coverId = cover?.sourceUrl?.match(/covers\.openlibrary\.org\/b\/id\/(\d+)/)?.[1];
  return eligible.toSorted(
    (a, b) =>
      Number(String(b.cover_i) === coverId) - Number(String(a.cover_i) === coverId) ||
      (b.edition_count ?? 0) - (a.edition_count ?? 0),
  )[0];
}

export function readEdition(json: string, book: CatalogueBook, cover?: CoverMatch) {
  const edition = parse(editionSchema, JSON.parse(json));
  if (
    !titleMatches(book.title, edition.title) &&
    !(cover?.matchedTitle && titleMatches(cover.matchedTitle, edition.title))
  )
    return undefined;
  return edition;
}

export function readWork(json: string) {
  return parse(workSchema, JSON.parse(json));
}

/** Small attributed catalogue excerpts; never render third-party HTML or markup. */
export function catalogueExcerpt(source?: string) {
  if (!source || /^(duplicate|see also|this edition|source:)/i.test(source)) return undefined;
  const clean = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (entity) =>
        ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "", "&gt;": "", "&nbsp;": " " })[
          entity
        ] ?? " ",
    )
    .replace(/[*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = clean.split(" ");
  if (words.length < 8) return undefined;
  return words.length > 24
    ? `${words
        .slice(0, 24)
        .join(" ")
        .replace(/[,;:—-]+$/, "")}…`
    : clean;
}

const subjects: [RegExp, string][] = [
  [/science fiction|space opera/i, "Science fiction"],
  [/fantasy|magic|wizards/i, "Fantasy"],
  [/philosoph|ethics|consciousness/i, "Philosophy"],
  [/psycholog|human behavior|cognitive/i, "Psychology"],
  [/biograph|autobiograph|memoir/i, "Biography"],
  [/history|civilization|world war/i, "History"],
  [/politic|government|geopolitic/i, "Politics"],
  [/economic/i, "Economics"],
  [/invest|finance|stock|trading|money|bitcoin/i, "Finance"],
  [/business|entrepreneur|management|leadership/i, "Business"],
  [/computer|programming|software|artificial intelligence/i, "Technology"],
  [/mathematics|geometry|statistics/i, "Mathematics"],
  [/physics|astronomy|cosmology|biology|science/i, "Science"],
  [/health|nutrition|longevity|aging|exercise|fitness|breath/i, "Health"],
  [/cook|food|recipes/i, "Food & cooking"],
  [/dog|animal|nature|bird/i, "Nature"],
  [/travel|guidebooks|geography/i, "Travel"],
  [
    /\b(?:architecture|design|theater|theatre|circus)\b|(?:^|[;/])\s*(?:arts?|fine arts|visual arts)(?:$|[;/])|\bart (?:history|criticism)\b/i,
    "Art & design",
  ],
  [/communication|interpersonal/i, "Communication"],
  [/self-help|personal growth|self-improvement|time management/i, "Personal growth"],
  [/detective|mystery|thriller|crime fiction/i, "Mystery"],
];

export function catalogueCategories(values: string[] = []) {
  // Match subject phrases, never titles. Ignore catalogue/control tags and translations.
  const content = values
    .filter(
      (value) => !/^(accessible|protected|large type|in library|nyt:|collectionid)/i.test(value),
    )
    .join("; ");
  const tags = subjects.filter(([pattern]) => pattern.test(content)).map(([, label]) => label);
  if (tags.includes("Science fiction")) return tags.filter((tag) => tag !== "Science").slice(0, 3);
  return tags.slice(0, 3);
}

export function makeDetails(
  book: CatalogueBook,
  work: ReturnType<typeof readWork>,
  match?: SearchBook,
  edition?: ReturnType<typeof readEdition>,
): BookDetails {
  const source = `https://openlibrary.org${work.key}`;
  const workExcerpt = catalogueExcerpt(work.description);
  const excerpt = workExcerpt ?? catalogueExcerpt(edition?.description);
  const categories = catalogueCategories(work.subjects ?? match?.subject ?? edition?.subjects);
  const year = match?.key === work.key ? match.first_publish_year : undefined;
  const details: BookDetails = { ...book, sources: [source] };
  if (excerpt) {
    details.description = excerpt;
    details.excerptSource =
      workExcerpt || !edition ? source : `https://openlibrary.org${edition.key}`;
  }
  if (year && year > 0 && year <= new Date().getFullYear()) details.firstPublished = String(year);
  if (categories.length) details.categories = categories;
  // Edition fields come only from the edition associated with the recorded cover.
  if (edition) {
    details.sources.push(`https://openlibrary.org${edition.key}`);
    if (edition.publishers?.[0]) details.publisher = edition.publishers[0];
    if (edition.publish_date) details.released = edition.publish_date;
    if (edition.number_of_pages && edition.number_of_pages > 0)
      details.pages = String(edition.number_of_pages);
  }
  return details;
}

export function mergeDetails(
  books: CatalogueBook[],
  entries: MetadataEntry[],
  overrides: BookDetails[],
) {
  const cache = new Map(entries.map((entry) => [metadataKey(entry), entry.details]));
  const curated = new Map(overrides.map((entry) => [metadataKey(entry), entry]));
  return books.flatMap((book) => {
    const fetched = cache.get(metadataKey(book));
    const override = curated.get(metadataKey(book));
    if (!fetched && !override) return [];
    const result = { sources: [], ...fetched, ...override, ...book };
    result.sources = [...new Set([...(override?.sources ?? []), ...(fetched?.sources ?? [])])];
    if (override?.description) delete result.excerptSource;
    return [result];
  });
}
