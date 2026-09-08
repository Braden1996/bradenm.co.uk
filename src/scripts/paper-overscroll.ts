import { advancePaperPull, paperPullForDistance } from "../components/lib/paper-overscroll-motion";
import { createPaperOverscrollRenderer } from "../components/lib/paper-overscroll-renderer";

let destroyCurrent: (() => void) | undefined;
let lifecycleBound = false;

function noteIsOpen() {
  return document.querySelector(
    '[data-career-popover]:is([data-state="open"], [data-state="measuring"])',
  );
}

/** Stretch the foot of the sheet inside a real, spring-returning scroll area. */
export function initPaperOverscroll() {
  if (!lifecycleBound) {
    lifecycleBound = true;
    document.addEventListener("site:room-change", (event) => {
      if (event.detail.phase === "start") destroyCurrent?.();
      else initPaperOverscroll();
    });
  }

  destroyCurrent?.();

  const rawDecoration = document.querySelector<HTMLCanvasElement>("[data-paper-overscroll]");
  const rawOcclusion = document.querySelector<HTMLCanvasElement>("[data-paper-occlusion]");
  const rawPage = document.querySelector<HTMLElement>(".page-wrap");
  const rawContent = rawPage?.querySelector<HTMLElement>(":scope > .panel-shell");
  const rawTail = rawPage?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
  const rawFoot = rawPage?.querySelector<HTMLElement>(":scope > [data-paper-foot-wash]");

  if (!rawDecoration || !rawOcclusion || !rawPage || !rawContent || !rawTail || !rawFoot) {
    return;
  }

  const decoration = rawDecoration;
  const occlusion = rawOcclusion;
  const page = rawPage;
  const content = rawContent;
  const tail = rawTail;
  const foot = rawFoot;
  let renderer: ReturnType<typeof createPaperOverscrollRenderer>;
  let preparingDecoration = false;
  let decorationReadyAt = Number.POSITIVE_INFINITY;
  const revealDuration = 80;

  function prepareDecoration() {
    if (preparingDecoration) return;
    const source = decoration.dataset.overscrollSrc;
    if (!source) return;
    preparingDecoration = true;
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    void image.decode().then(
      () => {
        if (signal.aborted) return;
        renderer = createPaperOverscrollRenderer(decoration, image, occlusion);
        if (!renderer) return;
        decorationReadyAt = performance.now();
        return schedule();
      },
      () => {
        // The anchored wash remains visible if the optional image cannot load.
      },
    );
  }
  const root = document.documentElement;
  const mobile = window.matchMedia("(max-width: 760px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = window.matchMedia("(forced-colors: active)");
  const controller = new AbortController();
  const { signal } = controller;
  let paintedDistance = 0;
  let paintedReveal = 0;
  let velocity = 0;
  let returnPosition = 0;
  let returning = false;
  let releaseRequested = false;
  let expectedScroll: number | undefined;
  let frame = 0;
  let previousFrame = 0;
  let lastInput = 0;
  let lastScroll = 0;
  let touchHeld = false;
  let thumbHeld = false;
  let keyHeld = false;
  let eligibleTargets = new WeakMap<Element, boolean>();

  function owner() {
    return mobile.matches ? document.scrollingElement : page;
  }

  function geometry() {
    const viewport = owner();
    const travel = tail.offsetHeight;
    const bottom = viewport
      ? Math.max(0, viewport.scrollHeight - viewport.clientHeight - travel)
      : 0;
    const distance = viewport ? Math.min(travel, Math.max(0, viewport.scrollTop - bottom)) : 0;

    return { viewport, travel, bottom, distance };
  }

  function disabled() {
    return reducedMotion.matches || forcedColors.matches || document.hidden;
  }

  function accepts(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return false;
    }

    // The page's thumb lives beside its scroller, so forwarded wheel input
    // arrives from the viewport rail. Nested shelves keep their own boundary.
    if (target.closest("[data-overlay-scrollbar-viewport]")) {
      return true;
    }

    const cached = eligibleTargets.get(target);
    if (cached !== undefined) {
      return cached;
    }

    const viewport = owner();
    let element: Element | null = target;

    while (element && element !== viewport) {
      if (/^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY)) {
        eligibleTargets.set(target, false);
        return false;
      }
      element = element.parentElement;
    }

    const accepted = element === viewport;
    eligibleTargets.set(target, accepted);
    return accepted;
  }

  function paint(distance: number, travel: number, force = false) {
    const reveal = Math.min(
      1,
      Math.max(0, (performance.now() - decorationReadyAt) / revealDuration),
    );
    if (!force && distance === paintedDistance && (distance === 0 || reveal === paintedReveal)) {
      return;
    }

    const wasResting = paintedDistance === 0;
    paintedDistance = distance;
    paintedReveal = reveal;
    const pull = travel > 0 ? paperPullForDistance(distance) / paperPullForDistance(travel) : 0;

    if (distance > 0) {
      prepareDecoration();
      const lift = pull * (mobile.matches ? 114 : 133);
      // The content and paper grain must receive the same refund of native
      // scroll movement; otherwise the texture slides underneath the sheet.
      page.style.setProperty("--paper-scroll-compensation", `${distance - lift}px`);
      if (wasResting) {
        content.style.willChange = "transform";
        content.style.transform = "translate3d(0, var(--paper-scroll-compensation), 0)";
      }
    } else {
      page.style.removeProperty("--paper-scroll-compensation");
      content.style.removeProperty("transform");
      content.style.removeProperty("will-change");
    }

    // The canvas begins with the same flat wash, then only stretches upward.
    // Swap the surfaces without a crossfade: blending two translucent washes
    // would briefly thin the colour even when they have the same palette.
    renderer?.paint(pull * reveal);
    const showingStretch = distance > 0 && renderer !== undefined;
    decoration.style.opacity = showingStretch ? "1" : "0";
    occlusion.style.opacity = showingStretch ? "1" : "0";
    foot.style.opacity = showingStretch ? "0" : "1";
  }

  function stopAnimation() {
    cancelAnimationFrame(frame);
    frame = 0;
    returning = false;
  }

  function reset() {
    stopAnimation();
    renderer?.resize();
    expectedScroll = undefined;
    const { viewport, bottom, distance, travel } = geometry();
    if (viewport && distance > 0) {
      viewport.scrollTo({ top: bottom, behavior: "instant" });
      expectedScroll = viewport.scrollTop;
    }
    paint(0, travel, true);
    velocity = 0;
    touchHeld = false;
    thumbHeld = false;
    keyHeld = false;
    releaseRequested = false;
    lastInput = 0;
    lastScroll = 0;
    eligibleTargets = new WeakMap();
  }

  function animate(now: number) {
    frame = 0;
    const { viewport, bottom, distance, travel } = geometry();

    if (!viewport || disabled() || travel === 0) {
      reset();
      return;
    }

    // Fixed notes need their original containing block and a stationary sheet.
    if (distance > 0 && noteIsOpen()) {
      reset();
      return;
    }

    paint(distance, travel);

    if (distance === 0) {
      returning = false;
      velocity = 0;
      return;
    }

    if (touchHeld || thumbHeld || keyHeld) {
      returning = false;
      if (Number.isFinite(decorationReadyAt) && paintedReveal < 1) schedule();
      return;
    }

    if (!returning) {
      if (!releaseRequested && now - Math.max(lastInput, lastScroll) < 80) {
        frame = requestAnimationFrame(animate);
        return;
      }
      returning = true;
      releaseRequested = false;
      returnPosition = distance;
      previousFrame = now;
      if (now - lastScroll > 40) {
        velocity = 0;
      }
    }

    const next = advancePaperPull(returnPosition, velocity, 0, (now - previousFrame) / 1000);
    previousFrame = now;
    velocity = next.velocity;
    returnPosition = next.position;
    const settled = next.position <= 0 || (next.position < 0.5 && Math.abs(velocity) < 10);
    viewport.scrollTo({ top: bottom + (settled ? 0 : next.position), behavior: "instant" });
    expectedScroll = viewport.scrollTop;
    paint(Math.max(0, expectedScroll - bottom), travel);

    if (settled) {
      returning = false;
      velocity = 0;
      return;
    }
    frame = requestAnimationFrame(animate);
  }

  function schedule() {
    if (!frame) {
      frame = requestAnimationFrame(animate);
    }
  }

  function onScroll(event: Event) {
    const viewport = owner();
    if (event.target !== (mobile.matches ? document : viewport)) {
      return;
    }

    const metrics = geometry();
    if (!disabled() && metrics.viewport && metrics.bottom - metrics.viewport.scrollTop < 240) {
      prepareDecoration();
    }
    if (metrics.distance > 0 && noteIsOpen()) {
      reset();
      return;
    }
    if (
      expectedScroll !== undefined &&
      viewport &&
      Math.abs(viewport.scrollTop - expectedScroll) < 1
    ) {
      expectedScroll = undefined;
      return;
    }

    expectedScroll = undefined;
    const now = performance.now();
    velocity = (metrics.distance - paintedDistance) / Math.max((now - lastScroll) / 1000, 1 / 120);
    lastScroll = now;
    returning = false;
    // Scroll events already run before paint. Updating here avoids another
    // frame of lag between the native thumb and the resistant sheet.
    paint(metrics.distance, metrics.travel);
    if (metrics.distance > 0) {
      schedule();
    }
  }

  function onWheel(event: WheelEvent) {
    if (
      disabled() ||
      event.ctrlKey ||
      event.shiftKey ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
      !accepts(event.target)
    ) {
      return;
    }
    lastInput = performance.now();
    returning = false;
    releaseRequested = false;
    if (paintedDistance > 0) {
      schedule();
    }
  }

  function onTouchStart(event: TouchEvent) {
    if (!disabled() && event.touches.length === 1 && accepts(event.target)) {
      touchHeld = true;
      returning = false;
      releaseRequested = false;
      velocity = 0;
    }
  }

  function onTouchEnd(event: TouchEvent) {
    if (!touchHeld || event.touches.length > 0) {
      return;
    }
    touchHeld = false;
    // Let native touch momentum finish before returning the scroll position.
    lastInput = performance.now();
    if (paintedDistance > 0) {
      schedule();
    }
  }

  function onThumbStart(event: Event) {
    if (event.currentTarget === owner()) {
      thumbHeld = true;
      returning = false;
      releaseRequested = false;
      velocity = 0;
    }
  }

  function onThumbEnd(event: Event) {
    if (event.currentTarget === owner()) {
      thumbHeld = false;
      releaseRequested = true;
      schedule();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      !event.defaultPrevented &&
      ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key) &&
      (event.target === document.body || event.target === root || accepts(event.target))
    ) {
      keyHeld = true;
      returning = false;
      releaseRequested = false;
    }
  }

  function onKeyUp() {
    if (keyHeld) {
      keyHeld = false;
      lastInput = performance.now();
      schedule();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true, capture: true, signal });
  window.addEventListener("wheel", onWheel, { passive: true, signal });
  window.addEventListener("touchstart", onTouchStart, { passive: true, signal });
  window.addEventListener("touchend", onTouchEnd, { passive: true, signal });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  window.addEventListener("keyup", onKeyUp, { signal });
  window.addEventListener("blur", reset, { signal });
  window.addEventListener("resize", reset, { passive: true, signal });
  document.addEventListener("visibilitychange", reset, { signal });
  reducedMotion.addEventListener("change", reset, { signal });
  forcedColors.addEventListener("change", reset, { signal });

  for (const viewport of [page, document.scrollingElement]) {
    viewport?.addEventListener("overlay-scrollbar-drag-start", onThumbStart, { signal });
    viewport?.addEventListener("overlay-scrollbar-drag-end", onThumbEnd, { signal });
  }

  const resizeObserver = new ResizeObserver(() => {
    eligibleTargets = new WeakMap();
    returning = false;
    schedule();
  });
  resizeObserver.observe(content);
  resizeObserver.observe(tail);

  root.dataset.paperOverscrollReady = "true";
  const initial = geometry();
  paint(initial.distance, initial.travel, true);
  schedule();

  destroyCurrent = () => {
    reset();
    controller.abort();
    resizeObserver.disconnect();
    delete root.dataset.paperOverscrollReady;
    destroyCurrent = undefined;
  };
}
