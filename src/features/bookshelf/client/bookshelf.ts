import uFuzzy from "@leeoniya/ufuzzy";
import {
  buildHaystackValue,
  compareBooks,
  normalizeNeedle,
  type BookPayloadRecord,
  type BookshelfPayload,
} from "../lib/bookshelf-data";

type BookshelfCard = {
  book: BookPayloadRecord;
  card: HTMLElement;
  haystack: string;
};

type SortKey = "author" | "title";
type SortDirection = "asc" | "desc";

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraChars: "[a-z\\d' -]",
});

function isBookPayloadRecord(value: unknown): value is BookPayloadRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "author" in value &&
    typeof value.author === "string" &&
    "firstIndex" in value &&
    typeof value.firstIndex === "number" &&
    "id" in value &&
    typeof value.id === "string" &&
    "sortAuthor" in value &&
    typeof value.sortAuthor === "string" &&
    "sortTitle" in value &&
    typeof value.sortTitle === "string" &&
    "title" in value &&
    typeof value.title === "string"
  );
}

function isBookshelfPayload(value: unknown): value is BookshelfPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "books" in value &&
    Array.isArray(value.books) &&
    value.books.every(isBookPayloadRecord)
  );
}

function initBookshelf() {
  const payloadElement = document.querySelector<HTMLScriptElement>("#bookshelf-data");

  if (!payloadElement?.textContent || payloadElement.dataset.bookshelfInitialized === "true") {
    return;
  }

  payloadElement.dataset.bookshelfInitialized = "true";

  const parsedPayload: unknown = JSON.parse(payloadElement.textContent);

  if (!isBookshelfPayload(parsedPayload)) {
    return;
  }

  const payload = parsedPayload;
  const books = payload.books;
  const rawBookGrid = document.querySelector<HTMLElement>("[data-book-grid]");

  if (!rawBookGrid) {
    return;
  }

  const bookGrid = rawBookGrid;
  const allCards = Array.from(document.querySelectorAll<HTMLElement>("[data-book-card]"));
  const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]");
  const searchRoot = searchInput?.closest<HTMLElement>("[data-overlay-search]");
  const clearSearchButton = document.querySelector<HTMLButtonElement>("[data-clear-search]");
  const emptyState = document.querySelector<HTMLElement>("[data-empty-state]");
  const emptyReset = document.querySelector<HTMLButtonElement>("[data-empty-reset]");
  const resultsCount = document.querySelector<HTMLElement>("[data-results-count]");
  const sortButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-sort-toggle]"),
  );
  let activeSortKey: SortKey = "title";
  let activeSortDirection: SortDirection = "asc";
  let pendingSearchFrame = 0;

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
    const countText = String(count);

    if (resultsCount && resultsCount.textContent !== countText) {
      resultsCount.textContent = countText;
    }

    const shouldHideEmptyState = count !== 0;

    if (emptyState && emptyState.hidden !== shouldHideEmptyState) {
      emptyState.hidden = shouldHideEmptyState;
    }
  }

  function isSearchOpen() {
    return searchRoot?.dataset.state === "open";
  }

  function syncControlState() {
    if (clearSearchButton) {
      const shouldHideClearButton =
        !searchInput || (!isSearchOpen() && normalizeNeedle(searchInput.value).length === 0);

      if (clearSearchButton.hidden !== shouldHideClearButton) {
        clearSearchButton.hidden = shouldHideClearButton;
      }
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
    const visibleIndexSet = new Set(visibleIndexes);

    cards.forEach(({ card }, index) => {
      const shouldHide = !visibleIndexSet.has(index);

      if (card.hidden !== shouldHide) {
        card.hidden = shouldHide;
      }
    });

    let currentVisibleCard = bookGrid.firstElementChild;

    for (const index of visibleIndexes) {
      const card = cards[index]?.card;

      if (!card) {
        continue;
      }

      while (currentVisibleCard instanceof HTMLElement && currentVisibleCard.hidden) {
        currentVisibleCard = currentVisibleCard.nextElementSibling;
      }

      if (currentVisibleCard !== card) {
        bookGrid.insertBefore(card, currentVisibleCard);
      }

      currentVisibleCard = card.nextElementSibling;
    }
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
    if (pendingSearchFrame) {
      cancelAnimationFrame(pendingSearchFrame);
      pendingSearchFrame = 0;
    }

    const query = normalizeNeedle(searchInput?.value ?? "").toLowerCase();
    const visibleIndexes = getVisibleIndexes(query).toSorted((leftIndex, rightIndex) => {
      const leftCard = cards[leftIndex];
      const rightCard = cards[rightIndex];

      if (!leftCard || !rightCard) {
        return 0;
      }

      return compareBooks(leftCard.book, rightCard.book, activeSortKey, activeSortDirection);
    });

    renderCards(visibleIndexes);
    updateResults(visibleIndexes.length);
    syncControlState();
  }

  function scheduleSearch() {
    if (pendingSearchFrame) {
      return;
    }

    pendingSearchFrame = requestAnimationFrame(() => {
      pendingSearchFrame = 0;
      applySearch();
    });
  }

  function setSearchValue(nextValue: string) {
    if (!searchInput) {
      return;
    }

    searchInput.value = nextValue;
    applySearch();
    searchInput.focus();
  }

  function closeSearch() {
    if (!searchInput) {
      return;
    }

    searchInput.value = "";
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  }

  searchInput?.addEventListener("input", scheduleSearch);
  searchInput?.addEventListener("search", scheduleSearch);

  clearSearchButton?.addEventListener("click", () => {
    if (!searchInput) {
      return;
    }

    if (normalizeNeedle(searchInput.value).length === 0) {
      closeSearch();
      return;
    }

    setSearchValue("");
  });
  emptyReset?.addEventListener("click", () => setSearchValue(""));

  searchRoot?.addEventListener("focusin", syncControlState);
  searchRoot?.addEventListener("focusout", () => {
    requestAnimationFrame(syncControlState);
  });

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
  updateResults(cards.length);
  syncControlState();
}

initBookshelf();
document.addEventListener("astro:page-load", initBookshelf);
