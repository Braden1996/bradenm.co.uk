/** Watch the content's size as well as its fixed scroll viewport. */
export function observeScrollContent(
  viewport: HTMLElement,
  resizeObserver: ResizeObserver,
  onChange: () => void,
) {
  const observed = new Set<Element>();

  function syncChildren() {
    const children = new Set(viewport.children);

    for (const child of observed) {
      if (!children.has(child)) {
        resizeObserver.unobserve(child);
        observed.delete(child);
      }
    }

    for (const child of children) {
      if (!observed.has(child)) {
        resizeObserver.observe(child);
        observed.add(child);
      }
    }
  }

  syncChildren();

  const contentObserver = new MutationObserver((records) => {
    if (records.some((record) => record.target === viewport)) {
      syncChildren();
    }
    onChange();
  });
  contentObserver.observe(viewport, { childList: true, subtree: true });

  return contentObserver;
}
/** The document owns narrow pages; the page wrapper owns wider ones. */
export function scrollPageToTop() {
  const viewport = matchMedia("(max-width: 760px)").matches
    ? document.scrollingElement
    : document.querySelector<HTMLElement>(".page-wrap");
  viewport?.scrollTo({ top: 0, behavior: "instant" });
}
