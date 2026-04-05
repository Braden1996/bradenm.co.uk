import uFuzzy from "@leeoniya/ufuzzy";

type BookRecord = {
  id: string;
  title: string;
  author: string;
  firstIndex: number;
  sortAuthor: string;
  sortTitle: string;
  coverSrc: string;
  cacheKey: string;
};

type BookshelfPayload = {
  books: BookRecord[];
};

type BookshelfCard = {
  book: BookRecord;
  card: HTMLElement;
  haystack: string;
};

type SortKey = "title" | "author";
type SortDirection = "asc" | "desc";

// This keeps title/author search forgiving for small typos and omitted spaces/hyphens.
const fuzzy = new uFuzzy({
  intraMode: 1,
  intraChars: "[a-z\\d' -]",
});
const sortCollator = new Intl.Collator("en-GB", {
  ignorePunctuation: true,
  numeric: true,
  sensitivity: "base",
});

function normalizeNeedle(value: string) {
  return uFuzzy.latinize(value).replace(/\s+/g, " ").trim();
}

function buildHaystackValue(book: Pick<BookRecord, "title" | "author">) {
  return uFuzzy.latinize(`${book.title} ${book.author}`);
}

function compareBooks(
  left: Pick<BookRecord, "firstIndex" | "sortAuthor" | "sortTitle">,
  right: Pick<BookRecord, "firstIndex" | "sortAuthor" | "sortTitle">,
  sortKey: SortKey,
  sortDirection: SortDirection,
) {
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

function initBookshelf() {
  const payloadElement = document.querySelector<HTMLScriptElement>("#bookshelf-data");

  if (!payloadElement?.textContent || payloadElement.dataset.bookshelfInitialized === "true") {
    return;
  }

  payloadElement.dataset.bookshelfInitialized = "true";

  const payload = JSON.parse(payloadElement.textContent) as BookshelfPayload;
  const books = payload.books;
  const rawBookGrid = document.querySelector<HTMLElement>("[data-book-grid]");

  if (!rawBookGrid) {
    return;
  }

  const bookGrid = rawBookGrid;
  const allCards = Array.from(document.querySelectorAll<HTMLElement>("[data-book-card]"));
  const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]");
  const clearSearchButton = document.querySelector<HTMLButtonElement>("[data-clear-search]");
  const emptyState = document.querySelector<HTMLElement>("[data-empty-state]");
  const emptyReset = document.querySelector<HTMLButtonElement>("[data-empty-reset]");
  const resultsCount = document.querySelector<HTMLElement>("[data-results-count]");
  const sortButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-sort-toggle]"),
  );
  let activeSortKey: SortKey = "title";
  let activeSortDirection: SortDirection = "asc";

  const cardById = new Map(
    allCards
      .map((card) => {
        const bookId = card.dataset.bookId;

        return bookId ? ([bookId, card] as const) : null;
      })
      .filter((entry): entry is readonly [string, HTMLElement] => Boolean(entry)),
  );

  const cards = books.reduce<BookshelfCard[]>((entries, book) => {
    const card = cardById.get(book.id);

    if (!card) {
      return entries;
    }

    entries.push({
      book,
      card,
      haystack: buildHaystackValue(book),
    });

    return entries;
  }, []);

  const haystack = cards.map(({ haystack: searchValue }) => searchValue);

  function updateResults(count: number) {
    if (resultsCount) {
      resultsCount.textContent = String(count);
    }

    if (emptyState) {
      emptyState.hidden = count !== 0;
    }
  }

  function syncControlState() {
    if (clearSearchButton) {
      clearSearchButton.hidden = !searchInput || searchInput.value.length === 0;
    }
  }

  function syncSortState() {
    for (const button of sortButtons) {
      const buttonSortKey = button.dataset.sortToggle;

      if (buttonSortKey !== "title" && buttonSortKey !== "author") {
        continue;
      }

      const isActive = buttonSortKey === activeSortKey;
      const currentDirection = isActive ? activeSortDirection : "none";
      const label = button.dataset.sortLabel?.trim() ?? buttonSortKey;

      button.dataset.sortDirection = currentDirection;
      button.setAttribute("aria-pressed", String(isActive));
      button.setAttribute(
        "aria-label",
        isActive
          ? `Sort by ${label}. Currently ${
              activeSortDirection === "asc" ? "ascending" : "descending"
            }. Activate to switch to ${activeSortDirection === "asc" ? "descending" : "ascending"}.`
          : `Sort by ${label}.`,
      );
    }
  }

  function renderCards(visibleIndexes: number[]) {
    const fragment = document.createDocumentFragment();
    const visibleIndexSet = new Set(visibleIndexes);

    for (const index of visibleIndexes) {
      const card = cards[index]?.card;

      if (!card) {
        continue;
      }

      card.hidden = false;
      fragment.append(card);
    }

    cards.forEach(({ card }, index) => {
      if (visibleIndexSet.has(index)) {
        return;
      }

      card.hidden = true;
      fragment.append(card);
    });

    bookGrid.append(fragment);
  }

  function getVisibleIndexes(query: string) {
    if (!query) {
      return cards.map((_, index) => index);
    }

    const [matchIndexes] = fuzzy.search(haystack, query, 5);

    if (matchIndexes == null || matchIndexes.length === 0) {
      return [];
    }

    return Array.from(matchIndexes);
  }

  function applySearch() {
    const query = normalizeNeedle(searchInput?.value ?? "");
    const visibleIndexes = getVisibleIndexes(query).toSorted((leftIndex, rightIndex) =>
      compareBooks(
        cards[leftIndex].book,
        cards[rightIndex].book,
        activeSortKey,
        activeSortDirection,
      ),
    );

    renderCards(visibleIndexes);
    updateResults(visibleIndexes.length);
    syncControlState();
  }

  function setSearchValue(nextValue: string) {
    if (!searchInput) {
      return;
    }

    searchInput.value = nextValue;
    applySearch();
    searchInput.focus();
  }

  searchInput?.addEventListener("input", applySearch);
  searchInput?.addEventListener("search", applySearch);

  clearSearchButton?.addEventListener("click", () => setSearchValue(""));
  emptyReset?.addEventListener("click", () => setSearchValue(""));

  for (const button of sortButtons) {
    button.addEventListener("click", () => {
      const buttonSortKey = button.dataset.sortToggle;

      if (buttonSortKey !== "title" && buttonSortKey !== "author") {
        return;
      }

      if (buttonSortKey === activeSortKey) {
        activeSortDirection = activeSortDirection === "asc" ? "desc" : "asc";
      } else {
        activeSortKey = buttonSortKey;
        activeSortDirection = "asc";
      }

      syncSortState();
      applySearch();
    });
  }

  bookGrid.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const authorButton = target.closest<HTMLButtonElement>("[data-author-filter]");
    const authorName = authorButton?.dataset.authorFilter?.trim();

    if (!authorName) {
      return;
    }

    setSearchValue(authorName);
  });

  syncSortState();
  applySearch();
}

initBookshelf();
document.addEventListener("astro:page-load", initBookshelf);
