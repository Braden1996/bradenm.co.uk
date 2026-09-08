import type { AboutRoom } from "../lib/about-room";

/** Mount known code explicitly; scripts in a fetched room stay inert. */
export async function mountRoomRuntime(
  room: AboutRoom,
  element: HTMLElement,
  isCurrent: () => boolean = () => true,
) {
  if (room === "bookshelf") {
    const [{ mountBookshelf }, { initializeSearchBars }] = await Promise.all([
      import("../../bookshelf/client/bookshelf"),
      import("../../../components/lib/search-bars"),
    ]);
    if (!element.isConnected || !isCurrent()) return;
    const shelf = element.querySelector<HTMLElement>("[data-bookshelf-root]");
    initializeSearchBars();
    if (shelf) mountBookshelf(shelf);
  } else {
    const [
      { bindVisiblePortraitLifecycle },
      { bindSignatureDogLifecycle },
      { bindCareerPopoverLifecycle },
    ] = await Promise.all([
      import("./about-portrait-loader"),
      import("./signature-dog"),
      import("./career-popover"),
    ]);
    // Imports cannot be aborted. A superseded request may finish downloading,
    // but it must not attach listeners or start work in an inactive room.
    if (!element.isConnected || !isCurrent()) return;
    bindVisiblePortraitLifecycle();
    bindSignatureDogLifecycle();
    bindCareerPopoverLifecycle();
  }
}
