// cspell:words fulfill
import { expect, test, type Page } from "@playwright/test";

async function inspectFirst(page: Page) {
  await page.goto("/bookshelf");
  await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
    "data-bookshelf-initialized",
    "true",
  );
  await page.locator("[data-book-open]").first().click();
  const dialog = page.locator("[data-book-inspector]");
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await expect(dialog.locator("[data-inspect-description]")).not.toBeEmpty();
  await page.waitForTimeout(700);
  return dialog;
}

for (const width of [390, 540]) {
  test(`Popover Kit keeps the ${width}px company note painted, readable and keyboard accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const trigger = page.locator("[data-career-entity]").filter({ hasText: "Contentsquare" });
    await trigger.click();
    const dialog = page.locator("[data-career-modal]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Contentsquare" })).toBeFocused();
    const card = dialog.locator("[data-popover-layer=active]");
    await expect(card).toHaveAttribute("data-popover-kit", "true");
    const dividers = await Promise.all(
      ["header", "footer"].map((region) =>
        card.locator(`[data-popover-${region}]`).evaluate((element) => ({
          image: getComputedStyle(element, "::before").backgroundImage,
          display: getComputedStyle(element, "::before").display,
          border: getComputedStyle(element).borderTopWidth,
        })),
      ),
    );
    for (const divider of dividers) {
      expect(divider.image).toContain("popover-divider.");
      expect(divider.display).toBe("block");
      expect(divider.border).toBe("0px");
    }
    const action = card.getByRole("link", { name: "Visit Contentsquare (opens in a new tab)" });
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("rel", "noopener noreferrer");
    await expect(action).not.toHaveCSS("color", "rgb(0, 0, 238)");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `artifacts/atlas/popover-kit-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).not.toBeVisible();
  });
}

test("the note folds into a ball on closing, cleans up, and skips motion when requested", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1350, height: 940 });
  const dialog = await inspectFirst(page);
  const note = dialog.locator("[data-inspect-details]");
  await page.clock.install({ time: new Date("2026-09-08T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-08T12:00:00Z"));
  await page.keyboard.press("Escape");
  const mesh = dialog.locator(".book-note-crumple");
  await expect(mesh).toHaveAttribute("aria-hidden", "true");
  await expect(mesh).toHaveAttribute("inert", "");
  await expect(mesh.locator("[id]")).toHaveCount(0);
  await expect(mesh.locator(".book-note-crumple__facet")).toHaveCount(24);
  await page.clock.runFor(320);
  await page.screenshot({ path: "artifacts/atlas/notebook-crumple-mid.png" });
  await page.clock.runFor(280);
  await expect(mesh.locator(".book-note-crumple__core")).toHaveCSS("opacity", "1");
  expect(Number(await mesh.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(
    1,
  );
  await page.screenshot({ path: "artifacts/atlas/notebook-crumple-ball.png" });
  await page.clock.runFor(180);
  await expect(dialog).not.toBeVisible();
  await expect(mesh).toHaveCount(0);
  await expect(note).not.toHaveAttribute("data-crumpling");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("[data-book-open]").first().click();
  await expect(dialog).toBeVisible();
  await expect(note).toHaveCSS("visibility", "visible");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(mesh).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} book turns alongside a steady notebook note and returns to its place`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1350, height: 940 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const dialog = await inspectFirst(page);
    const note = dialog.locator("[data-inspect-details]");
    const rotation = dialog.locator("[data-inspect-rotation]");
    const canvas = dialog.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveCSS("display", "block");
    await expect(dialog).not.toContainText("Drag the book to turn it");
    await expect(dialog.locator("[data-inspect-reset]")).toHaveCount(0);
    const box = await note.boundingBox();
    if (!box) throw new Error("The notebook information must be visible");
    const viewportWidth = mobile ? 390 : 1350;
    expect(box.width).toBeGreaterThan(mobile ? 260 : 400);
    await expect(note).toHaveAttribute("data-surface", "notebook");
    await expect(note).toHaveCSS("transform", "none");
    const bookBox = await rotation.boundingBox();
    if (!bookBox) throw new Error("The book needs its own viewing area");
    expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThan(1);
    expect(Math.abs(bookBox.x + bookBox.width / 2 - viewportWidth / 2)).toBeLessThan(0.1);
    expect(box.y).toBeGreaterThan(bookBox.y + bookBox.height + 8);
    expect(bookBox.y).toBeGreaterThanOrEqual(76);
    expect(bookBox.height).toBeGreaterThan(mobile ? 250 : 380);
    const positions = await note.evaluate((element) =>
      ["[data-inspect-description]", "[data-inspect-facts]"].map(
        (selector) => element.querySelector(selector)?.getBoundingClientRect().left,
      ),
    );
    expect(new Set(positions).size).toBe(1);
    const grid = await note.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const title = element.querySelector("h2");
      if (!title) throw new Error("The note needs its title");
      const line = parseFloat(getComputedStyle(title).lineHeight);
      const paper = getComputedStyle(element, "::before");
      const pitch = parseFloat(paper.backgroundSize);
      const origin = paper.backgroundPosition.split(",")[0]?.split(" ").map(parseFloat);
      const left =
        (element.querySelector("[data-inspect-description]")?.getBoundingClientRect().left ?? 0) -
        element.getBoundingClientRect().left;
      const baselines = [
        ...element.querySelectorAll(
          "h2,p,dt,dd,.book-inspector__category button,[data-inspect-audio]:not([hidden])",
        ),
      ].map((text) => {
        const marker = document.createElement("span");
        marker.style.cssText = "display:inline-block;width:0;height:0";
        text.append(marker);
        const y = marker.getBoundingClientRect().top - top;
        marker.remove();
        return y;
      });
      const rules = [
        ...element.querySelectorAll("[data-popover-header],[data-popover-footer]"),
      ].map((region) => {
        const bounds = region.getBoundingClientRect();
        return (region.hasAttribute("data-popover-header") ? bounds.bottom : bounds.top) - top;
      });
      return {
        line,
        pitch,
        origin,
        left,
        image: paper.backgroundImage,
        marks: [...baselines, ...rules],
      };
    });
    expect(grid.image).toMatch(/^radial-gradient/);
    expect(grid.image).not.toContain("linear-gradient");
    expect(grid.pitch * 2).toBeCloseTo(grid.line, 2);
    expect((grid.origin?.[0] ?? 0) + grid.pitch / 2).toBeCloseTo(grid.left, 1);
    expect((grid.origin?.[1] ?? 0) + grid.pitch / 2).toBeCloseTo(0, 2);
    for (const mark of grid.marks) {
      expect(Math.abs(mark - Math.round(mark / grid.pitch) * grid.pitch)).toBeLessThan(0.2);
    }
    const slide = await dialog.locator(".book-inspector__details-home").evaluate((element) => {
      const animation = element.getAnimations()[0];
      if (!animation?.effect) throw new Error("The note needs its entrance animation");
      animation.pause();
      const timing = animation.effect.getTiming();
      const samples = [0, 0.25, 1].map((progress) => {
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * progress;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
      animation.finish();
      return samples;
    });
    const [start, middle, end] = slide;
    if (!start || !middle || !end) throw new Error("The entrance needs three sampled positions");
    expect(start.y - end.y).toBeGreaterThan(50);
    expect(middle.y).toBeLessThan(start.y);
    expect(middle.y).toBeGreaterThan(end.y);
    for (const position of slide) {
      expect(position.x).toBe(end.x);
      expect(position.width).toBe(end.width);
      expect(position.height).toBe(end.height);
    }
    const before = await canvas.screenshot();
    // Only the object rotates; its caption remains upright in the CSS composition.
    await page.mouse.move(bookBox.x + bookBox.width / 2, bookBox.y + bookBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bookBox.x + bookBox.width / 2 + 65, bookBox.y + bookBox.height / 2 + 12, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    expect(await note.boundingBox()).toEqual(box);
    await page.screenshot({
      path: `artifacts/atlas/notebook-${mobile ? "mobile" : "desktop"}.png`,
    });
    await rotation.focus();
    for (let i = 0; i < 29; i++) {
      // Key presses must reach the focused book in sequence.
      // oxlint-disable-next-line no-await-in-loop
      await page.keyboard.press("ArrowRight");
    }
    await expect(note).toHaveCSS("opacity", "1");
    expect(await note.boundingBox()).toEqual(box);
    await page.keyboard.press("Home");
    await expect(note).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".book-note-crumple")).toHaveCount(0);
    await expect(page.locator("[data-book-open]").first()).toBeFocused();
    await expect(page.locator("[data-book-card][data-picked]")).toHaveCount(0);
    expect(errors).toEqual([]);
    // A mobile inspection disposes its renderer; reopening must still work.
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
    await page.mouse.click(4, 4);
    await expect(dialog).not.toBeVisible();
  });
}

test("a full desktop inspection adapts to mobile and back without losing the book", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 922, height: 859 });
  await page.goto("/bookshelf");
  await page.locator("[data-search-input]").fill("curry guy");
  await page.getByRole("button", { name: "The Curry Guy — Dan Toombs", exact: true }).click();
  const dialog = page.locator("[data-book-inspector]");
  const note = dialog.locator("[data-inspect-details]");
  const book = dialog.locator("[data-inspect-anchor]");
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await expect(note.locator("[data-inspect-description]")).not.toBeEmpty();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const left = await book.boundingBox();
  const right = await note.boundingBox();
  if (!left || !right) throw new Error("The book and its note must both be visible");
  expect(right.y).toBeGreaterThan(left.y + left.height + 20);
  expect(right.x + right.width / 2).toBeCloseTo(left.x + left.width / 2, 1);
  expect(left.y).toBeGreaterThan(70);
  expect(left.y + left.height).toBeLessThan(859 - 70);
  expect(right.y).toBeLessThan(600);
  await page.screenshot({ path: "artifacts/atlas/inspection-centered-curry.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await expect
    .poll(async () => {
      const above = await book.boundingBox();
      const below = await note.boundingBox();
      return above && below ? below.y - above.y - above.height : 0;
    })
    .toBeGreaterThan(8);
  await note.scrollIntoViewIfNeeded();
  await expect(note.getByRole("heading")).toHaveText("The Curry Guy");

  await page.setViewportSize({ width: 922, height: 859 });
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await dialog.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(async () => (await book.boundingBox())?.x).toBeCloseTo(left.x, 1);
  await expect.poll(async () => (await note.boundingBox())?.x).toBeCloseTo(right.x, 1);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("the printed book uses the same desktop composition without motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bookshelf");
  await page.locator("[data-book-open]").first().click();
  const dialog = page.locator("[data-book-inspector]");
  const cover = dialog.locator("[data-inspect-cover]");
  await expect(cover).toBeVisible();
  const book = await cover.boundingBox();
  const note = await dialog.locator("[data-inspect-details]").boundingBox();
  if (!book || !note) throw new Error("The printed inspection must have a book and note");
  expect(note.y).toBeGreaterThan(book.y + book.height);
  expect(note.x + note.width / 2).toBeCloseTo(book.x + book.width / 2, 1);
  expect(book.height).toBeGreaterThan(380);
  expect(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("late metadata never replaces the next book and missing records stay quiet", async ({
  page,
}) => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/bookshelf/details.json", async (route) => {
    await gate;
    await route.fulfill({
      json: [
        {
          title: "12 Rules for Life",
          author: "Jordan B. Peterson",
          description: "Twelve essays about everyday life.",
          sources: [],
        },
      ],
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bookshelf");
  await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
    "data-bookshelf-initialized",
    "true",
  );
  await page.locator("[data-book-open]").first().click();
  await expect(page.locator("[data-inspect-title]")).toHaveText("12 Rules for Life");
  await page.keyboard.press("Escape");
  await page.locator("[data-book-open]").nth(1).click();
  release();
  await expect(page.locator("[data-inspect-title]")).toHaveText("Age Later");
  await expect(page.locator("[data-inspect-extra]")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.locator("[data-book-open]").first().click();
  await expect(page.locator("[data-inspect-description]")).toContainText("Twelve essays");
  await expect(page.locator("[data-inspect-cover]")).toBeVisible();
});

test("failed metadata preserves usable details, and short inspections stay readable", async ({
  page,
}) => {
  await page.route("**/bookshelf/details.json", (route) => route.abort());
  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto("/bookshelf");
  await page.locator("[data-book-open]").first().click();
  const dialog = page.locator("[data-book-inspector]");
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await expect(page.locator("[data-inspect-extra]")).toBeHidden();
  await dialog.evaluate((element) => element.scrollTo(0, 300));
  await expect(page.locator("[data-inspect-title]")).toBeInViewport();
  await page.waitForTimeout(700);
  const note = await page.locator("[data-inspect-details]").boundingBox();
  expect(note?.width).toBeGreaterThan(320);
  await page.screenshot({ path: "artifacts/atlas/notebook-short-window.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("catalogue notes use legible ink annotations and labelled edition details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/bookshelf/details.json", (route) =>
    route.fulfill({
      json: [
        {
          title: "12 Rules for Life",
          author: "Jordan B. Peterson",
          description: "A short catalogue excerpt about this book.",
          categories: ["Psychology", "Philosophy", "Personal growth"],
          firstPublished: "2018",
          publisher: "A publisher with a long descriptive name",
          pages: "448",
          released: "January 2018",
          excerptSource: "https://openlibrary.org/works/OL17837119W",
          sources: ["https://openlibrary.org/works/OL17837119W"],
        },
      ],
    }),
  );
  await page.goto("/bookshelf");
  await page.locator("[data-book-open]").first().click();
  const note = page.locator("[data-inspect-details]");
  const categories = note.getByRole("list", { name: "Categories" });
  await expect(categories.getByRole("listitem")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const inks = await categories.getByRole("listitem").evaluateAll((items) =>
    items.map((item) => ({
      color: getComputedStyle(item.querySelector("button") ?? item).color,
      font: getComputedStyle(item.querySelector("button") ?? item).fontFamily,
      mark: getComputedStyle(item, "::before").maskImage,
    })),
  );
  expect(new Set(inks.map((ink) => ink.color)).size).toBe(3);
  expect(inks.every((ink) => ink.font.startsWith("Caveat") && ink.mark.includes("url("))).toBe(
    true,
  );
  await expect(note.locator("[data-inspect-facts]")).toContainText("Cover edition");
  await expect(note.getByRole("link")).toHaveCount(0);
  await expect(note.locator("[data-inspect-audio]")).toHaveText("Audiobook");
  await expect(note).not.toContainText("Physical");
  await categories.scrollIntoViewIfNeeded();
  expect(await note.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/atlas/reading-note-catalogue-mobile.png" });
  await page.keyboard.press("Escape");
});

for (const largeText of [false, true]) {
  test(`a long title stays readable on a small phone${largeText ? " with doubled text" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    if (largeText) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/bookshelf");
    if (largeText) await page.addStyleTag({ content: "html { font-size: 240% !important; }" });
    await page.locator("[data-search-input]").fill("how to win friends");
    const book = page.locator("[data-book-card]:not([hidden]) [data-book-open]");
    await expect(book).toHaveCount(1);
    await book.click();
    const dialog = page.locator("[data-book-inspector]");
    const note = dialog.locator("[data-inspect-details]");
    await expect(note.locator("[data-inspect-description]")).toContainText("A practical guide");
    if (!largeText) await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
    await dialog.locator(".book-inspector__details-home").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const titleSize = await note
      .locator("h2")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(titleSize).toBeGreaterThanOrEqual(largeText ? 46 : 23);
    const box = await note.boundingBox();
    expect(box?.width).toBe(288);
    expect(await dialog.evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true);
    await note.locator("[data-inspect-categories]").scrollIntoViewIfNeeded();
    await expect(note.locator("[data-inspect-categories]")).toBeInViewport();
    await page.screenshot({
      path: `artifacts/atlas/notebook-long-title${largeText ? "-large-text" : ""}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}
