import { initOverlayScrollbars } from "../components/lib/overlay-scrollbar";
import { bindSiteMenu } from "../components/lib/site-menu";
import { bindAboutRooms } from "../features/about/client/about-rooms";
import { initPaperOverscroll } from "./paper-overscroll";

/** One page entry keeps shared controllers in a single startup dependency graph. */
export function initializeSite() {
  bindSiteMenu();
  bindAboutRooms();
  // The sheet already has its final geometry. Measure decorative controls only
  // after its first paint so they do not force layout during the entry task.
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      initOverlayScrollbars();
      initPaperOverscroll();
    }, 0);
  });
}
