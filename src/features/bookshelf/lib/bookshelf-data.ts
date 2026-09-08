import type { TagTone } from "../../../components/lib/tag-tones";
import { atlasProfile, type AtlasBook } from "./atlas-layout";

type AuthorSegment = {
  label: string;
  separator: string;
};

export type BookPayloadRecord = {
  author: string;
  firstIndex: number;
  id: string;
  sortAuthor: string;
  sortTitle: string;
  title: string;
};

type BookshelfSearchRecord = {
  id: string;
  text: string;
  details?:
    | {
        firstPublished?: string | undefined;
        pages?: string | undefined;
        categories?: string[] | undefined;
      }
    | undefined;
};

export type BookshelfPayload = {
  books: BookshelfSearchRecord[];
  atlas: AtlasBook[];
};

export type BookshelfSortKey = "author" | "title";
export type BookshelfSortDirection = "asc" | "desc";

export type BookshelfSortState = {
  direction: BookshelfSortDirection;
  key: BookshelfSortKey;
};

export type BookViewModel = BookPayloadRecord & {
  authorSegments: AuthorSegment[];
  coverHeight: number;
  coverHue: number;
  coverSrc: string;
  coverSrcSet: string;
  coverWidth: number;
  coverCandidates: { src: string; width: number; height: number }[];
  mediumTags: {
    label: string;
    variant: TagTone;
  }[];
};

type BookshelfSourceRow = {
  author: string;
  medium: string;
  title: string;
};

type BookshelfCoverMap = Record<
  string,
  {
    candidates?: { src: string; width: number; height: number }[];
    height?: number;
    src?: string;
    width?: number;
  }
>;

type GroupedBook = Omit<BookViewModel, "authorSegments" | "mediumTags"> & {
  mediumSet: Set<string>;
};

const mediumOrder = ["Physical", "Audiobook", "Kindle"] as const;
const mediumOrderSet = new Set<string>(mediumOrder);
let sortCollator: Intl.Collator | undefined;

export function normalizeNeedle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return normalizeNeedle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hashText(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function stripLeadingArticle(value: string) {
  const trimmed = value.trim();
  const withoutLeadingMarks = trimmed.replace(/^[^A-Za-z0-9]+/, "");
  const withoutArticle = withoutLeadingMarks.replace(/^(?:the|an|a)\s+/i, "");

  return withoutArticle || withoutLeadingMarks || trimmed;
}

function mapMediumToVariant(medium: string): TagTone {
  const normalized = medium.trim().toLowerCase();

  if (normalized === "audiobook") {
    return "steel";
  }

  if (normalized === "kindle") {
    return "amber";
  }

  if (normalized === "physical") {
    return "sage";
  }

  return "neutral";
}

function splitAuthorSegments(author: string) {
  const segments: AuthorSegment[] = [];
  const separatorPattern = /\s*([&/+])\s*|\s+(and)\s+/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = separatorPattern.exec(author)) !== null) {
    const label = author.slice(lastIndex, match.index).trim();
    const separator = (match[1] ?? match[2] ?? "").trim();

    if (label) {
      segments.push({ label, separator });
    }

    lastIndex = separatorPattern.lastIndex;
  }

  const trailingLabel = author.slice(lastIndex).trim();

  if (trailingLabel) {
    segments.push({ label: trailingLabel, separator: "" });
  }

  return segments.length > 0 ? segments : [{ label: author.trim(), separator: "" }];
}

export function buildHaystackValue(book: Pick<BookPayloadRecord, "author" | "title">) {
  return `${normalizeNeedle(book.title)} ${normalizeNeedle(book.author)}`.trim();
}

export function formatBookshelfResultsCount(visible: number, total: number, filtered = false) {
  const noun = total === 1 ? "title" : "titles";

  return filtered ? `${visible} of ${total} ${noun}` : `${total} ${noun}`;
}

export function getNextBookshelfSortState(
  activeKey: BookshelfSortKey,
  activeDirection: BookshelfSortDirection,
  requestedKey: BookshelfSortKey,
): BookshelfSortState {
  if (requestedKey !== activeKey) {
    return { direction: "asc", key: requestedKey };
  }

  return {
    direction: activeDirection === "asc" ? "desc" : "asc",
    key: activeKey,
  };
}

export function compareBooks(
  left: Pick<BookPayloadRecord, "firstIndex" | "sortAuthor" | "sortTitle">,
  right: Pick<BookPayloadRecord, "firstIndex" | "sortAuthor" | "sortTitle">,
  sortKey: BookshelfSortKey,
  sortDirection: BookshelfSortDirection,
) {
  sortCollator ??= new Intl.Collator("en-GB", {
    ignorePunctuation: true,
    numeric: true,
    sensitivity: "base",
  });
  const comparison =
    sortKey === "author"
      ? sortCollator.compare(left.sortAuthor, right.sortAuthor) ||
        sortCollator.compare(left.sortTitle, right.sortTitle) ||
        left.firstIndex - right.firstIndex
      : sortCollator.compare(left.sortTitle, right.sortTitle) ||
        sortCollator.compare(left.sortAuthor, right.sortAuthor) ||
        left.firstIndex - right.firstIndex;

  return sortDirection === "asc" ? comparison : -comparison;
}

export type BookshelfViewModel = {
  books: BookViewModel[];
  payload: BookshelfPayload;
};

export function buildBookshelfViewModel(
  sourceRows: BookshelfSourceRow[],
  coverMap: BookshelfCoverMap,
): BookshelfViewModel {
  const groupedBooks = new Map<string, GroupedBook>();

  sourceRows.forEach((row, index) => {
    const author = row.author || "Unknown author";
    const key = `${normalizeText(row.title)}::${normalizeText(author)}`;
    const existing = groupedBooks.get(key);

    if (existing) {
      existing.mediumSet.add(row.medium);
      return;
    }

    const seed = hashText(`${row.title}::${author}`);

    groupedBooks.set(key, {
      id: `book-${groupedBooks.size + 1}`,
      title: row.title,
      author,
      mediumSet: new Set([row.medium]),
      firstIndex: index,
      sortTitle: stripLeadingArticle(row.title),
      sortAuthor: author.trim(),
      coverHue: 28 + (seed % 250),
      coverHeight: coverMap[key]?.height ?? 0,
      coverSrc: coverMap[key]?.src ?? "",
      coverSrcSet: (coverMap[key]?.candidates ?? [])
        .map((candidate) => `${candidate.src} ${candidate.width}w`)
        .join(", "),
      coverWidth: coverMap[key]?.width ?? 0,
      coverCandidates: coverMap[key]?.candidates ?? [],
    });
  });

  const books = [...groupedBooks.values()].map((groupedBook) => {
    const orderedMediums = [
      ...mediumOrder.filter((medium) => groupedBook.mediumSet.has(medium)),
      ...[...groupedBook.mediumSet]
        .filter((medium) => !mediumOrderSet.has(medium))
        .toSorted((left, right) => left.localeCompare(right)),
    ];

    return {
      id: groupedBook.id,
      title: groupedBook.title,
      author: groupedBook.author,
      firstIndex: groupedBook.firstIndex,
      sortTitle: groupedBook.sortTitle,
      sortAuthor: groupedBook.sortAuthor,
      coverHue: groupedBook.coverHue,
      coverHeight: groupedBook.coverHeight,
      coverSrc: groupedBook.coverSrc,
      coverSrcSet: groupedBook.coverSrcSet,
      coverWidth: groupedBook.coverWidth,
      coverCandidates: groupedBook.coverCandidates,
      authorSegments: splitAuthorSegments(groupedBook.author),
      mediumTags: orderedMediums.map((medium) => ({
        label: medium,
        variant: mapMediumToVariant(medium),
      })),
    };
  });

  books.sort((left, right) => compareBooks(left, right, "title", "asc"));

  return {
    books,
    payload: {
      atlas: books.map((book, atlasIndex) => ({
        id: book.id,
        atlasIndex,
        title: book.title,
        author: book.author,
        formats: book.mediumTags.map((tag) => tag.label),
        cover: {
          src: book.coverSrc,
          width: book.coverWidth,
          height: book.coverHeight,
          candidates: book.coverCandidates,
        },
        profile: atlasProfile(book.title, book.author, book.coverWidth, book.coverHeight),
      })),
      books: books.map((book) => ({
        id: book.id,
        text: buildHaystackValue(book),
      })),
    },
  };
}
