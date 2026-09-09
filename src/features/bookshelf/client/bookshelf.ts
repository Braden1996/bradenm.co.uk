// cspell:ignore describedby
import {
  formatBookshelfResultsCount,
  normalizeNeedle,
  type BookshelfPayload,
} from "../lib/bookshelf-data";
import {
  atlasTableLayout,
  atlasSearchLayout,
  atlasFittedView,
  atlasTableStyle,
  atlasBookStyle,
  atlasClampCamera,
  atlasZoomAt,
  ATLAS_PADDING,
  type AtlasCamera,
  type AtlasView,
} from "../lib/atlas-camera";
import { ATLAS, type AtlasBook } from "../lib/atlas-layout";
import { atlasTransition } from "../lib/atlas-transition";
import { findBookshelfMatchIndexes } from "../lib/bookshelf-search";
import {
  readEnhancementTier,
  reportWebGLFailure,
  watchEnhancementPolicy,
} from "../../../components/lib/enhancement-policy";
import type { AtlasElements, AtlasRenderer } from "./atlas-renderer";
import { parseAtlasPayload } from "../lib/atlas-payload";
import { loadBookDetails, paintBookDetails } from "./book-details";
import { crumpleNote } from "./note-crumple";
import { placeBookTooltip } from "../lib/book-tooltip";

type BookCard = {
  card: HTMLElement;
  button: HTMLButtonElement;
  book: AtlasBook;
  text: string;
  details: BookshelfPayload["books"][number]["details"];
};

function motion() {
  return readEnhancementTier() !== "static";
}

export function mountBookshelf(root: HTMLElement) {
  if (root.dataset.bookshelfInitialized === "true") return;
  const payload = parseAtlasPayload(
    root.querySelector("[data-bookshelf-payload]")?.textContent ?? "",
  );
  const atlas = root.querySelector<HTMLElement>("[data-atlas]");
  const stage = root.querySelector<HTMLElement>("[data-atlas-stage]");
  const scroll = root.querySelector<HTMLElement>("[data-atlas-scroll]");
  const canvas = root.querySelector<HTMLCanvasElement>("[data-atlas-canvas]");
  const frozen = root.querySelector<HTMLCanvasElement>("[data-atlas-frozen]");
  const dialog = root.querySelector<HTMLDialogElement>("[data-book-inspector]");
  const inspectorCanvas = root.querySelector<HTMLElement>("[data-inspector-canvas]");
  const anchor = root.querySelector<HTMLElement>("[data-inspect-anchor]");
  if (
    !payload ||
    !atlas ||
    !stage ||
    !scroll ||
    !canvas ||
    !frozen ||
    !dialog ||
    !inspectorCanvas ||
    !anchor
  )
    return;
  const elements: AtlasElements = {
    atlas,
    stage,
    scroll,
    canvas,
    frozen,
    dialog,
    inspectorCanvas,
    anchor,
    sheet: atlas.dataset.atlasSheet ?? "",
    sheetCount: Number(atlas.dataset.atlasSheetCount),
  };
  const abort = new AbortController();
  const { signal } = abort;
  const input = document.getElementById(`${root.dataset.bookshelfInstance}-search`);
  const search = input instanceof HTMLInputElement ? input : null;
  const categoryClear = search
    ?.closest("[data-bookshelf-toolbar]")
    ?.querySelector<HTMLButtonElement>("[data-category-clear]");
  const categoryLabel = categoryClear?.querySelector<HTMLElement>("[data-category-label]");
  let category: string | null = null;
  const result = root.querySelector<HTMLElement>("[data-results-count]");
  const empty = root.querySelector<HTMLElement>("[data-empty-state]");
  const tooltip = root.querySelector<HTMLElement>("[data-atlas-tooltip]");
  const tooltipArrow = root.querySelector<SVGSVGElement>("[data-atlas-tooltip-arrow]");
  let tooltipAnimations: Animation[] = [];
  const track = root.querySelector<HTMLElement>("[data-book-grid]");
  const title = dialog.querySelector<HTMLElement>("[data-inspect-title]");
  const author = dialog.querySelector<HTMLElement>("[data-inspect-author]");
  const audiobook = dialog.querySelector<HTMLElement>("[data-inspect-audio]");
  const cover = dialog.querySelector<HTMLImageElement>("[data-inspect-cover]");
  const rotation = dialog.querySelector<HTMLElement>("[data-inspect-rotation]");
  const note = dialog.querySelector<HTMLElement>("[data-inspect-details]");
  cover?.addEventListener(
    "error",
    () => {
      const fallback = selected?.book.cover.candidates[0]?.src;
      if (fallback && cover.getAttribute("src") !== fallback) cover.src = fallback;
    },
    { signal },
  );
  const cards: BookCard[] = [];
  const bookById = new Map(payload.atlas.map((book) => [book.id, book]));
  const textById = new Map(payload.books.map((book) => [book.id, book.text]));
  const detailsById = new Map(payload.books.map((book) => [book.id, book.details]));
  for (const card of root.querySelectorAll<HTMLElement>("[data-book-card]")) {
    const book = bookById.get(card.dataset.bookId ?? "");
    const button = card.querySelector<HTMLButtonElement>("[data-book-open]");
    if (book && button)
      cards.push({
        card,
        button,
        book,
        text: textById.get(book.id) ?? "",
        details: detailsById.get(book.id),
      });
  }
  let visible = cards;
  let renderer: AtlasRenderer | null = null;
  let rendererRequested = false;
  let loading: Promise<void> | null = null;
  let generation = 0;
  let selected: BookCard | null = null;
  let closing = false;
  let crumple: ReturnType<typeof crumpleNote> | null = null;
  let searchFrame = 0;
  let disposed = false;
  let failed = false;
  let pointer: { x: number; y: number; camera: AtlasCamera; id: number; moved: boolean } | null =
    null;
  let suppressClick = false;
  let restoringFocus = false;
  let hovered: BookCard | null = null;
  let dismissedTooltip: BookCard | null = null;
  let rotatePointer: { x: number; y: number; id: number } | null = null;
  let camera: AtlasCamera = { zoom: 1, x: 0, y: 0 };
  let cameraFrame = 0;
  let layout = atlasTableLayout(payload.atlas);
  let view = atlasFittedView(layout, stage.clientWidth, Math.max(1, stage.clientHeight), camera);
  const desktop = matchMedia("(min-width: 761px)");
  const forcedColors = matchMedia("(forced-colors: active)");
  let wasDesktop = desktop.matches;
  let searchKey: string | null = null;
  let arranged = false;
  let arrangementFrame = 0;
  let arrangementTarget: AtlasView | null = null;
  let resumeArrangement = false;
  let gridAnimations: Animation[] = [];

  function paintPositions() {
    if (!desktop.matches) {
      track?.style.removeProperty("--atlas-unit");
      return;
    }
    track?.style.setProperty("--atlas-unit", `${view.unit}px`);
    const projection = Math.sin(ATLAS.pitch);
    for (const [index, entry] of visible.entries()) {
      const position = view.layout.positions[index];
      if (!position) continue;
      const x = position.x * view.unit;
      const y = (ATLAS.insetY + position.z * projection) * view.unit;
      entry.card.style.setProperty(
        "--book-x",
        String((x - ATLAS_PADDING) / Math.max(1, view.width - ATLAS_PADDING * 2)),
      );
      entry.card.style.setProperty(
        "--book-y",
        String((y - ATLAS_PADDING) / Math.max(1, view.height - ATLAS_PADDING * 2)),
      );
      entry.card.style.setProperty("--book-footprint-width", String(position.width));
      entry.card.style.setProperty("--book-footprint-height", String(position.length * projection));
      // Undo the baked cover's table rotation in the same oblique projection as the live model.
      const angle =
        entry.book.profile.rotation - (position.rotation ?? entry.book.profile.rotation);
      const scale = position.scale ?? 1;
      const cosine = Math.cos(angle) * scale;
      const sine = Math.sin(angle) * scale;
      entry.card.style.setProperty(
        "--book-preview-transform",
        `matrix(${cosine},${sine * projection},${-sine / projection},${cosine},0,0)`,
      );
    }
  }
  function stopArrangement(finish = true) {
    cancelAnimationFrame(arrangementFrame);
    arrangementFrame = 0;
    delete elements.atlas.dataset.atlasArranging;
    if (finish && arrangementTarget) {
      view = arrangementTarget;
      camera = view.camera;
      paintPositions();
      paintCamera();
    }
    arrangementTarget = null;
    for (const animation of gridAnimations) animation.cancel();
    gridAnimations = [];
  }
  function animateArrangement(before: AtlasView, books: AtlasBook[]) {
    if (!desktop.matches || !motion() || !active() || !visible.length) return;
    const target = view;
    const tween = atlasTransition(
      before,
      books,
      target,
      visible.map((entry) => entry.book),
    );
    arrangementTarget = target;
    elements.atlas.dataset.atlasArranging = "true";
    const start = performance.now();
    const frame = (time: number) => {
      const progress = Math.min(1, (time - start) / 480);
      view = tween(progress);
      camera = view.camera;
      paintPositions();
      paintCamera();
      if (progress < 1) arrangementFrame = requestAnimationFrame(frame);
      else {
        arrangementFrame = 0;
        arrangementTarget = null;
        delete elements.atlas.dataset.atlasArranging;
        const focused = visible.find((entry) => entry.button === document.activeElement);
        if (focused) showTooltip(focused);
      }
    };
    frame(start);
  }

  function paintCamera() {
    cameraFrame = 0;
    view = { ...view, camera };
    track?.style.setProperty("--atlas-zoom", String(camera.zoom));
    track?.style.setProperty("--atlas-pan-x", `${camera.x}px`);
    track?.style.setProperty("--atlas-pan-y", `${camera.y}px`);
    elements.atlas.dataset.atlasZoom = camera.zoom.toFixed(4);
    elements.atlas.dataset.atlasPanX = camera.x.toFixed(2);
    elements.atlas.dataset.atlasPanY = camera.y.toFixed(2);
    renderer?.setView(view);
  }
  function engageAtlas() {
    // Keep the printed frame unchanged while an intended interaction prepares 3D.
    // Reveal live materials for navigation and pickup, never for a passing hover.
    elements.atlas.dataset.atlasEngaged = "true";
    requestRenderer();
  }
  function setCamera(next: AtlasCamera, immediate = false) {
    camera = atlasClampCamera(next, view.width, view.height);
    if (immediate) {
      cancelAnimationFrame(cameraFrame);
      paintCamera();
    } else if (!cameraFrame) cameraFrame = requestAnimationFrame(paintCamera);
  }
  function zoomAt(zoom: number, x = view.width / 2, y = view.height / 2) {
    hideTooltip();
    stopArrangement();
    setCamera(atlasZoomAt(camera, zoom, x, y, view.width, view.height));
  }
  function resetCamera() {
    hideTooltip();
    stopArrangement();
    setCamera({ zoom: 1, x: 0, y: 0 }, true);
  }
  function applyLayout() {
    stopArrangement(false);
    const before = view;
    for (const declaration of atlasTableStyle(layout).split(";")) {
      const [name, value] = declaration.split(":");
      if (name && value) track?.style.setProperty(name, value);
    }
    for (const [index, entry] of visible.entries()) {
      for (const declaration of atlasBookStyle(layout, index).split(";")) {
        const [name, value] = declaration.split(":");
        if (name && value) entry.card.style.setProperty(name, value);
      }
    }
    if (desktop.matches) {
      const bounds = elements.stage.getBoundingClientRect();
      view = atlasFittedView(layout, bounds.width, bounds.height, camera);
      if (before.width > 0 && before.height > 0)
        camera = atlasClampCamera(
          {
            ...camera,
            x: (camera.x * view.width) / before.width,
            y: (camera.y * view.height) / before.height,
          },
          view.width,
          view.height,
        );
      paintPositions();
      paintCamera();
    } else paintPositions();
    elements.atlas.dataset.atlasMode = desktop.matches ? "table" : "grid";
    elements.scroll.setAttribute(
      "aria-label",
      desktop.matches ? "Bookshelf, scroll to zoom and drag to move" : "Bookshelf",
    );
  }
  function hideTooltip() {
    for (const animation of tooltipAnimations) animation.cancel();
    tooltipAnimations = [];
    hovered?.card.removeAttribute("data-hovered");
    hovered?.button.removeAttribute("aria-describedby");
    hovered = null;
    if (tooltip) tooltip.hidden = true;
    tooltipArrow?.setAttribute("hidden", "");
  }
  function positionTooltip(entry: BookCard) {
    if (!tooltip || tooltip.hidden) return;
    const bounds = entry.button.getBoundingClientRect();
    const table = elements.stage.getBoundingClientRect();
    const placed = placeBookTooltip(
      { x: bounds.x - table.x, y: bounds.y - table.y, width: bounds.width, height: bounds.height },
      { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
      table,
    );
    tooltip.style.left = `${placed.x}px`;
    tooltip.style.top = `${placed.y}px`;
    tooltip.dataset.placement = placed.side;
    tooltipArrow?.setAttribute("viewBox", `0 0 ${table.width} ${table.height}`);
    tooltipArrow?.querySelector("[data-tooltip-arrow-line]")?.setAttribute("d", placed.line);
    tooltipArrow?.querySelector("[data-tooltip-arrow-head]")?.setAttribute("d", placed.head);
    const gradient = tooltipArrow?.querySelector("linearGradient");
    gradient?.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient?.setAttribute("x1", String(placed.tip.x));
    gradient?.setAttribute("y1", String(placed.tip.y));
    gradient?.setAttribute("x2", String(placed.x + tooltip.offsetWidth / 2));
    gradient?.setAttribute("y2", String(placed.y + tooltip.offsetHeight / 2));
  }
  function showTooltip(entry: BookCard) {
    if (
      !desktop.matches ||
      selected ||
      pointer ||
      restoringFocus ||
      arrangementTarget ||
      entry === dismissedTooltip
    )
      return;
    const changed = hovered !== entry;
    if (changed) hideTooltip();
    hovered = entry;
    entry.card.dataset.hovered = "true";
    if (!tooltip) return;
    const fields = [
      "[data-tooltip-title]",
      "[data-tooltip-author]",
      "[data-tooltip-date]",
      "[data-tooltip-pages]",
    ];
    const values = [
      entry.book.title,
      entry.book.author,
      entry.details?.firstPublished,
      entry.details?.pages ? `${entry.details.pages} pages` : undefined,
    ];
    for (const [index, selector] of fields.entries()) {
      const element = tooltip.querySelector(selector);
      if (element instanceof HTMLElement) {
        element.textContent = values[index] ?? "";
        element.hidden = !values[index];
      }
    }
    entry.button.setAttribute("aria-describedby", tooltip.id);
    tooltip.hidden = false;
    positionTooltip(entry);
    tooltipArrow?.removeAttribute("hidden");
    if (changed && motion() && tooltipArrow) {
      const line = tooltipArrow.querySelector("[data-tooltip-arrow-line]");
      const head = tooltipArrow.querySelector("[data-tooltip-arrow-head]");
      if (line && head)
        tooltipAnimations = [
          line.animate(
            [
              { strokeDasharray: "1", strokeDashoffset: 1 },
              { strokeDasharray: "1", strokeDashoffset: 0 },
            ],
            { duration: 220, easing: "ease-out" },
          ),
          head.animate([{ opacity: 0 }, { opacity: 0.85 }], {
            delay: 120,
            duration: 100,
            fill: "backwards",
          }),
        ];
    }
  }
  function currentRoom() {
    return root.closest<HTMLElement>("[data-about-rooms]");
  }
  function active() {
    const room = currentRoom();
    return (
      !disposed &&
      !document.hidden &&
      root.isConnected &&
      room?.dataset.room === "bookshelf" &&
      !room.dataset.scrub
    );
  }
  function keepVisible(entry: BookCard) {
    if (!desktop.matches) {
      entry.button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      return;
    }
    const bounds = entry.button.getBoundingClientRect();
    const table = elements.stage.getBoundingClientRect();
    let x = camera.x;
    let y = camera.y;
    if (bounds.left < table.left + 8 || bounds.right > table.right - 8)
      x += table.x + table.width / 2 - bounds.x - bounds.width / 2;
    if (bounds.top < table.top + 8 || bounds.bottom > table.bottom - 8)
      y += table.y + table.height / 2 - bounds.y - bounds.height / 2;
    if (x !== camera.x || y !== camera.y) setCamera({ ...camera, x, y }, true);
  }
  function stopRenderer() {
    generation++;
    renderer?.dispose();
    renderer = null;
    delete elements.atlas.dataset.atlasReady;
    delete elements.dialog.dataset.inspectorReady;
  }
  function rendererFailed() {
    failed = true;
    stopRenderer();
    elements.atlas.dataset.atlasUnavailable = "true";
    reportWebGLFailure();
  }
  function requestRenderer() {
    if (!active()) return;
    rendererRequested = true;
    void ensureRenderer();
  }
  function requestRendererFromPointerMove() {
    if (!active()) return;
    requestRenderer();
    elements.stage.removeEventListener("pointermove", requestRendererFromPointerMove);
  }
  async function ensureRenderer() {
    if (
      renderer ||
      loading ||
      failed ||
      !active() ||
      (!rendererRequested && !selected) ||
      (!desktop.matches && !selected) ||
      !motion() ||
      forcedColors.matches
    )
      return;
    const request = ++generation;
    loading = (async () => {
      try {
        const { AtlasRenderer: Renderer } = await import("./atlas-renderer");
        if (request !== generation || !active() || (!desktop.matches && !selected) || !motion())
          return;
        renderer = new Renderer(
          elements,
          visible.map((entry) => entry.book),
          desktop.matches
            ? view
            : atlasFittedView(layout, innerWidth, innerHeight, { zoom: 1, x: 0, y: 0 }),
          !desktop.matches || readEnhancementTier() === "light",
          rendererFailed,
          !desktop.matches,
        );
        paintCategory();
        if (selected && elements.dialog.open)
          await renderer.inspect(selected.book.id, selected.button.getBoundingClientRect());
      } catch (error) {
        console.warn("The book atlas will use its printed view.", error);
        rendererFailed();
      } finally {
        loading = null;
        if (request !== generation && active() && motion() && !failed) void ensureRenderer();
      }
    })();
    await loading;
  }
  function openBook(entry: BookCard) {
    if (selected || closing) return;
    cancelAnimationFrame(cameraFrame);
    paintCamera();
    engageAtlas();
    resumeArrangement = arrangementTarget !== null;
    stopArrangement(false);
    hideTooltip();
    selected = entry;
    paintBookDetails(elements.dialog);
    void loadBookDetails().then((records) => {
      if (selected !== entry || closing || disposed) return undefined;
      paintBookDetails(
        elements.dialog,
        records.find(
          (record) => record.title === entry.book.title && record.author === entry.book.author,
        ),
      );
      renderer?.refreshInspection();
      return undefined;
    });
    delete elements.dialog.dataset.closing;
    const origin = entry.button.getBoundingClientRect();
    if (title) title.textContent = entry.book.title;
    if (author) author.textContent = entry.book.author;
    if (cover) {
      cover.src = entry.book.cover.src;
      cover.alt = entry.book.title;
    }
    if (audiobook) audiobook.hidden = !entry.book.formats.includes("Audiobook");
    elements.dialog.showModal();
    elements.dialog.scrollTop = 0;
    entry.card.dataset.picked = "true";
    if (renderer) void renderer.inspect(entry.book.id, origin).catch(rendererFailed);
    else void ensureRenderer();
  }
  async function closeBook(animate = true) {
    if (!selected || (closing && animate)) return;
    closing = true;
    rotatePointer = null;
    crumple?.cancel();
    const effect = animate && motion() && note ? crumpleNote(note) : null;
    crumple = effect;
    elements.dialog.dataset.closing = "true";
    const entry = selected;
    await Promise.all([renderer?.closeInspection(animate && motion()), effect?.finished]);
    effect?.cancel();
    if (crumple === effect) crumple = null;
    if (selected !== entry) return;
    elements.dialog.close();
    if (!desktop.matches) stopRenderer();
    delete entry.card.dataset.picked;
    selected = null;
    closing = false;
    if (active()) {
      restoringFocus = true;
      entry.button.focus({ preventScroll: true });
      keepVisible(entry);
      restoringFocus = false;
    }
    if (resumeArrangement) {
      resumeArrangement = false;
      const before = view;
      applyLayout();
      animateArrangement(
        before,
        visible.map((card) => card.book),
      );
    }
    scheduleSearch();
  }
  function applySearch() {
    cancelAnimationFrame(searchFrame);
    searchFrame = 0;
    if (selected || pointer || disposed) return;
    const query = normalizeNeedle(search?.value ?? "");
    const nextArranged = !!query || document.activeElement === search;
    const nextKey = `${nextArranged}:${query}`;
    if (searchKey === nextKey) return;
    const initialized = searchKey !== null;
    if (initialized) engageAtlas();
    searchKey = nextKey;
    arranged = nextArranged;
    const before = { ...view, camera };
    const beforeBooks = visible.map((entry) => entry.book);
    const gridOrigins =
      !desktop.matches && motion()
        ? new Map(visible.map((entry) => [entry.book.id, entry.card.getBoundingClientRect()]))
        : null;
    stopArrangement(false);
    cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    const indexes = findBookshelfMatchIndexes(
      cards.map((entry) => entry.text),
      query,
    );
    const matches = new Set(indexes);
    visible = indexes.flatMap((index) => cards[index] ?? []);
    for (const [index, entry] of cards.entries()) entry.card.hidden = !matches.has(index);
    // DOM order, keyboard navigation and rendering all use the matcher's relevance order.
    const ordered = [...visible, ...cards.filter((entry) => entry.card.hidden)];
    if (ordered.some((entry, index) => track?.children[index] !== entry.card))
      track?.append(...ordered.map((entry) => entry.card));
    const books = visible.map((entry) => entry.book);
    hideTooltip();
    layout = arranged ? atlasSearchLayout(books) : atlasTableLayout(books);
    elements.atlas.dataset.atlasArrangement = arranged ? "rows" : "scattered";
    camera = { zoom: 1, x: 0, y: 0 };
    if (empty) empty.hidden = visible.length !== 0;
    root.dataset.empty = String(visible.length === 0);
    renderer?.setBooks(books);
    paintCategory();
    applyLayout();
    if (initialized) animateArrangement(before, beforeBooks);
    if (gridOrigins && initialized && active()) {
      const destinations = visible.map((entry) => entry.card.getBoundingClientRect());
      gridAnimations = visible.map((entry, index) => {
        const origin = gridOrigins.get(entry.book.id);
        const destination = destinations[index];
        const x = origin && destination ? origin.x - destination.x : 0;
        const y = origin && destination ? origin.y - destination.y : 0;
        return entry.card.animate(
          [
            { transform: `translate(${x}px, ${y}px)`, opacity: origin ? 1 : 0 },
            { transform: "translate(0, 0)", opacity: 1 },
          ],
          { duration: 320, easing: "ease-out" },
        );
      });
    }
  }
  function scheduleSearch() {
    if (!searchFrame) searchFrame = requestAnimationFrame(applySearch);
  }

  function paintCategory() {
    const selectedCategory = category;
    const matches = selectedCategory
      ? new Set(
          cards
            .filter((entry) => entry.details?.categories?.includes(selectedCategory))
            .map((entry) => entry.book.id),
        )
      : null;
    for (const entry of cards)
      entry.card.toggleAttribute("data-category-muted", !!matches && !matches.has(entry.book.id));
    renderer?.setCategoryMatches(matches);
    if (categoryClear) {
      categoryClear.hidden = !category;
      categoryClear.setAttribute("aria-label", `Clear ${category ?? "category"} filter`);
    }
    if (categoryLabel) categoryLabel.textContent = category ?? "";
    if (category) elements.atlas.dataset.atlasCategory = category;
    else delete elements.atlas.dataset.atlasCategory;
    if (result) {
      const count = visible.filter((entry) => !matches || matches.has(entry.book.id)).length;
      result.textContent = `${formatBookshelfResultsCount(count, cards.length, !!category || !!search?.value)}${category ? ` in ${category}` : ""}`;
    }
  }

  categoryClear?.addEventListener(
    "click",
    () => {
      category = null;
      paintCategory();
      search?.focus({ preventScroll: true });
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-book-category]")
          : null;
      if (!button?.dataset.bookCategory || closing) return;
      const label = button.dataset.bookCategory;
      void closeBook().then(() => {
        if (!active()) return undefined;
        category = label;
        paintCategory();
        categoryClear?.focus({ preventScroll: true });
        return undefined;
      });
    },
    { signal },
  );

  search?.addEventListener("input", scheduleSearch, { signal });
  search?.addEventListener("search", scheduleSearch, { signal });
  search?.addEventListener("focus", requestRenderer, { signal });
  search?.addEventListener("focus", scheduleSearch, { signal });
  search?.addEventListener("blur", scheduleSearch, { signal });
  stage.addEventListener("pointerenter", requestRenderer, { signal });
  stage.addEventListener("pointermove", requestRendererFromPointerMove, { signal });
  stage.addEventListener("focusin", requestRenderer, { signal });
  root.querySelector("[data-empty-reset]")?.addEventListener(
    "click",
    () => {
      if (search) {
        search.value = "";
        search.focus();
        applySearch();
      }
    },
    { signal },
  );
  scroll.addEventListener(
    "wheel",
    (event) => {
      if (!desktop.matches || selected || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      engageAtlas();
      hideTooltip();
      const multiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? view.height : 1;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        stopArrangement();
        setCamera({
          ...camera,
          x: camera.x - (event.deltaX || event.deltaY) * multiplier,
          y: camera.y - (event.shiftKey ? 0 : event.deltaY * multiplier),
        });
      } else {
        const bounds = elements.stage.getBoundingClientRect();
        zoomAt(
          camera.zoom * Math.exp(-event.deltaY * multiplier * 0.002),
          event.clientX - bounds.left,
          event.clientY - bounds.top,
        );
      }
    },
    { passive: false, signal },
  );
  scroll.addEventListener(
    "pointerdown",
    (event) => {
      if (!desktop.matches || selected || event.button !== 0) return;
      engageAtlas();
      suppressClick = false;
      pointer = {
        x: event.clientX,
        y: event.clientY,
        camera: { ...camera },
        id: event.pointerId,
        moved: false,
      };
    },
    { signal },
  );
  scroll.addEventListener(
    "pointermove",
    (event) => {
      if (desktop.matches && !selected && event.pointerType !== "touch") {
        if (!pointer && event.target instanceof Element) {
          const button = event.target.closest("[data-book-open]");
          const entry = visible.find((candidate) => candidate.button === button);
          if (entry && entry !== hovered) showTooltip(entry);
        }
      }
      if (!pointer || pointer.id !== event.pointerId) return;
      const x = event.clientX - pointer.x;
      const y = event.clientY - pointer.y;
      if (!pointer.moved && Math.hypot(x, y) <= 6) return;
      if (!pointer.moved) stopArrangement();
      pointer.moved = true;
      suppressClick = true;
      elements.scroll.setPointerCapture(event.pointerId);
      elements.scroll.dataset.dragging = "true";
      hideTooltip();
      setCamera({ ...pointer.camera, x: pointer.camera.x + x, y: pointer.camera.y + y });
    },
    { signal },
  );
  const endDrag = () => {
    pointer = null;
    delete elements.scroll.dataset.dragging;
    scheduleSearch();
  };
  window.addEventListener("pointerup", endDrag, { signal });
  scroll.addEventListener(
    "pointercancel",
    () => {
      endDrag();
      suppressClick = false;
    },
    { signal },
  );
  scroll.addEventListener("lostpointercapture", endDrag, { signal });
  scroll.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  for (const entry of cards) {
    entry.button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        openBook(entry);
      },
      { signal },
    );
    entry.button.addEventListener(
      "pointerleave",
      () => {
        if (dismissedTooltip === entry) dismissedTooltip = null;
        if (hovered === entry) hideTooltip();
      },
      { signal },
    );
    entry.button.addEventListener(
      "focus",
      () => {
        if (restoringFocus) return;
        keepVisible(entry);
        showTooltip(entry);
      },
      { signal },
    );
    entry.button.addEventListener(
      "blur",
      () => {
        if (dismissedTooltip === entry) dismissedTooltip = null;
        if (hovered === entry) hideTooltip();
      },
      { signal },
    );
  }
  scroll.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (desktop.matches && ["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        engageAtlas();
        if (event.key === "0") resetCamera();
        else zoomAt(camera.zoom * (event.key === "-" ? 1 / 1.4 : 1.4));
        return;
      }
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
      if (!keys.includes(event.key) || selected) return;
      event.preventDefault();
      const current = visible.findIndex((entry) => entry.button === document.activeElement);
      const columns = desktop.matches
        ? arranged
          ? layout.positions.filter((position) => position.z === layout.positions[0]?.z).length
          : 1
        : track
          ? getComputedStyle(track).gridTemplateColumns.split(" ").length
          : 1;
      const step =
        event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowRight"
            ? 1
            : event.key === "ArrowUp"
              ? -columns
              : columns;
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? visible.length - 1
            : Math.max(0, Math.min(visible.length - 1, current < 0 ? 0 : current + step));
      visible[index]?.button.focus({ preventScroll: true });
    },
    { signal },
  );
  dialog.addEventListener("scroll", () => renderer?.refreshInspection(), { passive: true, signal });
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      void closeBook();
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target === elements.dialog) void closeBook();
    },
    { signal },
  );
  dialog.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        !event.target.closest("[data-inspect-rotation]")
      )
        return;
      event.target
        .closest<HTMLElement>("[data-inspect-rotation]")
        ?.setPointerCapture(event.pointerId);
      rotatePointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    { signal },
  );
  dialog.addEventListener(
    "pointermove",
    (event) => {
      if (!rotatePointer || rotatePointer.id !== event.pointerId) return;
      renderer?.rotate(
        (event.clientX - rotatePointer.x) * 0.006,
        (event.clientY - rotatePointer.y) * 0.004,
      );
      rotatePointer.x = event.clientX;
      rotatePointer.y = event.clientY;
    },
    { signal },
  );
  dialog.addEventListener(
    "pointerup",
    () => {
      rotatePointer = null;
    },
    { signal },
  );
  dialog.addEventListener(
    "pointercancel",
    () => {
      rotatePointer = null;
    },
    { signal },
  );
  rotation?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Home") {
        event.preventDefault();
        renderer?.resetRotation();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      renderer?.rotate(
        event.key === "ArrowLeft" ? -0.1 : event.key === "ArrowRight" ? 0.1 : 0,
        event.key === "ArrowUp" ? -0.07 : event.key === "ArrowDown" ? 0.07 : 0,
      );
    },
    { signal },
  );
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      rendererFailed();
    },
    { signal },
  );
  function activity() {
    if (!active()) {
      stopArrangement();
      crumple?.cancel();
    }
    renderer?.suspend(!active());
    if (active()) void ensureRenderer();
  }
  document.addEventListener("visibilitychange", activity, { signal });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && hovered && !dialog.open) {
        dismissedTooltip = hovered;
        hideTooltip();
      }
    },
    { signal },
  );
  document.addEventListener(
    "site:room-change",
    (event) => {
      // SAFETY: about-rooms owns this named event and always emits this detail.
      const change = event as CustomEvent<{ room: string; phase: string }>;
      if (change.detail.phase === "start") {
        renderer?.suspend(true);
        if (selected) void closeBook(false);
        hideTooltip();
        resetCamera();
      } else activity();
    },
    { signal },
  );
  const enhancementChanged = () => {
    crumple?.cancel();
    stopArrangement();
    stopRenderer();
    resetCamera();
    if (active()) void ensureRenderer();
  };
  watchEnhancementPolicy(enhancementChanged, signal);
  forcedColors.addEventListener("change", enhancementChanged, { signal });
  const resize = new ResizeObserver(() => {
    if (closing) crumple?.cancel();
    if (desktop.matches !== wasDesktop) {
      hideTooltip();
      camera = { zoom: 1, x: 0, y: 0 };
      stopRenderer();
      wasDesktop = desktop.matches;
    }
    applyLayout();
    if (selected) renderer?.resize(selected.button.getBoundingClientRect());
    if (active()) void ensureRenderer();
  });
  resize.observe(stage);
  // The live book follows the CSS composition when fonts or late details resize the note.
  const inspectionLayout = new ResizeObserver(() => renderer?.refreshInspection());
  inspectionLayout.observe(elements.anchor);
  if (note) inspectionLayout.observe(note);
  const tooltipResize = new ResizeObserver(() => {
    if (hovered) positionTooltip(hovered);
  });
  if (tooltip) tooltipResize.observe(tooltip);
  window.addEventListener(
    "pagehide",
    (event) => {
      crumple?.cancel();
      if (event.persisted) {
        renderer?.suspend(true);
        return;
      }
      disposed = true;
      stopArrangement(false);
      stopRenderer();
      abort.abort();
      resize.disconnect();
      inspectionLayout.disconnect();
      tooltipResize.disconnect();
      cancelAnimationFrame(searchFrame);
      cancelAnimationFrame(cameraFrame);
    },
    { signal },
  );
  window.addEventListener("pageshow", activity, { signal });
  root.dataset.bookshelfInitialized = "true";
  applySearch();
  requestAnimationFrame(() => {
    void ensureRenderer();
  });
}
