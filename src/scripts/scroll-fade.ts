const controllers = new WeakMap<HTMLElement, { scheduleUpdate: () => void }>();

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

  function scheduleUpdate() {
    if (frame) {
      cancelAnimationFrame(frame);
    }

    frame = requestAnimationFrame(() => {
      frame = 0;
      updateScrollFade(root, viewport);
    });
  }

  viewport.addEventListener("scroll", scheduleUpdate, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(root);
    observer.observe(viewport);
  }

  controllers.set(root, { scheduleUpdate });
  scheduleUpdate();
}

export function initScrollFades(scope: ParentNode = document) {
  const roots =
    scope instanceof HTMLElement && scope.matches("[data-scroll-fade-root]") ? [scope] : [];

  if ("querySelectorAll" in scope) {
    roots.push(...scope.querySelectorAll<HTMLElement>("[data-scroll-fade-root]"));
  }

  for (const root of roots) {
    initScrollFadeRoot(root);
  }
}
