/*
 * The site's menu: the letterhead's left corner. The rooms first — the tab
 * naming the address the reader is at wears the site's painted line — then
 * Connect, whose own places unfold under it when the pointer rests on it.
 *
 * The unfolding is CSS (`:hover`, `:focus-within` on the item), so it works
 * before this module runs, without scripting, and on a touch screen — a tap
 * focuses the button, which is what opens it there. All this adds is the
 * button's honesty: `aria-expanded` says what is actually showing.
 */
import { paperWashAccents, paperWashTints } from "./paper-accents";

export type SiteMenuRoom = {
  href: string;
  label: string;
  pigments: readonly [string, string];
};

export type SiteMenuPlace = {
  href: string;
  label: string;
};

/** The rooms of the site, in the order they are worth visiting. */
export const siteMenuRooms: readonly SiteMenuRoom[] = [
  { href: "/", label: "About", pigments: [paperWashAccents.green, paperWashTints.mint] },
  {
    href: "/bookshelf",
    label: "Bookshelf",
    pigments: [paperWashAccents.blue, paperWashTints.slate],
  },
];

/** Everywhere else Braden is, in full — the list Connect unfolds. */
export const siteMenuPlaces: readonly SiteMenuPlace[] = [
  { href: "https://www.linkedin.com/in/braden-marshall/", label: "LinkedIn" },
  { href: "https://x.com/SirBraden1996", label: "X" },
  { href: "https://github.com/Braden1996", label: "GitHub" },
  { href: "https://steamcommunity.com/id/Braden1996", label: "Steam" },
  { href: "mailto:me@bradenm.co.uk", label: "Email" },
];

const CONNECT = "[data-site-menu-connect]";
const TRIGGER = "[data-site-menu-connect-trigger]";
const ROOM_TAB = "[data-site-menu-path]";

/** One leading slash, no trailing one: "/bookshelf/" and "/bookshelf" are one tab. */
export function normaliseMenuPath(path: string) {
  const trimmed = path.replace(/\/+$/, "");

  return trimmed === "" ? "/" : trimmed;
}

/**
 * Mark the tab that names `path` as the one the reader is at. The server has
 * already marked the tab its route names; this is for the rooms that change
 * under the reader without a navigation (about-rooms).
 */
export function markMenuPath(path: string) {
  const current = normaliseMenuPath(path);

  for (const tab of document.querySelectorAll<HTMLElement>(ROOM_TAB)) {
    if (tab.dataset.siteMenuPath === current) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
}

let lifecycleBound = false;
const boundItems = new WeakSet<HTMLElement>();

function bindConnect(item: HTMLElement) {
  const trigger = item.querySelector<HTMLElement>(TRIGGER);

  if (!trigger) {
    return;
  }

  const say = (open: boolean) => trigger.setAttribute("aria-expanded", String(open));

  /*
   * Reporting what CSS is already showing, never deciding it: `:hover` and
   * `:focus-within` are the state, and these only put it into words. Which
   * means a closer has to check the OTHER signal before it claims a close —
   * a pointer leaving a mark whose list still holds focus has closed nothing.
   */
  const left = () => {
    if (item.matches(":hover") || item.contains(document.activeElement)) {
      return;
    }
    delete item.dataset.dismissed;
    say(false);
  };

  item.addEventListener("pointerenter", () => say(true));
  item.addEventListener("pointerleave", left);
  item.addEventListener("focusin", () => say(true));
  item.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !item.contains(event.relatedTarget)) {
      /* Focus has not moved yet at focusout time, so ask on the next task. */
      setTimeout(left);
    }
  });
}

/*
 * Escape puts the list away without asking the reader to move the pointer off
 * it, which is what WCAG 1.4.13 means by dismissible — the one thing a hover
 * rule cannot do for itself, the pointer still being where it was. The flag is
 * cleared the moment the pointer or focus leaves, so the mark opens normally
 * the next time it is rested on.
 *
 * Bound ONCE for the document, not once per mark: the strip is re-rendered on
 * every arrival, and a listener per arrival would pile up around detached
 * elements. It finds whichever mark is open rather than closing over one.
 */
function bindDismiss() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    for (const trigger of document.querySelectorAll<HTMLElement>(
      `${TRIGGER}[aria-expanded="true"]`,
    )) {
      const item = trigger.closest<HTMLElement>(CONNECT);

      if (item) {
        item.dataset.dismissed = "";
      }
      trigger.setAttribute("aria-expanded", "false");
      trigger.blur();
    }
  });
}

export function bindSiteMenu() {
  if (!lifecycleBound) {
    lifecycleBound = true;
    bindDismiss();
  }

  for (const item of document.querySelectorAll<HTMLElement>(CONNECT)) {
    if (boundItems.has(item)) {
      continue;
    }
    boundItems.add(item);
    bindConnect(item);
  }
}
