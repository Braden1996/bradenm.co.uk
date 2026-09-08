// One shared margin annotation, using the real server-rendered career entries.
import {
  bindHoverDisclosure,
  type HoverDisclosure,
} from "../../../components/lib/hover-disclosure";
import { prefersReducedMotion } from "../../../components/lib/motion";
import {
  bindOverlayScrollbar,
  type OverlayScrollbarController,
} from "../../../components/lib/overlay-scrollbar";
import { placeCareerPopover } from "../lib/career-popover-placement";
import { createCareerNoteConnector } from "../lib/career-note-connector";
import { initScrollFades } from "../../../scripts/scroll-fade";
import { enterPopover } from "../../../components/popover-kit/popover-motion";

const CARD = "[data-career-card]";
const TRIGGER = "[data-career-entity]";
const FRAME = "[data-career-popover]";
const OPEN_FRAME = `${FRAME}[data-state="open"]`;
const MODAL = "[data-career-modal]";
const PASSAGE = "[data-about-passage]";
const BODY = "[data-career-card-body]";
const SCROLL_STEP = 48;

let activeCard: HTMLElement | undefined;
let activeTrigger: HTMLElement | undefined;
let frameAnimation: Animation | undefined;
let connectorAnimations: Animation[] = [];
let frameEpoch = 0;
let disclosure: HoverDisclosure | undefined;
let modalTrigger: HTMLElement | undefined;
let restoringFocus = false;
const boundModals = new WeakSet<HTMLDialogElement>();
let scrollbar: OverlayScrollbarController = { destroy() {}, refresh() {} };

function frameElement() {
  return document.querySelector<HTMLElement>(FRAME) ?? undefined;
}

function cardFor(trigger: HTMLElement) {
  const href = trigger.getAttribute("href");
  const id = href?.startsWith("#") ? href.slice(1) : undefined;
  const card = id ? document.getElementById(id) : null;

  return card?.matches(CARD) ? card : undefined;
}

function bodyFor(card: ParentNode | undefined) {
  return card?.querySelector<HTMLElement>(BODY);
}

function triggerRect(trigger: HTMLElement) {
  const rect = Array.from(trigger.getClientRects())[0] ?? trigger.getBoundingClientRect();

  return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
}

function resetBody(body: HTMLElement | null | undefined) {
  if (!body) {
    return;
  }

  body.scrollTop = 0;
}

function bindBody(card: HTMLElement) {
  const body = bodyFor(card);

  scrollbar.destroy();
  scrollbar = { destroy() {}, refresh() {} };
  if (!body) {
    return;
  }

  body.scrollTop = 0;
  scrollbar = bindOverlayScrollbar(body, { mount: frameElement() ?? card });
  initScrollFades(card);
}

function clearFrameGeometry(frame: HTMLElement) {
  frame.style.removeProperty("height");
  frame.style.removeProperty("left");
  frame.style.removeProperty("top");
  frame.style.removeProperty("width");
  delete frame.dataset.placement;
}

function contentMotionEnabled() {
  return !prefersReducedMotion() && !window.matchMedia("(forced-colors: active)").matches;
}

function passageTextRects(column: HTMLElement, trigger: HTMLElement) {
  const rects: { left: number; top: number; width: number; height: number }[] = [];
  const range = document.createRange();
  // Ranges expose each rendered text line without inserting measurement spans.
  for (const paragraph of column.querySelectorAll("p")) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // The selected label and its attached punctuation are the destination.
      if (!node.textContent?.trim() || trigger.contains(node)) continue;
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
  }
  // Painted strokes extend below the text bounds and need their own clearance.
  for (const label of column.querySelectorAll(".inline-entity--stroked .inline-entity__label")) {
    if (trigger.contains(label)) continue;
    const rect = label.getBoundingClientRect();
    const height = Number.parseFloat(getComputedStyle(label).fontSize) * 0.34;
    rects.push({ left: rect.left, top: rect.bottom - height, width: rect.width, height });
  }
  return rects;
}

function positionConnector(trigger: HTMLElement, opening: boolean) {
  for (const animation of connectorAnimations) {
    animation.cancel();
  }
  connectorAnimations = [];
  const frame = frameElement();
  const connector = frame?.querySelector<SVGSVGElement>("[data-career-connector]");
  const line = connector?.querySelector<SVGPathElement>("[data-career-connector-line]");
  const head = connector?.querySelector<SVGPathElement>(".about-passage__arrowhead");
  const heading = activeCard?.querySelector<HTMLElement>(".career-card__org");
  const column = document.querySelector<HTMLElement>(PASSAGE);
  const placement = frame?.dataset.placement;
  if (
    !frame ||
    !connector ||
    !line ||
    !head ||
    !heading ||
    !column ||
    (placement !== "left" && placement !== "right")
  ) {
    return;
  }
  const noteRect = frame.getBoundingClientRect();
  const label = trigger.querySelector(".inline-entity__label") ?? trigger;
  const labelRect = label.getBoundingClientRect();
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const columnRect = column.getBoundingClientRect();
  const headingY = heading.getBoundingClientRect().bottom - rem * 0.2;
  const geometry = createCareerNoteConnector({
    placement,
    noteRect,
    headingY,
    triggerRect: labelRect,
    columnLeft: columnRect.left,
    columnRight: columnRect.right,
    textRects: passageTextRects(column, trigger),
  });
  connector.style.left = `${geometry.left - noteRect.left}px`;
  connector.style.top = `${geometry.top - noteRect.top}px`;
  connector.style.width = `${geometry.width}px`;
  connector.style.height = `${geometry.height}px`;
  connector.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
  line.setAttribute("d", geometry.line);
  head.setAttribute("d", geometry.arrowhead);
  const gradient = connector.querySelector("linearGradient");
  gradient?.setAttribute("x1", placement === "left" ? "0%" : "100%");
  gradient?.setAttribute("x2", placement === "left" ? "100%" : "0%");
  if (!contentMotionEnabled()) {
    return;
  }
  const duration = opening ? 240 : 180;
  connectorAnimations = [
    line.animate(
      [
        { strokeDasharray: "1", strokeDashoffset: 1 },
        { strokeDasharray: "1", strokeDashoffset: 0 },
      ],
      { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    ),
    head.animate([{ opacity: 0 }, { opacity: 0.85 }], {
      delay: duration - 100,
      duration: 100,
      fill: "backwards",
    }),
  ];
}

function modalElement() {
  return document.querySelector<HTMLDialogElement>(MODAL);
}

function placementInput(trigger: HTMLElement) {
  const passage = document.querySelector<HTMLElement>(PASSAGE);
  const column = passage?.getBoundingClientRect();
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

  return {
    columnLeft: column?.left ?? 0,
    columnRight: column?.right ?? window.innerWidth,
    popoverHeight: 1,
    popoverWidth: rem * 20,
    railGap: 64,
    triggerRect: triggerRect(trigger),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    // Keep the note above the 45px paper wash and its 12px fade.
    viewportBottomInset: 64,
    viewportTopInset:
      document.querySelector(".about-template__veil")?.getBoundingClientRect().bottom ?? 28,
  };
}

function returnFrameHome(frame: HTMLElement) {
  document.querySelector("[data-career-popover-home]")?.after(frame);
}

function positionFrame(trigger: HTMLElement, opening: boolean) {
  const frame = frameElement();
  if (!frame || !activeCard) {
    return false;
  }

  frameEpoch += 1;
  frameAnimation?.cancel();
  returnFrameHome(frame);
  clearFrameGeometry(frame);
  frame.dataset.state = "measuring";
  frame.removeAttribute("inert");
  frame.removeAttribute("aria-hidden");
  for (const property of ["--career-note-accent", "--career-note-accent-tail"]) {
    frame.style.setProperty(property, activeCard.style.getPropertyValue(property));
  }

  const input = placementInput(trigger);
  const preliminary = placeCareerPopover(input);
  if (preliminary.placement === "modal") {
    const modal = modalElement();
    const mount = modal?.querySelector("[data-career-modal-mount]");
    if (!modal || !mount) {
      return false;
    }
    frame.dataset.placement = "modal";
    frame.dataset.state = "open";
    mount.append(frame);
    modal.setAttribute("aria-labelledby", `${activeCard.id}-title`);
    modal.dataset.state = "open";
    modalTrigger = trigger;
    document.documentElement.setAttribute("data-career-modal-open", "");
    if (!modal.open) {
      modal.showModal();
      activeCard.querySelector<HTMLElement>(".career-card__org")?.focus({ preventScroll: true });
    }
    frameAnimation = enterPopover(modal);
    return true;
  }

  // Width first: a long heading or wrapped summary can change the note's height.
  frame.style.width = `${preliminary.width}px`;
  input.popoverHeight = activeCard.offsetHeight;
  const placement = placeCareerPopover(input);
  frame.dataset.placement = placement.placement;
  frame.style.height = `${placement.height}px`;
  frame.style.left = `${placement.left}px`;
  frame.style.top = `${placement.top}px`;
  frame.style.width = `${placement.width}px`;
  frame.dataset.state = "open";

  positionConnector(trigger, opening);
  frameAnimation = enterPopover(frame, false);
  return true;
}

function setActiveCard(selected?: HTMLElement) {
  for (const card of document.querySelectorAll<HTMLElement>(CARD)) {
    if (card === selected) {
      card.dataset.popoverLayer = "active";
    } else {
      delete card.dataset.popoverLayer;
    }
  }
}

function setTriggerState(trigger: HTMLElement | undefined, isOpen: boolean) {
  if (!trigger) {
    return;
  }

  trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (isOpen) {
    trigger.dataset.state = "open";
  } else {
    delete trigger.dataset.state;
  }
}

function open(trigger: HTMLElement, opening = true) {
  const card = cardFor(trigger);

  if (!card || !frameElement()) {
    return;
  }

  setActiveCard(card);
  activeCard = card;
  activeTrigger = trigger;

  if (!positionFrame(trigger, opening)) {
    setActiveCard();
    activeCard = undefined;
    return;
  }

  bindBody(card);
  setTriggerState(trigger, true);
}

function retarget(trigger: HTMLElement, previous: HTMLElement) {
  const incoming = cardFor(trigger);
  const frame = frameElement();
  if (!incoming || !frame) {
    return;
  }
  setTriggerState(previous, false);
  setTriggerState(trigger, true);
  activeTrigger = trigger;
  if (!contentMotionEnabled() || !frame.dataset.state) {
    open(trigger, false);
    return;
  }

  // Fade the old note at its existing anchor before placing the replacement.
  // A new target invalidates this completion, so fast sweeps reveal only the
  // last name the reader settles on, without moving old text across the page.
  const epoch = ++frameEpoch;
  const style = getComputedStyle(frame);
  const opacity = style.opacity;
  const transform = style.transform;
  frameAnimation?.cancel();
  frame.dataset.state = "switching";
  frame.setAttribute("inert", "");
  frame.setAttribute("aria-hidden", "true");
  frameAnimation = frame.animate(
    [
      { opacity, transform },
      { opacity: 0, transform },
    ],
    {
      duration: 90,
      easing: "ease-out",
      fill: "forwards",
    },
  );
  void frameAnimation.finished
    .then(() => {
      if (epoch === frameEpoch) {
        open(trigger, false);
      }
      return undefined;
    })
    .catch(() => {});
}

function resetFrame() {
  const modal = modalElement();
  restoringFocus = true;
  if (modal?.open) {
    modal.close();
    modalTrigger?.focus({ preventScroll: true });
  }
  restoringFocus = false;
  modalTrigger = undefined;
  if (modal) {
    delete modal.dataset.state;
  }
  document.documentElement.removeAttribute("data-career-modal-open");
  for (const animation of connectorAnimations) {
    animation.cancel();
  }
  connectorAnimations = [];
  setActiveCard();
  for (const card of document.querySelectorAll<HTMLElement>(CARD)) {
    resetBody(bodyFor(card));
  }
  const frame = frameElement();
  if (frame) {
    returnFrameHome(frame);
    delete frame.dataset.state;
    frame.removeAttribute("inert");
    frame.removeAttribute("aria-hidden");
    clearFrameGeometry(frame);
  }
}

function close(immediate = false) {
  const frame = frameElement();
  const epoch = ++frameEpoch;
  scrollbar.destroy();
  scrollbar = { destroy() {}, refresh() {} };
  activeCard = undefined;
  activeTrigger = undefined;
  for (const trigger of document.querySelectorAll<HTMLElement>(TRIGGER)) {
    setTriggerState(trigger, false);
  }

  if (!frame || !frame.dataset.state || immediate || !contentMotionEnabled()) {
    frameAnimation?.cancel();
    resetFrame();
    return;
  }

  // Leave the current ink in place until it has faded. The epoch prevents a
  // completed exit from clearing a note reopened during those final frames.
  const modal = modalElement();
  const surface = modal?.open ? modal : frame;
  const style = getComputedStyle(surface);
  const opacity = style.opacity;
  const transform = style.transform;
  frameAnimation?.cancel();
  frame.dataset.state = "closing";
  if (modal?.open) {
    modal.dataset.state = "closing";
  }
  frame.setAttribute("inert", "");
  frame.setAttribute("aria-hidden", "true");
  frameAnimation = surface.animate(
    [
      { opacity, transform },
      { opacity: 0, transform: modal?.open ? "translateY(6px) scale(0.99)" : transform },
    ],
    { duration: 180, easing: "ease-out", fill: "forwards" },
  );
  void frameAnimation.finished
    .then(() => {
      if (epoch === frameEpoch) {
        resetFrame();
        frameAnimation?.cancel();
      }
      return undefined;
    })
    .catch(() => {});
}

function scrollBodyByKey(body: HTMLElement, key: string): boolean {
  if (body.scrollHeight <= body.clientHeight) {
    return false;
  }

  const pageStep = Math.max(SCROLL_STEP, body.clientHeight * 0.8);
  let nextScrollTop: number | undefined;

  switch (key) {
    case "ArrowDown":
      nextScrollTop = body.scrollTop + SCROLL_STEP;
      break;
    case "ArrowUp":
      nextScrollTop = body.scrollTop - SCROLL_STEP;
      break;
    case "End":
      nextScrollTop = body.scrollHeight;
      break;
    case "Home":
      nextScrollTop = 0;
      break;
    case "PageDown":
      nextScrollTop = body.scrollTop + pageStep;
      break;
    case "PageUp":
      nextScrollTop = body.scrollTop - pageStep;
      break;
  }

  if (nextScrollTop === undefined) {
    return false;
  }
  body.scrollTop = nextScrollTop;

  return true;
}

let wired = false;

function initialize() {
  const modal = modalElement();
  if (modal && !boundModals.has(modal)) {
    boundModals.add(modal);
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      disclosure?.close();
    });
    let pressedBackdrop = false;
    const outsidePanel = (event: MouseEvent) => {
      const rect = modal.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    modal.addEventListener("pointerdown", (event) => {
      pressedBackdrop = event.target === modal && outsidePanel(event);
    });
    modal.addEventListener("click", (event) => {
      const closeButton =
        event.target instanceof Element && event.target.closest("[data-career-modal-close]");
      if (closeButton || (pressedBackdrop && event.target === modal && outsidePanel(event))) {
        disclosure?.close();
      }
      pressedBackdrop = false;
    });
  }
  for (const trigger of document.querySelectorAll<HTMLElement>(TRIGGER)) {
    setTriggerState(trigger, false);
  }
}

export function bindCareerPopoverLifecycle() {
  if (!window.matchMedia("(scripting: enabled)").matches) {
    return;
  }

  initialize();
  if (wired) {
    return;
  }
  wired = true;

  disclosure = bindHoverDisclosure({
    close,
    closeOnScroll: () => !modalElement()?.open,
    closeOnLeave: () => !modalElement()?.open,
    opensOnRest: (trigger) =>
      !restoringFocus && placeCareerPopover(placementInput(trigger)).placement !== "modal",
    closeGrace: 600,
    keydown(event) {
      if (frameElement()?.dataset.state !== "open") {
        return false;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        const link = activeCard?.querySelector<HTMLAnchorElement>("a[href]");
        if (link) {
          link.focus({ preventScroll: true });
          return true;
        }
      }
      const body = bodyFor(activeCard);
      return Boolean(body && scrollBodyByKey(body, event.key));
    },
    open,
    retarget,
    surfaceSelector: `${OPEN_FRAME}, ${MODAL}[open]`,
    triggerSelector: TRIGGER,
  });

  document.addEventListener("keydown", (event) => {
    if (
      !modalElement()?.open &&
      event.key === "Tab" &&
      event.shiftKey &&
      activeCard?.querySelector("a[href]") === document.activeElement
    ) {
      event.preventDefault();
      activeTrigger?.focus({ preventScroll: true });
    }
  });
  document.addEventListener("site:room-change", (event) => {
    if (event.detail.phase === "start") close(true);
  });
}
