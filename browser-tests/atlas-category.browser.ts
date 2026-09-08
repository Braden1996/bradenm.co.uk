import { expect, test } from "@playwright/test";

for (const profile of [
  { name: "desktop", width: 1350, height: 940, reduced: false },
  { name: "printed", width: 1350, height: 940, reduced: true },
  { name: "mobile", width: 390, height: 844, reduced: false },
]) {
  test(`${profile.name} category buttons return to a dimmed shelf with search and a filter reset`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    if (profile.reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/bookshelf");
    const atlas = page.locator("[data-atlas]");
    const books = page.locator("[data-book-card]");
    await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
      "data-bookshelf-initialized",
      "true",
    );
    const original = await books.first().boundingBox();
    await page.locator("[data-book-open]").first().click();
    const dialog = page.locator("[data-book-inspector]");
    await expect(dialog.locator("[data-inspect-audio]")).toBeVisible();
    await expect(dialog.getByRole("link")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Show books in Psychology", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(atlas).toHaveAttribute("data-atlas-category", "Psychology");
    const clear = page.getByRole("button", { name: "Clear Psychology filter" });
    await expect(clear).toBeVisible();
    await expect(clear).toBeFocused();
    await expect(books).toHaveCount(165);
    const muted = books.locator("[data-category-muted]");
    // Count from the server's compact index, independently of the filter DOM.
    const expected = await page.locator("[data-bookshelf-payload]").evaluate((element) => {
      const payload = JSON.parse(element.textContent ?? "{}");
      return payload.books.filter((book: { details?: { categories?: string[] } }) =>
        book.details?.categories?.includes("Psychology"),
      ).length;
    });
    await expect(page.locator("[data-book-card]:not([data-category-muted])")).toHaveCount(expected);
    await expect(page.locator("[data-book-card][data-category-muted]")).toHaveCount(165 - expected);
    await expect(page.locator("[data-results-count]")).toHaveText(
      `${expected} of 165 titles in Psychology`,
    );
    if (profile.width > 760) {
      const after = await books.first().boundingBox();
      expect(after).toEqual(original);
      const label = await clear.boundingBox();
      const search = await page.locator("[data-search-input]").boundingBox();
      expect(label && search && label.x + label.width < search.x).toBe(true);
      await expect(page.locator("[data-category-muted] .atlas-book__preview").first()).toHaveCSS(
        "opacity",
        "0.25",
      );
      if (!profile.reduced) {
        await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "1");
        await expect(page.locator("[data-category-muted][data-live-cover]")).toHaveCount(0);
        await page.mouse.move(650, 430);
        await page.mouse.wheel(0, -120);
        await expect
          .poll(async () => Number(await atlas.getAttribute("data-atlas-zoom")))
          .toBeGreaterThan(1);
        await expect(page.locator("[data-category-muted][data-live-cover]")).toHaveCount(0);
      }
    }
    await page.screenshot({ path: `artifacts/atlas/category-${profile.name}.png` });
    await page.locator("[data-search-input]").fill("peterson");
    await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(3);
    await expect(atlas).toHaveAttribute("data-atlas-category", "Psychology");
    await page
      .getByRole("button", { name: "12 Rules for Life — Jordan B. Peterson", exact: true })
      .click();
    await expect(dialog.locator("[data-inspect-cover]")).toHaveAttribute(
      "alt",
      "12 Rules for Life",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(atlas).not.toHaveAttribute("data-atlas-category");
    await expect(muted).toHaveCount(0);
    await expect(page.locator("[data-category-muted]")).toHaveCount(0);
    await expect(page.locator("[data-search-input]")).toHaveValue("peterson");
    await page.locator("[data-search-input]").fill("");
    await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(165);
  });
}

test("tooltip metadata sits alongside the author without fetching the inspection catalogue", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/bookshelf/details.json")) requests.push(request.url());
  });
  await page.goto("/bookshelf");
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  await page.locator("[data-book-open]").first().hover();
  const note = page.getByRole("tooltip");
  await expect(note).toContainText("Jordan B. Peterson");
  await expect(note.locator("[data-tooltip-date]")).toHaveText("2018");
  await expect(note.locator("[data-tooltip-pages]")).toHaveText("448 pages");
  await expect(note).not.toContainText(/Physical|Audiobook/);
  await page.evaluate(() => document.fonts.ready);
  const author = await note.locator("[data-tooltip-author]").boundingBox();
  const year = await note.locator("[data-tooltip-date]").boundingBox();
  expect(author && year && year.x > author.x + author.width).toBe(true);
  expect(requests).toEqual([]);
  await page.screenshot({ path: "artifacts/atlas/tooltip-metadata.png" });
});

for (const width of [1100, 1350]) {
  test(`the ${width}px shelf keeps its geometry throughout navigation from About`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.locator('[data-site-menu-path="/bookshelf"]').hover();
    const frames = await page.evaluate(async () => {
      const samples: {
        x: number;
        y: number;
        height: number;
        bookY: number;
        bookHeight: number;
        phase: string;
      }[] = [];
      document.querySelector<HTMLAnchorElement>('[data-site-menu-path="/bookshelf"]')?.click();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const sample = () => {
          const stage = document.querySelector<HTMLElement>("[data-about-rooms]");
          const shelf = document.querySelector<HTMLElement>('[data-about-room="bookshelf"]');
          const atlas = document.querySelector("[data-atlas-stage]")?.getBoundingClientRect();
          const book = document.querySelector("[data-book-open]")?.getBoundingClientRect();
          if (
            atlas?.height &&
            book?.height &&
            shelf &&
            (stage?.dataset.room === "bookshelf" ||
              (stage?.dataset.scrub && Number(getComputedStyle(shelf).opacity) > 0.1))
          ) {
            samples.push({
              x: atlas.x,
              y: atlas.y,
              height: atlas.height,
              bookY: book.y,
              bookHeight: book.height,
              phase: stage?.dataset.scrub ?? "settled",
            });
          }
          if (performance.now() - start < 2400) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return samples;
    });
    expect(frames.some((sample) => sample.phase === "out")).toBe(true);
    expect(frames.some((sample) => sample.phase === "settled")).toBe(true);
    for (const key of ["x", "y", "height", "bookY", "bookHeight"] as const) {
      const values = frames.map((sample) => sample[key]);
      expect(Math.max(...values) - Math.min(...values), key).toBeLessThanOrEqual(1);
    }
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "bookshelf");
  });
}
