import { observeScrollContent } from "./scroll-content";

/*
 * Overlay scrollbars: a thumb drawn ON the page rather than a gutter cut out
 * beside it.
 *
 * A classic, always-visible scrollbar — what macOS shows when a mouse is
 * plugged in — is a strip of chrome the page has to make room for and then
 * decorate. This site's answer used to be to paint the paper on the scroll
 * container's own box so the sheet ran under the track and the bar floated on
 * it. That works only as long as the thing under the track is flat: over the
 * shelf planks, the foot wash or a cover photograph the track reads as a seam,
 * and the reserved gutter still pushes the content in by a rail's width the
 * sheet never asked for.
 *
 * So the native bar is hidden (scrollbar-width: none) and this draws the one
 * mark that was ever wanted: a soft ink thumb lying on top of the content,
 * fading in while the reader is scrolling or has the pointer near the rail and
 * fading out again when they stop. Nothing is reserved, nothing is painted
 * under, and every scroller on the site wears the same mark.
 *
 * Mechanics. The rail is a sibling element sized to the scroller's own box —
 * never a child, because every scroller here is masked (the shelf fades, the
 * card body's last-line dissolve) and a child would be faded out at exactly
 * the edges the thumb has to reach. Wheel and touch never touch this: the
 * element still scrolls natively and this only reads scrollTop. Dress lives in
 * src/styles/overlay-scrollbar.css.
 */

export type OverlayScrollbarController = {
  destroy(): void;
  /** Re-measure now — after the scroller has been moved, resized or refilled. */
  refresh(): void;
};

export type OverlayScrollbarOptions = {
  /**
   * Where the rail is inserted. Defaults to the scroller's parent. It must be
   * an element the rail can be positioned against — see `viewport` for the
   * page scrollers, whose box is the viewport itself.
   */
  mount?: HTMLElement;
  /**
   * Position the rail against the VIEWPORT (fixed) instead of against the
   * mount's box. For the page scrollers, whose box is the viewport and whose
   * mount is the body.
   */
  viewport?: boolean;
};

/** How long the thumb stays up after the last scroll. */
const IDLE_MS = 900;
/** How near the scroller's right edge the pointer wakes the thumb. */
const RAIL_ZONE = 28;
/** The thumb never gets shorter than this, however long the content is. */
const MIN_THUMB = 28;
/** Below this there is nothing to scroll and no mark to make. */
const OVERFLOW_EPSILON = 2;

const RAIL = "data-overlay-scrollbar";
const THUMB = "data-overlay-scrollbar-thumb";
const boundScrollbars = new WeakMap<HTMLElement, OverlayScrollbarController>();

type Axis = {
  /** Length of the thumb along the axis, and its offset from the rail's start. */
  size: number;
  start: number;
  /** Whether this axis has anything to scroll at all. */
  active: boolean;
};

function scrolls(overflow: string) {
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function setStyle(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function setData(element: HTMLElement, key: string, value: string) {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
}

function axisFor(
  scrollSize: number,
  clientSize: number,
  scrollStart: number,
  overflowStyle: string,
): Axis {
  const overflow = scrollSize - clientSize;

  if (!scrolls(overflowStyle) || overflow <= OVERFLOW_EPSILON || clientSize <= 0) {
    return { active: false, size: 0, start: 0 };
  }

  const size = Math.max(MIN_THUMB, Math.round((clientSize * clientSize) / scrollSize));
  const travel = clientSize - size;

  return {
    active: true,
    size,
    start: Math.round(travel * Math.min(1, Math.max(0, scrollStart / overflow))),
  };
}

export function bindOverlayScrollbar(
  scroller: HTMLElement,
  options: OverlayScrollbarOptions = {},
): OverlayScrollbarController {
  const mount = options.mount ?? scroller.parentElement;

  // Room activation may revisit the same scroller; retain its original rail.
  const existing = boundScrollbars.get(scroller);
  if (existing) return existing;
  if (!mount) {
    return { destroy() {}, refresh() {} };
  }
  scroller.dataset.overlayScrolled = "true";
  const isDocumentScroller = scroller === document.scrollingElement;

  const abort = new AbortController();
  const { signal } = abort;

  const rail = document.createElement("div");

  rail.setAttribute(RAIL, "");
  rail.setAttribute("aria-hidden", "true");
  if (options.viewport) {
    rail.dataset.overlayScrollbarViewport = "true";
  }

  const vertical = document.createElement("div");

  vertical.setAttribute(THUMB, "vertical");
  rail.append(vertical);

  const horizontal = document.createElement("div");

  horizontal.setAttribute(THUMB, "horizontal");
  rail.append(horizontal);

  mount.append(rail);

  let idleTimer = 0;
  let near = false;
  let dragging = false;
  let frame = 0;
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let needsMeasurement = true;
  let metrics = {
    clientHeight: 0,
    clientWidth: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    overflowY: "visible",
    overflowX: "visible",
  };

  const show = (sticky: boolean) => {
    setData(rail, "visible", "true");
    window.clearTimeout(idleTimer);
    if (!sticky) {
      idleTimer = window.setTimeout(() => {
        if (!dragging && !near) {
          delete rail.dataset.visible;
        }
      }, IDLE_MS);
    }
  };

  const bounds = () =>
    isDocumentScroller
      ? new DOMRect(
          0,
          0,
          document.documentElement.clientWidth,
          document.documentElement.clientHeight,
        )
      : scroller.getBoundingClientRect();

  const readPosition = () => ({
    y: axisFor(metrics.scrollHeight, metrics.clientHeight, scroller.scrollTop, metrics.overflowY),
    x: axisFor(metrics.scrollWidth, metrics.clientWidth, scroller.scrollLeft, metrics.overflowX),
  });

  const paintPosition = ({ y, x }: ReturnType<typeof readPosition>) => {
    setStyle(vertical, "height", `${y.size}px`);
    setStyle(vertical, "transform", `translateY(${y.start}px)`);
    setData(vertical, "active", String(y.active));
    setStyle(horizontal, "width", `${x.size}px`);
    setStyle(horizontal, "transform", `translateX(${x.start}px)`);
    setData(horizontal, "active", String(x.active));
    setData(rail, "idle", String(!y.active && !x.active));
  };

  /*
   * The rail traces the scroller's own border box. Against the viewport it is
   * the scroller's rect, except that the document uses the viewport itself:
   * its root element's rect is the entire page and moves as it scrolls.
   * Otherwise it is that rect expressed in the
   * rail's containing block, which is the padding box of its offset parent —
   * hence the clientLeft/clientTop, which are that parent's border widths.
   */
  const measure = () => {
    const box = bounds();
    let top = box.top;
    let left = box.left;

    if (!options.viewport) {
      /* Absolute coordinates are read against the offset parent's PADDING box,
         so its own borders come off the rect. */
      const parent = rail.offsetParent;
      const base = parent instanceof HTMLElement ? parent : undefined;
      const origin = base?.getBoundingClientRect();

      top -= (origin?.top ?? 0) + (base?.clientTop ?? 0);
      left -= (origin?.left ?? 0) + (base?.clientLeft ?? 0);
    }

    /*
     * An element that is not the scroll owner still reports a scrollHeight
     * taller than its client box — `overflow: visible` simply spills. Only the
     * owner gets a mark, which is what lets the page shell and the document
     * both be bound while the breakpoint decides between them.
     */
    const style = getComputedStyle(scroller);
    metrics = {
      clientHeight: scroller.clientHeight,
      clientWidth: scroller.clientWidth,
      scrollHeight: scroller.scrollHeight,
      scrollWidth: scroller.scrollWidth,
      overflowY: style.overflowY,
      overflowX: style.overflowX,
    };
    const position = readPosition();

    // Finish every geometry read before changing the rail. Writing its box
    // before reading overflow styles used to force another layout each frame.
    setStyle(rail, "top", `${top}px`);
    setStyle(rail, "left", `${left}px`);
    setStyle(rail, "width", `${box.width}px`);
    setStyle(rail, "height", `${box.height}px`);

    paintPosition(position);
    needsMeasurement = false;
  };

  /* Coalesced: a scroll, a resize and a mutation in one frame measure once. */
  const schedulePosition = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (needsMeasurement) measure();
      else paintPosition(readPosition());
    });
  };

  const schedule = () => {
    needsMeasurement = true;
    schedulePosition();
  };

  // A document scroll is dispatched on Document, not its scrolling element.
  const scrollTarget = isDocumentScroller ? document : scroller;
  scrollTarget.addEventListener(
    "scroll",
    () => {
      show(dragging);
      schedulePosition();
    },
    { passive: true, signal },
  );

  /*
   * The thumb wakes when the pointer comes near the rail, the way an overlay
   * bar does — but only near it: a thumb that lights up whenever the pointer
   * crosses the sheet would be a second cursor.
   */
  scroller.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") {
        return;
      }

      pointerX = event.clientX;
      pointerY = event.clientY;

      if (pointerFrame) {
        return;
      }

      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        const box = bounds();
        const wasNear = near;

        near = box.right - pointerX <= RAIL_ZONE || box.bottom - pointerY <= RAIL_ZONE;
        if (near !== wasNear) {
          show(near);
        }
      });
    },
    { passive: true, signal },
  );

  scroller.addEventListener(
    "pointerleave",
    () => {
      cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      near = false;
      show(false);
    },
    { signal },
  );

  // ------------------------------------------------------------------ drag

  const drag = (thumb: HTMLElement, axis: "x" | "y") => {
    let pointer: number | undefined;
    let from = 0;
    let startScroll = 0;

    thumb.addEventListener(
      "pointerenter",
      (event) => {
        if (event.pointerType !== "touch") {
          near = true;
          show(true);
        }
      },
      { signal },
    );
    thumb.addEventListener(
      "pointerleave",
      () => {
        near = false;
        show(dragging);
      },
      { signal },
    );

    thumb.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) {
          return;
        }
        pointer = event.pointerId;
        from = axis === "y" ? event.clientY : event.clientX;
        startScroll = axis === "y" ? scroller.scrollTop : scroller.scrollLeft;
        dragging = true;
        rail.dataset.dragging = "true";
        show(true);
        try {
          thumb.setPointerCapture(event.pointerId);
        } catch {
          /* The move/up handlers match on pointerId regardless. */
        }
        event.preventDefault();
        event.stopPropagation();
        if (axis === "y") {
          scroller.dispatchEvent(new CustomEvent("overlay-scrollbar-drag-start"));
        }
      },
      { signal },
    );

    thumb.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId !== pointer) {
          return;
        }

        /* The thumb travels the track; the content travels the overflow. */
        const clientSize = axis === "y" ? scroller.clientHeight : scroller.clientWidth;
        const scrollSize = axis === "y" ? scroller.scrollHeight : scroller.scrollWidth;
        const thumbSize = axis === "y" ? thumb.offsetHeight : thumb.offsetWidth;
        const travel = clientSize - thumbSize;
        const moved = (axis === "y" ? event.clientY : event.clientX) - from;
        const next = travel > 0 ? startScroll + (moved * (scrollSize - clientSize)) / travel : 0;

        if (axis === "y") {
          scroller.scrollTop = next;
        } else {
          scroller.scrollLeft = next;
        }
      },
      { signal },
    );

    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer) {
        return;
      }
      pointer = undefined;
      dragging = false;
      delete rail.dataset.dragging;
      show(false);
      if (axis === "y") {
        scroller.dispatchEvent(new CustomEvent("overlay-scrollbar-drag-end"));
      }
    };

    thumb.addEventListener("pointerup", end, { signal });
    thumb.addEventListener("pointercancel", end, { signal });
    thumb.addEventListener("lostpointercapture", end, { signal });

    /*
     * The thumb is not a descendant of the scroller (a masked child would be
     * faded out at the edges), so a wheel over it would otherwise land on
     * whatever is behind. Hand it back to the scroller it belongs to.
     */
    thumb.addEventListener(
      "wheel",
      (event) => {
        scroller.scrollBy({ behavior: "instant", left: event.deltaX, top: event.deltaY });
        event.preventDefault();
      },
      { signal },
    );
  };

  drag(vertical, "y");
  drag(horizontal, "x");

  const observer = new ResizeObserver(schedule);

  observer.observe(scroller);

  /* Filtering can change only a child's height while this viewport stays fixed. */
  const contentObserver = observeScrollContent(scroller, observer, schedule);

  window.addEventListener("resize", schedule, { passive: true, signal });

  measure();

  const result: OverlayScrollbarController = {
    destroy() {
      abort.abort();
      observer.disconnect();
      contentObserver.disconnect();
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pointerFrame);
      rail.remove();
      delete scroller.dataset.overlayScrolled;
      boundScrollbars.delete(scroller);
    },
    refresh: measure,
  };
  boundScrollbars.set(scroller, result);
  return result;
}

/*
 * Whether the site draws its own scrollbars here. The native bars are hidden
 * from CSS under the same query, so an engine too old for it keeps both the
 * system bar and the gutter rather than ending up with neither or with two.
 */
function overlayScrollbarsEnabled() {
  return window.matchMedia("(scripting: enabled)").matches;
}

const controllers = new Map<HTMLElement, OverlayScrollbarController>();
let lifecycleBound = false;

function activeScroller(element: HTMLElement) {
  if (element !== document.scrollingElement && element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return scrolls(style.overflowY) || scrolls(style.overflowX);
}

/**
 * Give every marked scroller its thumb, plus the document — which is the page
 * scroller below the shell's mobile breakpoint, where `.page-wrap` hands
 * scrolling back to it. A scroller with nothing to scroll simply shows no
 * mark, so binding both costs nothing.
 */
export function initOverlayScrollbars() {
  if (!overlayScrollbarsEnabled()) {
    return;
  }

  if (!lifecycleBound) {
    lifecycleBound = true;
    document.addEventListener("site:room-change", (event) => {
      if (event.detail.phase === "start") destroyOverlayScrollbars();
      else initOverlayScrollbars();
    });
    window.addEventListener("resize", initOverlayScrollbars, { passive: true });
    window.matchMedia("(forced-colors: active)").addEventListener("change", initOverlayScrollbars);
  }

  const candidates = new Set(document.querySelectorAll<HTMLElement>("[data-overlay-scroll]"));
  if (document.scrollingElement instanceof HTMLElement) candidates.add(document.scrollingElement);
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;
  for (const element of candidates) {
    if (forcedColors || !activeScroller(element)) candidates.delete(element);
  }
  for (const [element, controller] of controllers) {
    if (!candidates.has(element)) {
      controller.destroy();
      controllers.delete(element);
    }
  }
  for (const element of candidates) {
    const current = controllers.get(element);
    if (current) {
      current.refresh();
      continue;
    }
    const viewport =
      element === document.scrollingElement || element.dataset.overlayScroll === "viewport";
    controllers.set(
      element,
      bindOverlayScrollbar(element, viewport ? { mount: document.body, viewport: true } : {}),
    );
  }
}

function destroyOverlayScrollbars() {
  for (const controller of controllers.values()) {
    controller.destroy();
  }
  controllers.clear();
}
