/**
 * The two rooms of the about sheet. Not to be confused with the shell's
 * `SiteRoom`, which is how the page shell is dressed: this is which of the two
 * things printed on the sheet the reader is looking at — the letter, or the
 * shelf it scrubs away to reveal.
 */
export type AboutRoom = "letter" | "bookshelf";

declare global {
  interface DocumentEventMap {
    "site:room-change": CustomEvent<{ room: AboutRoom; phase: "start" | "settled" }>;
  }
}

/** The address each room stands for. */
export const aboutRoomPaths = {
  letter: "/",
  bookshelf: "/bookshelf",
} satisfies Record<AboutRoom, string>;

/**
 * What the page is called in each room. The rooms swap without a navigation,
 * so nothing else updates the document's title — and these have to keep saying
 * what each route's own `<Layout title>` says.
 */
export const aboutRoomTitles = {
  letter: "Braden Marshall",
  bookshelf: "Bookshelf | Braden Marshall",
} satisfies Record<AboutRoom, string>;

/** Which room an address names; anything unrecognised is the letter. */
export function aboutRoomForPath(path: string): AboutRoom {
  return path.replace(/\/+$/, "") === "/bookshelf" ? "bookshelf" : "letter";
}
