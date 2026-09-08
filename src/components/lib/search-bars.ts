import { registerShortcut } from "../../scripts/hotkeys";

const controllers = new Map<HTMLElement, AbortController>();

export function initializeSearchBars() {
  for (const root of document.querySelectorAll<HTMLElement>("[data-overlay-search]")) {
    if (controllers.has(root)) continue;

    const input = root.querySelector<HTMLInputElement>("[data-search-input]");
    const focus = root.querySelector<HTMLButtonElement>("[data-focus-search]");
    const clear = root.querySelector<HTMLButtonElement>("[data-clear-search]");
    if (!input || !focus || !clear) continue;

    const controller = new AbortController();
    const { signal } = controller;
    controllers.set(root, controller);

    const syncClearLabel = () => {
      clear.setAttribute("aria-label", input.value ? "Clear search" : "Leave search");
    };

    const focusSearch = () => {
      input.focus();
      input.select();
      syncClearLabel();
    };

    const clearOrLeave = () => {
      if (input.value) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      } else {
        input.blur();
        clear.blur();
      }
    };

    // Keep a pointer press from swapping the focused hint before its click.
    for (const button of [focus, clear]) {
      button.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button === 0) event.preventDefault();
        },
        { signal },
      );
    }

    focus.addEventListener("click", focusSearch, { signal });
    clear.addEventListener("click", clearOrLeave, { signal });
    input.addEventListener("input", syncClearLabel, { signal });
    input.addEventListener("focus", syncClearLabel, { signal });
    syncClearLabel();

    registerShortcut("Escape", clearOrLeave, { signal, target: root, ignoreInputs: false });
    for (const hotkey of ["/", { key: "/", shift: true }, "Mod+K"] as const) {
      registerShortcut(
        hotkey,
        (event) => {
          if (hotkey !== "Mod+K" && event.key !== "/") return;
          // The control can share a document with another, hidden room.
          if (!root.checkVisibility({ visibilityProperty: true })) return;
          event.preventDefault();
          focusSearch();
        },
        { signal, ignoreInputs: true, preventDefault: false, stopPropagation: false },
      );
    }
  }
}
