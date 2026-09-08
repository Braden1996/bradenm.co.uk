// A hover disclosure: something that opens beside an inline trigger when the
// pointer or keyboard focus rests on it, stays while the pointer crosses to it,
// moves to the next trigger of its kind without closing, and dismisses on
// Escape, outside click, scroll or resize. Non-modal by design, with focus free
// to move between the trigger and surface. This supports WCAG 1.4.13 (hover
// grace periods, Escape dismissal, content usable under the pointer). What is
// shown, and where, is the caller's: this module only owns timing and events.

export type HoverDisclosure = {
  /** The trigger it is currently open for, if any. */
  openTrigger(): HTMLElement | undefined;
  /** Close it now, cancelling any pending open. */
  close(): void;
  destroy(): void;
};

export type HoverDisclosureOptions = {
  /**
   * Whether a click on a trigger toggles the disclosure (default). When false
   * a click only closes it and is otherwise left alone — for triggers whose
   * click already opens something fuller.
   */
  clickToggles?: boolean;
  /** Milliseconds the pointer may spend off trigger and surface before it closes. */
  closeGrace?: number;
  /** In-flow disclosures can stay open while the reader scrolls through them. */
  closeOnScroll?(): boolean;
  /** Modal surfaces stay open when the pointer or focus leaves their content. */
  closeOnLeave?(): boolean;
  /** Milliseconds a trigger must be rested on before it opens. */
  openDelay?: number;
  /**
   * Whether RESTING on a trigger — the pointer hovering it, focus landing on
   * it — opens the disclosure; a press always does. Asked at event time, so it
   * can follow the layout (a stacked page may want presses only). Default:
   * always.
   */
  opensOnRest?(trigger: HTMLElement): boolean;
  /** Milliseconds before the open disclosure moves to another trigger. */
  retargetDelay?: number;
  /** Selects the inline triggers. */
  triggerSelector: string;
  /** Selects the disclosure's own surface, which the pointer may rest on. */
  surfaceSelector: string;
  open(trigger: HTMLElement): void;
  /** The disclosure is up for `previous`; move it to `trigger`. */
  retarget(trigger: HTMLElement, previous: HTMLElement): void;
  close(): void;
  /**
   * A key pressed while the open trigger is focused. Return true to claim it
   * (the default action is then prevented) — e.g. arrows scrolling the surface.
   */
  keydown?(event: KeyboardEvent, trigger: HTMLElement): boolean;
  /** Something inside the surface scrolled. */
  scrolled?(target: EventTarget | null): void;
};

// Every disclosure on the page; opening one closes the others so two never
// stand at once when the pointer crosses from one kind of trigger to another.
const disclosures = new Set<HoverDisclosure>();

function isMouseLike(event: PointerEvent) {
  return event.pointerType === "mouse" || event.pointerType === "pen";
}

export function bindHoverDisclosure(options: HoverDisclosureOptions): HoverDisclosure {
  const openDelay = options.openDelay ?? 150;
  const retargetDelay = options.retargetDelay ?? 60;
  const closeGrace = options.closeGrace ?? 250;
  const opensOnRest = (trigger: HTMLElement) => options.opensOnRest?.(trigger) ?? true;
  const controller = new AbortController();
  const { signal } = controller;

  let openTrigger: HTMLElement | undefined;
  let openTimer = 0;
  let closeTimer = 0;
  // After Escape, hover must not instantly reopen until the pointer/focus
  // leaves the trigger once.
  let suppressedTrigger: HTMLElement | undefined;

  const findTrigger = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(options.triggerSelector) : null;
  const withinSurface = (target: EventTarget | null) =>
    Boolean(openTrigger && target instanceof Element && target.closest(options.surfaceSelector));
  const withinSurfaceOrTrigger = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest(`${options.surfaceSelector}, ${options.triggerSelector}`));

  const clearTimers = () => {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    openTimer = 0;
    closeTimer = 0;
  };

  const close = () => {
    clearTimers();
    if (!openTrigger) {
      return;
    }
    openTrigger = undefined;
    options.close();
  };

  const openFor = (trigger: HTMLElement) => {
    if (trigger === openTrigger) {
      return;
    }
    for (const other of disclosures) {
      if (other !== disclosure) {
        other.close();
      }
    }
    const previous = openTrigger;

    openTrigger = trigger;
    if (previous) {
      options.retarget(trigger, previous);
    } else {
      options.open(trigger);
    }
  };

  const scheduleOpen = (trigger: HTMLElement) => {
    if (trigger === suppressedTrigger) {
      return;
    }
    clearTimers();
    openTimer = window.setTimeout(() => openFor(trigger), openTrigger ? retargetDelay : openDelay);
  };

  const scheduleClose = () => {
    clearTimers();
    if (options.closeOnLeave?.() === false) {
      return;
    }
    closeTimer = window.setTimeout(close, closeGrace);
  };

  const toggle = (trigger: HTMLElement) => {
    clearTimers();
    suppressedTrigger = undefined;
    if (trigger === openTrigger) {
      close();
    } else {
      openFor(trigger);
    }
  };

  document.addEventListener(
    "pointerover",
    (event) => {
      if (!isMouseLike(event)) {
        return;
      }
      const trigger = findTrigger(event.target);

      if (trigger) {
        if (opensOnRest(trigger) && !withinSurface(document.activeElement)) {
          scheduleOpen(trigger);
        }
      } else if (withinSurface(event.target)) {
        // Pointer access: travelling onto the surface cancels the grace-period close.
        window.clearTimeout(closeTimer);
      }
    },
    { signal },
  );

  document.addEventListener(
    "pointerout",
    (event) => {
      if (!isMouseLike(event)) {
        return;
      }
      const leavingTrigger = findTrigger(event.target);

      if (leavingTrigger === suppressedTrigger && !withinSurfaceOrTrigger(event.relatedTarget)) {
        suppressedTrigger = undefined;
      }
      if (!withinSurfaceOrTrigger(event.relatedTarget)) {
        if (
          (leavingTrigger || withinSurface(event.target)) &&
          !withinSurface(document.activeElement)
        ) {
          scheduleClose();
        }
      }
    },
    { signal },
  );

  document.addEventListener(
    "click",
    (event) => {
      const trigger = findTrigger(event.target);

      if (!trigger) {
        if (openTrigger && !withinSurface(event.target)) {
          close();
        }
        return;
      }
      if (options.clickToggles === false) {
        close();
        return;
      }
      // Run before Astro's router sees the link. The fragment is only the
      // no-JS path; opening a disclosure must not navigate or scroll the page.
      event.preventDefault();
      toggle(trigger);
    },
    { capture: true, signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && openTrigger) {
        // Return focus only when dismissal would hide the focused control.
        const trigger = openTrigger;
        const restoreFocus = withinSurface(document.activeElement);

        suppressedTrigger = openTrigger;
        close();
        if (restoreFocus) {
          trigger.focus({ preventScroll: true });
        }
        return;
      }
      const trigger = findTrigger(event.target);

      if (!trigger) {
        return;
      }
      if (trigger === openTrigger && options.keydown?.(event, trigger)) {
        event.preventDefault();
        return;
      }
      if (event.key === " " && options.clickToggles !== false) {
        // Anchors do not activate on Space; restore the expected toggle.
        event.preventDefault();
        toggle(trigger);
      }
    },
    { signal },
  );

  document.addEventListener(
    "focusin",
    (event) => {
      if (withinSurface(event.target)) {
        clearTimers();
        return;
      }
      const trigger = findTrigger(event.target);

      if (trigger && trigger.matches(":focus-visible") && opensOnRest(trigger)) {
        scheduleOpen(trigger);
      }
    },
    { signal },
  );

  document.addEventListener(
    "focusout",
    (event) => {
      const trigger = findTrigger(event.target);

      if (trigger === suppressedTrigger) {
        suppressedTrigger = undefined;
      }
      if (!trigger && !withinSurface(event.target)) {
        return;
      }
      if (
        withinSurface(event.relatedTarget) ||
        (openTrigger &&
          event.relatedTarget instanceof Node &&
          openTrigger.contains(event.relatedTarget))
      ) {
        window.clearTimeout(closeTimer);
        return;
      }
      scheduleClose();
    },
    { signal },
  );

  const dismissOnScroll = (event: Event) => {
    if (!openTrigger) {
      return;
    }
    if (withinSurface(event.target)) {
      options.scrolled?.(event.target);
      return;
    }
    if (options.closeOnScroll?.() === false) {
      return;
    }
    close();
  };

  window.addEventListener("scroll", dismissOnScroll, { capture: true, passive: true, signal });
  window.addEventListener("resize", close, { signal });
  document.addEventListener(
    "site:room-change",
    () => {
      close();
      suppressedTrigger = undefined;
    },
    { signal },
  );

  const disclosure: HoverDisclosure = {
    close,
    destroy() {
      close();
      controller.abort();
      disclosures.delete(disclosure);
    },
    openTrigger: () => openTrigger,
  };

  disclosures.add(disclosure);

  return disclosure;
}
