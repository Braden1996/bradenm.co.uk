import { observeScrollContent } from "../components/lib/scroll-content";

type ScrollFadeController = {
  destroy: () => void;
  scheduleUpdate: () => void;
};

const controllers = new WeakMap<HTMLElement, ScrollFadeController>();
let lifecycleBound = false;

function updateScrollFade(
  root: HTMLElement,
  viewport: HTMLElement,
  edgeFadeDistance: number,
  previousState: string,
) {
  const maxScrollTop = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
  const hasOverflow = maxScrollTop > 1;
  // Scroll dimensions round to whole pixels while scrollTop can be fractional.
  // Treat the final pixel as the edge so reaching it clears the fade completely.
  const topDistance = viewport.scrollTop > 1 ? viewport.scrollTop : 0;
  const remainingDistance = maxScrollTop - viewport.scrollTop;
  const bottomDistance = remainingDistance > 1 ? remainingDistance : 0;
  const topStrength = hasOverflow ? Math.min(topDistance / edgeFadeDistance, 1) : 0;
  const bottomStrength = hasOverflow ? Math.min(bottomDistance / edgeFadeDistance, 1) : 0;
  const topFadeSize = hasOverflow ? edgeFadeDistance * topStrength : 0;
  const bottomFadeSize = hasOverflow ? edgeFadeDistance * bottomStrength : 0;
  const top = topStrength.toFixed(3);
  const bottom = bottomStrength.toFixed(3);
  const topSize = `${topFadeSize.toFixed(2)}px`;
  const bottomSize = `${bottomFadeSize.toFixed(2)}px`;
  const nextState = `${top}|${bottom}|${topSize}|${bottomSize}`;

  // Most scrolling happens between the two edges, where both fades are
  // already full. Leave their inherited properties and masks untouched there.
  if (nextState === previousState) {
    return previousState;
  }

  root.dataset.scrollTop = String(topStrength > 0.01);
  root.dataset.scrollBottom = String(bottomStrength > 0.01);
  root.style.setProperty("--scroll-edge-top-strength", top);
  root.style.setProperty("--scroll-edge-bottom-strength", bottom);
  root.style.setProperty("--scroll-edge-top-fade-size", topSize);
  root.style.setProperty("--scroll-edge-bottom-fade-size", bottomSize);
  root.dataset.scrollFadeReady = "true";

  return nextState;
}

function initScrollFadeRoot(root: HTMLElement) {
  const existing = controllers.get(root);

  if (existing) {
    existing.scheduleUpdate();
    return;
  }

  const rawViewport = root.querySelector<HTMLElement>("[data-scroll-fade-viewport]");

  if (!rawViewport) {
    return;
  }

  const viewport = rawViewport;
  const mobile = window.matchMedia("(max-width: 760px)");
  const enabledOnMobile = root.hasAttribute("data-scroll-fade-mobile");
  let frame = 0;
  let needsMeasurement = true;
  let edgeFadeDistance = 20;
  let previousState = "";
  let observer: ResizeObserver | undefined;
  let contentObserver: MutationObserver | undefined;

  function scheduleFrame() {
    // Most frames remove their mask and haze on mobile. An explicitly enabled
    // frame, such as a modal, keeps tracking its own scroll viewport there.
    if (frame || (mobile.matches && !enabledOnMobile) || document.hidden) {
      return;
    }

    frame = requestAnimationFrame(() => {
      frame = 0;
      if ((mobile.matches && !enabledOnMobile) || document.hidden) {
        return;
      }
      if (needsMeasurement) {
        edgeFadeDistance =
          Number.parseFloat(getComputedStyle(root).getPropertyValue("--scroll-edge-height")) || 20;
        needsMeasurement = false;
      }
      previousState = updateScrollFade(root, viewport, edgeFadeDistance, previousState);
    });
  }

  function scheduleUpdate() {
    needsMeasurement = true;
    scheduleFrame();
  }

  const controller: ScrollFadeController = {
    destroy() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }

      viewport.removeEventListener("scroll", scheduleFrame);
      mobile.removeEventListener("change", scheduleUpdate);
      document.removeEventListener("visibilitychange", scheduleUpdate);
      observer?.disconnect();
      contentObserver?.disconnect();
      controllers.delete(root);
    },
    scheduleUpdate,
  };

  viewport.addEventListener("scroll", scheduleFrame, { passive: true });
  mobile.addEventListener("change", scheduleUpdate);
  document.addEventListener("visibilitychange", scheduleUpdate);

  if ("ResizeObserver" in globalThis) {
    observer = new ResizeObserver(scheduleUpdate);
    observer.observe(root);
    observer.observe(viewport);
    contentObserver = observeScrollContent(viewport, observer, scheduleUpdate);
  }

  controllers.set(root, controller);
  scheduleUpdate();
}

function getScrollFadeRoots(scope: ParentNode) {
  const roots =
    scope instanceof HTMLElement && scope.matches("[data-scroll-fade-root]") ? [scope] : [];

  if ("querySelectorAll" in scope) {
    roots.push(...scope.querySelectorAll<HTMLElement>("[data-scroll-fade-root]"));
  }

  return roots;
}

export function initScrollFades(scope: ParentNode = document) {
  if (!lifecycleBound) {
    lifecycleBound = true;
    document.addEventListener("site:room-change", (event) => {
      if (event.detail.phase === "start") destroyScrollFades();
      else initScrollFades();
    });
  }
  for (const root of getScrollFadeRoots(scope)) {
    if (root.getClientRects().length > 0) initScrollFadeRoot(root);
    else controllers.get(root)?.destroy();
  }
}

function destroyScrollFades(scope: ParentNode = document) {
  for (const root of getScrollFadeRoots(scope)) {
    controllers.get(root)?.destroy();
  }
}
