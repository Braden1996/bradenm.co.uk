function syncPersistedNav() {
  const page = document.querySelector<HTMLElement>("[data-timeline-page]");
  const nav = document.querySelector<HTMLElement>("[data-timeline-nav]");

  if (!page || !nav) {
    return;
  }

  const activeSlug = page.dataset.activeSlug ?? "";

  for (const link of nav.querySelectorAll<HTMLElement>("[data-timeline-link]")) {
    const entry = link.closest<HTMLElement>(".timeline-entry");
    const isSelected = link.dataset.entrySlug === activeSlug;

    link.dataset.selected = String(isSelected);

    if (entry) {
      entry.dataset.selected = String(isSelected);
    }

    if (isSelected) {
      link.setAttribute("aria-current", "page");
      link.scrollIntoView({ block: "nearest" });
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

document.addEventListener("astro:after-swap", syncPersistedNav);
