import { parseBookDetails, type BookDetails } from "../lib/book-details";

let records: Promise<BookDetails[]> | undefined;

export function loadBookDetails() {
  records ??= fetch("/bookshelf/details.json")
    .then(async (response) => (response.ok ? parseBookDetails(await response.text()) : []))
    .catch(() => []);
  return records;
}

export function paintBookDetails(dialog: HTMLElement, details?: BookDetails) {
  const body = dialog.querySelector<HTMLElement>("[data-inspect-extra]");
  const description = dialog.querySelector<HTMLElement>("[data-inspect-description]");
  const facts = dialog.querySelector<HTMLElement>("[data-inspect-facts]");
  const categories = dialog.querySelector<HTMLElement>("[data-inspect-categories]");
  const footer = dialog.querySelector<HTMLElement>("[data-inspect-footer]");
  if (!body || !description || !facts || !categories) return;
  description.textContent = details?.description ?? "";
  description.hidden = !details?.description;
  facts.replaceChildren();
  for (const [label, value] of [
    ["First published", details?.firstPublished],
    ["Pages", details?.pages],
    ["Publisher", details?.publisher],
    [
      "Cover edition",
      details?.released === details?.firstPublished ? undefined : details?.released,
    ],
  ]) {
    if (!label || !value) continue;
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = label;
    definition.textContent = value;
    row.append(term, definition);
    facts.append(row);
  }
  facts.hidden = !facts.childElementCount;
  if (footer) footer.hidden = facts.hidden;
  categories.replaceChildren();
  for (const label of details?.categories ?? []) {
    const category = document.createElement("li");
    category.className = "book-inspector__category";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.bookCategory = label;
    button.textContent = label;
    button.setAttribute("aria-label", `Show books in ${label}`);
    category.append(button);
    categories.append(category);
  }
  categories.hidden = !categories.childElementCount;
  body.hidden = description.hidden;
}
