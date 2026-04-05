const PANEL_SELECTOR = "[data-panel]";
const HEIGHT_ANIMATION_DURATION = 420;
const HEIGHT_ANIMATION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

let previousPanelHeight = 0;
let activePanel: HTMLElement | null = null;
let pendingMeasureFrame = 0;
let activeTransitionFrame = 0;
let activeTimeout = 0;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function getPanel() {
  return document.querySelector<HTMLElement>(PANEL_SELECTOR);
}

function measureAutoPanelHeight(panel: HTMLElement) {
  const previousHeight = panel.style.height;
  const previousTransition = panel.style.transition;

  panel.style.transition = "none";
  panel.style.height = "";

  const nextHeight = panel.getBoundingClientRect().height;

  panel.style.height = previousHeight;
  panel.getBoundingClientRect();
  panel.style.transition = previousTransition;

  return nextHeight;
}

function releasePanelHeight(panel: HTMLElement) {
  panel.style.height = "";
}

function cancelPendingPanelFrames() {
  if (pendingMeasureFrame) {
    cancelAnimationFrame(pendingMeasureFrame);
    pendingMeasureFrame = 0;
  }

  if (activeTransitionFrame) {
    cancelAnimationFrame(activeTransitionFrame);
    activeTransitionFrame = 0;
  }
}

function handlePanelTransitionEnd(event: TransitionEvent) {
  if (event.target !== activePanel || event.propertyName !== "height") {
    return;
  }

  finishCurrentTransition();
}

function finishCurrentTransition() {
  cancelPendingPanelFrames();

  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = 0;
  }

  if (!activePanel) {
    return;
  }

  activePanel.removeEventListener("transitionend", handlePanelTransitionEnd);
  activePanel.style.transition = "";
  releasePanelHeight(activePanel);
  activePanel.removeAttribute("data-panel-animating");
  activePanel = null;
}

function startPanelHeightTransition(panel: HTMLElement) {
  if (!panel.isConnected || getPanel() !== panel) {
    return;
  }

  if (reducedMotionQuery.matches) {
    const nextHeight = measureAutoPanelHeight(panel);
    previousPanelHeight = nextHeight;
    releasePanelHeight(panel);
    finishCurrentTransition();
    return;
  }

  const nextPanelHeight = measureAutoPanelHeight(panel);
  const startHeight = previousPanelHeight || nextPanelHeight;

  previousPanelHeight = nextPanelHeight;

  if (!startHeight || Math.abs(nextPanelHeight - startHeight) < 1) {
    releasePanelHeight(panel);
    finishCurrentTransition();
    return;
  }

  activePanel = panel;
  panel.setAttribute("data-panel-animating", "true");
  panel.style.transition = "none";
  panel.style.height = `${startHeight}px`;
  panel.getBoundingClientRect();

  activeTransitionFrame = requestAnimationFrame(() => {
    if (activePanel !== panel) {
      return;
    }

    activeTransitionFrame = 0;
    panel.addEventListener("transitionend", handlePanelTransitionEnd);
    panel.style.transition = `height ${HEIGHT_ANIMATION_DURATION}ms ${HEIGHT_ANIMATION_EASING}`;
    panel.style.height = `${nextPanelHeight}px`;

    activeTimeout = window.setTimeout(() => {
      if (activePanel === panel) {
        finishCurrentTransition();
      }
    }, HEIGHT_ANIMATION_DURATION + 80);
  });
}

document.addEventListener("astro:before-swap", () => {
  const panel = getPanel();

  if (!panel) {
    return;
  }

  previousPanelHeight = panel.getBoundingClientRect().height;
  finishCurrentTransition();
});

document.addEventListener("astro:after-swap", () => {
  document.documentElement.dataset.clientPageSwap = "true";

  const panel = getPanel();

  if (!panel) {
    return;
  }

  finishCurrentTransition();

  pendingMeasureFrame = requestAnimationFrame(() => {
    pendingMeasureFrame = 0;
    startPanelHeightTransition(panel);
  });
});
