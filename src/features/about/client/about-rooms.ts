import { bindSiteMenu, markMenuPath } from "../../../components/lib/site-menu";
import {
  readEnhancementTier,
  watchEnhancementPolicy,
} from "../../../components/lib/enhancement-policy";
import { initOverlayScrollbars } from "../../../components/lib/overlay-scrollbar";
import { scrollPageToTop } from "../../../components/lib/scroll-content";
import { initScrollFades } from "../../../scripts/scroll-fade";
import {
  aboutRoomForPath,
  aboutRoomPaths,
  aboutRoomTitles,
  type AboutRoom,
} from "../lib/about-room";
import { mountRoomRuntime } from "./room-runtime";

const STAGE = "[data-about-rooms]";
const MENU_LINK = "[data-site-menu-path]";
const DRAIN_MS = 620;
const FILL_MS = 460;
const LOAD_TIMEOUT_MS = 10000;
const drainEase = (t: number) => Math.pow(t, 0.62);
const fillEase = (t: number) => 1 - Math.pow(1 - t, 1.45);
const metadataSelectors = [
  'meta[name="description"]',
  'link[rel="canonical"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];

type RoomDocument = {
  element: HTMLElement;
  toolbar?: HTMLElement;
  metadata: Element[];
  title: string;
};
type PendingRoom = { controller: AbortController; promise: Promise<RoomDocument> };
type RoomElements = { letter: HTMLElement | null; shelf: HTMLElement | null };

const rooms = new Map<AboutRoom, RoomDocument>();
const pendingRooms = new Map<AboutRoom, PendingRoom>();
const stylesheetLoads = new Map<string, Promise<void>>();
const transitionImages = new Map<string, Promise<void>>();
let frame = 0;
let drain = 0;
let heading: AboutRoom = "letter";
let requestRevision = 0;
let statusTimer = 0;
let bound = false;

function stageElement() {
  return document.querySelector<HTMLElement>(STAGE);
}

async function prepareTransition(scope: HTMLElement) {
  if (readEnhancementTier() !== "full" || !CSS.supports("mask-composite", "intersect")) return;
  const letter = scope.matches("[data-room-transition-assets]")
    ? scope
    : scope.querySelector<HTMLElement>("[data-room-transition-assets]");
  const sources = letter?.dataset.roomTransitionAssets?.split(" ") ?? [];
  await Promise.all(
    sources.map((source) => {
      const existing = transitionImages.get(source);
      if (existing) return existing;
      const image = new Image();
      image.src = source;
      const decoded = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          image.removeAttribute("src");
          reject(new Error("The room transition artwork could not load."));
        }, LOAD_TIMEOUT_MS);
        image.decode().then(
          () => {
            window.clearTimeout(timer);
            return resolve();
          },
          (error: Error) => {
            window.clearTimeout(timer);
            return reject(error);
          },
        );
      });
      const loading = decoded.catch((error) => {
        transitionImages.delete(source);
        throw error;
      });
      transitionImages.set(source, loading);
      return loading;
    }),
  );
}

function roomElements(stage: HTMLElement): RoomElements {
  return {
    letter: stage.querySelector<HTMLElement>('[data-about-room="letter"]'),
    shelf: stage.querySelector<HTMLElement>('[data-about-room="bookshelf"]'),
  };
}

function announceRoom(room: AboutRoom, phase: "start" | "settled") {
  document.dispatchEvent(new CustomEvent("site:room-change", { detail: { room, phase } }));
}

function updateMetadata(room: AboutRoom) {
  const page = rooms.get(room);
  document.title = page?.title || aboutRoomTitles[room];
  for (const source of page?.metadata ?? []) {
    const selector =
      source.tagName === "LINK"
        ? 'link[rel="canonical"]'
        : source.hasAttribute("property")
          ? `meta[property="${source.getAttribute("property")}"]`
          : `meta[name="${source.getAttribute("name")}"]`;
    const current = document.head.querySelector(selector);
    if (current) current.replaceWith(source.cloneNode(true));
    else document.head.append(source.cloneNode(true));
  }
}

function settle(stage: HTMLElement, room: AboutRoom, elements = roomElements(stage)) {
  stage.dataset.room = room;
  heading = room;
  delete stage.dataset.scrub;
  delete stage.dataset.roomTransition;
  elements.letter?.style.removeProperty("--drain");
  elements.letter?.style.removeProperty("opacity");
  elements.shelf?.style.removeProperty("opacity");
  if (elements.letter) elements.letter.inert = room !== "letter";
  if (elements.shelf) elements.shelf.inert = room !== "bookshelf";
  drain = room === "bookshelf" ? 1 : 0;
  markMenuPath(aboutRoomPaths[room]);
  updateMetadata(room);
  announceRoom(room, "settled");
  initScrollFades();
  initOverlayScrollbars();
}

function write(elements: RoomElements, value: number, light: boolean) {
  drain = value;
  if (light) {
    if (elements.letter) elements.letter.style.opacity = (1 - value).toFixed(4);
  } else elements.letter?.style.setProperty("--drain", value.toFixed(4));
  if (elements.shelf) {
    elements.shelf.style.opacity = (
      light ? value : Math.max(0, Math.min(1, (value - 0.48) / 0.52))
    ).toFixed(4);
  }
}

function showAboutRoom(stage: HTMLElement, room: AboutRoom, animate: boolean) {
  if (heading === room && !frame) {
    settle(stage, room);
    return;
  }
  cancelAnimationFrame(frame);
  frame = 0;
  announceRoom(room, "start");
  // Reset before the long bookshelf gives way to the shorter letter; native
  // clamping after that resize would otherwise land inside the stretch tail.
  scrollPageToTop();
  const tier = readEnhancementTier();
  if (!animate || tier === "static") {
    settle(stage, room);
    return;
  }

  const to = room === "bookshelf" ? 1 : 0;
  const from = drain;
  const light = tier === "light" || !CSS.supports("mask-composite", "intersect");
  const ease = to === 1 ? drainEase : fillEase;
  const duration = (light ? 160 : to === 1 ? DRAIN_MS : FILL_MS) * Math.abs(to - from);
  const elements = roomElements(stage);
  const started = performance.now();
  // The letter owns the sheet's flow for the whole scrub, even when reversing.
  // Both rooms are mounted, with their final CSS, before that ownership changes.
  stage.dataset.room = "letter";
  stage.dataset.scrub = to === 1 ? "out" : "in";
  stage.dataset.roomTransition = light ? "fade" : "scrub";
  heading = room;
  if (elements.letter) elements.letter.inert = true;
  if (elements.shelf) elements.shelf.inert = true;
  write(elements, from, light);
  markMenuPath(aboutRoomPaths[room]);
  updateMetadata(room);
  const step = (now: number) => {
    const t = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
    write(elements, from + (to - from) * ease(t), light);
    if (t < 1) frame = requestAnimationFrame(step);
    else {
      frame = 0;
      settle(stage, room, elements);
    }
  };
  frame = requestAnimationFrame(step);
}

function readRoom(doc: Document, room: AboutRoom): RoomDocument {
  const element = doc.querySelector<HTMLElement>(`[data-about-room="${room}"]`);
  if (!element) throw new Error("The requested room is missing.");
  const toolbar =
    room === "bookshelf"
      ? (doc.querySelector<HTMLElement>("[data-room-toolbar]") ?? undefined)
      : undefined;
  // Data blocks remain available to known feature code; fetched code never runs.
  for (const root of [element, toolbar]) {
    root
      ?.querySelectorAll('script:not([type="application/json"])')
      .forEach((script) => script.remove());
  }
  const page: RoomDocument = {
    element,
    metadata: metadataSelectors.flatMap((selector) => {
      const node = doc.head.querySelector(selector);
      const clone = node?.cloneNode(true);
      return clone instanceof Element ? [clone] : [];
    }),
    title: doc.title,
  };
  if (toolbar) page.toolbar = toolbar;
  return page;
}

function loadStylesheet(source: HTMLLinkElement) {
  const href = new URL(source.getAttribute("href") ?? "", location.origin).href;
  if (new URL(href).origin !== location.origin) {
    return Promise.reject(new Error("Room styles must come from this site."));
  }
  const existing = stylesheetLoads.get(href);
  if (existing) return existing;
  const current = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).find((link) => link.href === href);
  if (current?.sheet) return Promise.resolve();
  const link = current ?? source.cloneNode(true);
  if (!(link instanceof HTMLLinkElement)) {
    return Promise.reject(new Error("The room stylesheet is invalid."));
  }
  link.href = href;
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      link.removeEventListener("load", loaded);
      link.removeEventListener("error", failed);
      if (error) {
        stylesheetLoads.delete(href);
        if (!current) link.remove();
        reject(error);
      } else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error("The room stylesheet could not load."));
    const timeout = window.setTimeout(failed, LOAD_TIMEOUT_MS);
    link.addEventListener("load", loaded, { once: true });
    link.addEventListener("error", failed, { once: true });
    if (!current) document.head.append(link);
  });
  stylesheetLoads.set(href, promise);
  return promise;
}

async function prepareStyles(doc: Document) {
  const styles = new Set(
    Array.from(document.querySelectorAll("style"), (style) => style.textContent),
  );
  // Also includes generated material styles linked from inside a room.
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  await Promise.all(links.map(loadStylesheet));
  // Material links can live inside the room. Their adopted head copies already
  // own those rules; retaining the originals would parse/apply the sheet twice.
  for (const link of links) link.remove();
  for (const style of doc.querySelectorAll("style")) {
    if (!styles.has(style.textContent)) {
      document.head.append(style.cloneNode(true));
      styles.add(style.textContent);
    }
    style.remove();
  }
}

function fetchRoom(room: AboutRoom): Promise<RoomDocument> {
  const cached = rooms.get(room);
  if (cached) return Promise.resolve(cached);
  const existing = pendingRooms.get(room);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  const promise = fetch(aboutRoomPaths[room], { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
        throw new Error("The requested room could not load.");
      }
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const page = readRoom(doc, room);
      await prepareStyles(doc);
      if (controller.signal.aborted)
        throw new DOMException("Room request cancelled.", "AbortError");
      rooms.set(room, page);
      return page;
    })
    .finally(() => {
      window.clearTimeout(timeout);
      if (pendingRooms.get(room)?.controller === controller) pendingRooms.delete(room);
    });
  pendingRooms.set(room, { controller, promise });
  return promise;
}

function clearStatus(stage: HTMLElement) {
  window.clearTimeout(statusTimer);
  stage.removeAttribute("aria-busy");
  const status = document.querySelector<HTMLElement>("[data-room-status]");
  if (status) {
    status.hidden = true;
    status.replaceChildren();
  }
}

async function requestRoom(room: AboutRoom, animate: boolean, replaceAddress = true) {
  const stage = stageElement();
  if (!stage) return;
  const revision = ++requestRevision;
  clearStatus(stage);
  for (const [otherRoom, pending] of pendingRooms) {
    if (otherRoom !== room) {
      pending.controller.abort();
      pendingRooms.delete(otherRoom);
    }
  }
  stage.setAttribute("aria-busy", "true");
  statusTimer = window.setTimeout(() => {
    const status = document.querySelector<HTMLElement>("[data-room-status]");
    if (status && revision === requestRevision) {
      status.textContent = room === "bookshelf" ? "Loading bookshelf…" : "Loading about…";
      status.hidden = false;
    }
  }, 150);
  try {
    const page = await fetchRoom(room);
    if (revision !== requestRevision) return;
    const scene = stage.querySelector<HTMLElement>("[data-room-scene]");
    const toolbar = document.querySelector<HTMLElement>("[data-room-toolbar]");
    if (!scene) throw new Error("The sheet is unavailable.");
    // A DOMParser result is connected to its own detached Document. Test the
    // destination scene, rather than isConnected, before adopting the room.
    if (!scene.contains(page.element)) {
      page.element.inert = true;
      scene.append(page.element);
    }
    // The shelf's search listeners retain this input; never recreate it on return.
    if (page.toolbar && toolbar && !toolbar.firstElementChild) {
      toolbar.append(...Array.from(page.toolbar.childNodes));
    }
    await Promise.all([
      mountRoomRuntime(room, page.element, () => revision === requestRevision),
      animate ? prepareTransition(stage) : Promise.resolve(),
    ]);
    if (revision !== requestRevision) return;
    clearStatus(stage);
    if (replaceAddress && location.pathname !== aboutRoomPaths[room]) {
      history.replaceState(history.state, "", aboutRoomPaths[room]);
    }
    showAboutRoom(stage, room, animate);
  } catch {
    if (revision !== requestRevision) return;
    clearStatus(stage);
    // Both rooms are complete public pages. A failed progressive enhancement
    // should continue the link's ordinary navigation without another click.
    location.assign(aboutRoomPaths[room]);
  }
}

function menuRoom(target: EventTarget | null) {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>(MENU_LINK) : null;
  const path = link?.dataset.siteMenuPath;
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self"))
    return undefined;
  const url = new URL(link.href);
  if (
    url.origin !== location.origin ||
    url.pathname.replace(/\/+$/, "") !== path?.replace(/\/+$/, "")
  )
    return undefined;
  return path === "/" || path === "/bookshelf" ? aboutRoomForPath(path) : undefined;
}

export function bindAboutRooms() {
  const stage = stageElement();
  if (!stage || bound) return;
  bound = true;
  heading = stage.dataset.room === "bookshelf" ? "bookshelf" : "letter";
  drain = heading === "bookshelf" ? 1 : 0;
  const initial = readRoom(document, heading);
  rooms.set(heading, initial);
  bindSiteMenu();
  const initialRoom = heading;
  const initialRevision = requestRevision;
  // The server-rendered room is already complete. Give it a paint opportunity
  // before downloading optional controllers or measuring its scroll surfaces.
  // Navigation stays immediately available and can supersede this first mount.
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (requestRevision !== initialRevision) return;
      void mountRoomRuntime(initialRoom, initial.element, () => requestRevision === initialRevision)
        .then(() => {
          if (requestRevision === initialRevision) {
            initScrollFades();
            initOverlayScrollbars();
          }
          return undefined;
        })
        .catch((error) => console.warn("Keeping the static room", error));
    }, 0);
  });

  const preload = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerType !== "mouse") return;
    if (readEnhancementTier() === "static") return;
    const room = menuRoom(event.target);
    if (room && room !== heading) {
      void Promise.all([
        prepareTransition(stage),
        fetchRoom(room).then((page) => prepareTransition(page.element)),
      ]).catch(() => undefined);
    }
  };
  document.addEventListener("pointerover", preload, { passive: true });
  document.addEventListener("focusin", preload);
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const room = menuRoom(event.target);
    if (!room) return;
    event.preventDefault();
    void requestRoom(room, true);
  });
  window.addEventListener("popstate", () => {
    void requestRoom(aboutRoomForPath(location.pathname), false, false);
  });
  const finishTransition = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    settle(stage, heading);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishTransition();
  });
  const policyController = new AbortController();
  watchEnhancementPolicy(finishTransition, policyController.signal);
}
