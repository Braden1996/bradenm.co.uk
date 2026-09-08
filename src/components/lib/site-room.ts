/**
 * The rooms the shell dresses — which is not the same question as which of the
 * about sheet's two rooms is showing (see `AboutRoom`). The about rooms, `/`
 * and `/bookshelf`, are one wide sheet with only the letterhead menu in its
 * corner: no header and no footer, because the sheet is the whole page and the
 * shell paints its foot itself. Everything else (today only the 404) is a
 * plain sheet with the header and the footer.
 */
export type SiteRoom = "about" | "plain";
