type ScrollFadeController = {
  destroy: () => void;
  scheduleUpdate: () => void;
};

const controllers = new WeakMap<HTMLElement, ScrollFadeController>();

function updateScrollFade(root: HTMLElement, viewport: HTMLElement) {
  const edgeFadeDistance =
    Number.parseFloat(getComputedStyle(root).getPropertyValue("--scroll-edge-height")) || 20;
  const maxScrollTop = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
  const hasOverflow = maxScrollTop > 1;
  const topStrength = hasOverflow
    ? Math.min(Math.max(viewport.scrollTop / edgeFadeDistance, 0), 1)
    : 0;
  const bottomStrength = hasOverflow
    ? Math.min(Math.max((maxScrollTop - viewport.scrollTop) / edgeFadeDistance, 0), 1)
    : 0;
  const topFadeSize = hasOverflow ? edgeFadeDistance * topStrength : 0;
  const bottomFadeSize = hasOverflow ? edgeFadeDistance * bottomStrength : 0;

  root.dataset.scrollTop = String(topStrength > 0.01);
  root.dataset.scrollBottom = String(bottomStrength > 0.01);
  root.style.setProperty("--scroll-edge-top-strength", topStrength.toFixed(3));
  root.style.setProperty("--scroll-edge-bottom-strength", bottomStrength.toFixed(3));
  root.style.setProperty("--scroll-edge-top-fade-size", `${topFadeSize.toFixed(2)}px`);
  root.style.setProperty("--scroll-edge-bottom-fade-size", `${bottomFadeSize.toFixed(2)}px`);
  root.dataset.scrollFadeReady = "true";
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
  let frame = 0;
  let observer: ResizeObserver | undefined;

  function scheduleUpdate() {
    if (frame) {
      cancelAnimationFrame(frame);
    }

    frame = requestAnimationFrame(() => {
      frame = 0;
      updateScrollFade(root, viewport);
    });
  }

  const controller: ScrollFadeController = {
    destroy() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }

      viewport.removeEventListener("scroll", scheduleUpdate);
      observer?.disconnect();
      controllers.delete(root);
    },
    scheduleUpdate,
  };

  viewport.addEventListener("scroll", scheduleUpdate, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(scheduleUpdate);
    observer.observe(root);
    observer.observe(viewport);
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
  for (const root of getScrollFadeRoots(scope)) {
    initScrollFadeRoot(root);
  }
}

export function destroyScrollFades(scope: ParentNode = document) {
  for (const root of getScrollFadeRoots(scope)) {
    controllers.get(root)?.destroy();
  }
}
