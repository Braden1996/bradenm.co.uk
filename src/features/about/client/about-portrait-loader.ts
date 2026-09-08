import {
  readEnhancementTier,
  watchEnhancementPolicy,
} from "../../../components/lib/enhancement-policy";

let bound = false;
let pending: Promise<void> | undefined;
let initializePortrait: (() => void) | undefined;
let requestedTouch: HTMLElement | undefined;
let touch: { root: HTMLElement; x: number; y: number } | undefined;

function portraitFor(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(".about-portrait") : null;
}

function syncAccessibility() {
  for (const root of document.querySelectorAll<HTMLElement>(".about-portrait")) {
    const interactive =
      readEnhancementTier() !== "static" && !root.hasAttribute("data-enhancement-unavailable");
    root.setAttribute("role", interactive ? "button" : "img");
    root.setAttribute(
      "aria-label",
      interactive
        ? "Interactive portrait of Braden. Click or press Enter to reset."
        : "Braden smiling while eating gelato, rendered as a typographic portrait.",
    );
    if (interactive) root.tabIndex = 0;
    else root.removeAttribute("tabindex");
  }
}

function requestPortrait(root: HTMLElement) {
  if (
    document.hidden ||
    root.closest("[inert]") ||
    root.hasAttribute("data-enhancement-unavailable") ||
    readEnhancementTier() === "static"
  )
    return;
  root.dataset.enhancementRequested = "";
  if (initializePortrait) {
    initializePortrait();
    root.dispatchEvent(new Event("site:portrait-intent"));
    return;
  }
  pending ??= import("./about-portrait")
    .then(({ bindAboutPortraitLifecycle }) => {
      initializePortrait = bindAboutPortraitLifecycle;
      if (root.isConnected && readEnhancementTier() !== "static") {
        initializePortrait();
        root.dispatchEvent(new Event("site:portrait-intent"));
      }
      return undefined;
    })
    .catch((error) => {
      console.warn("about-portrait: keeping the static portrait", error);
    })
    .finally(() => {
      pending = undefined;
    });
}

/** The complete SSR print needs no import, network request, or GPU until intent. */
export function bindVisiblePortraitLifecycle() {
  syncAccessibility();
  if (bound) return;
  bound = true;
  watchEnhancementPolicy(syncAccessibility, new AbortController().signal);
  document.addEventListener("pointerover", (event) => {
    const root = portraitFor(event.target);
    if (root && event.pointerType !== "touch") requestPortrait(root);
  });
  document.addEventListener("pointerdown", (event) => {
    const root = portraitFor(event.target);
    if (root && event.isPrimary && event.pointerType === "touch") {
      touch = { root, x: event.clientX, y: event.clientY };
    }
  });
  document.addEventListener("pointermove", (event) => {
    if (!touch || !event.isPrimary || event.pointerType !== "touch") return;
    const dx = Math.abs(event.clientX - touch.x);
    const dy = Math.abs(event.clientY - touch.y);
    if (Math.max(dx, dy) < 8) return;
    if (dx > dy) {
      requestedTouch = touch.root;
      requestedTouch.dataset.enhancementTouchX = String(touch.x);
      requestedTouch.dataset.enhancementTouchY = String(touch.y);
      requestPortrait(touch.root);
    }
    touch = undefined;
  });
  const clearTouch = () => {
    if (requestedTouch) {
      delete requestedTouch.dataset.enhancementTouchX;
      delete requestedTouch.dataset.enhancementTouchY;
      requestedTouch = undefined;
    }
    touch = undefined;
  };
  document.addEventListener("pointerup", clearTouch);
  document.addEventListener("pointercancel", clearTouch);
  document.addEventListener("keydown", (event) => {
    const root = portraitFor(event.target);
    if (
      root &&
      root.getAttribute("role") === "button" &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      requestPortrait(root);
    }
  });
}
