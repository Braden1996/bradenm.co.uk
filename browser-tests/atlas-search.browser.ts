import { expect, test, type Page } from "@playwright/test";
const atlasSelector = "[data-atlas]";
const visibleSelector = "[data-book-card]:not([hidden])";
async function settled(page: Page) {
  await expect(page.locator(atlasSelector)).not.toHaveAttribute("data-atlas-arranging");
}
async function centers(page: Page) {
  return page.locator(`${visibleSelector} [data-book-open]`).evaluateAll((buttons) =>
    buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }),
  );
}

test("focus gathers the live table into rows and an empty blur restores the scatter", async ({
  page,
}) => {
  await page.goto("/bookshelf");
  const atlas = page.locator(atlasSelector);
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  const original = await centers(page);
  await page.locator("[data-search-input]").focus();
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "rows");
  await expect(atlas).toHaveAttribute("data-atlas-arranging", "true");
  await settled(page);
  const rows = await centers(page);
  expect(rows[0]?.y).toBeCloseTo(rows[1]?.y ?? -1, 1);
  expect(rows[0]?.y).toBeCloseTo(rows[2]?.y ?? -1, 1);
  expect(rows).not.toEqual(original);
  await page.screenshot({ path: "artifacts/atlas/search-focused.png" });
  await page.locator("[data-search-input]").blur();
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "scattered");
  await settled(page);
  const restored = await centers(page);
  for (const [index, point] of restored.entries()) {
    expect(point.x).toBeCloseTo(original[index]?.x ?? -1, 1);
    expect(point.y).toBeCloseTo(original[index]?.y ?? -1, 1);
  }
  const frames = await atlas.getAttribute("data-atlas-frames");
  await page.waitForTimeout(350);
  expect(await atlas.getAttribute("data-atlas-frames")).toBe(frames);
});

test("rapid queries keep relevance order through inspection, clear and keyboard navigation", async ({
  page,
}) => {
  await page.goto("/bookshelf");
  const atlas = page.locator(atlasSelector);
  const search = page.locator("[data-search-input]");
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await search.fill("wo");
  await search.fill("world");
  await expect(page.locator(visibleSelector)).toHaveCount(9);
  await settled(page);
  await expect
    .poll(async () => Number(await atlas.getAttribute("data-atlas-textures")))
    .toBeGreaterThan(1);
  const first = page.locator(`${visibleSelector} [data-book-open]`).first();
  await expect(first).toHaveAccessibleName(/^The World: A Family History/);
  await page.screenshot({ path: "artifacts/atlas/search-ranked.png" });
  await first.click();
  await expect(page.locator("[data-book-inspector]")).toBeVisible();
  await expect(page.locator("[data-inspect-title]")).toHaveText("The World: A Family History");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
  await expect(first).toBeFocused();
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "rows");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`${visibleSelector} [data-book-open]`).nth(1)).toBeFocused();
  await search.fill("");
  await expect(page.locator(visibleSelector)).toHaveCount(165);
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "rows");
  await search.fill("not-a-book-923784");
  await expect(page.locator(visibleSelector)).toHaveCount(0);
  await search.fill("world");
  await expect(page.locator(visibleSelector)).toHaveCount(9);
  await settled(page);
  expect(errors).toEqual([]);
});

test("a book picked up mid-transition returns safely before the layout continues", async ({
  page,
}) => {
  await page.goto("/bookshelf");
  const atlas = page.locator(atlasSelector);
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  await page.locator("[data-search-input]").focus();
  await expect(atlas).toHaveAttribute("data-atlas-arranging", "true");
  const book = page.locator("[data-book-open]").nth(20);
  await book.dispatchEvent("click");
  const dialog = page.locator("[data-book-inspector]");
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(book).toBeFocused();
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "scattered");
  await settled(page);
  await expect(atlas).toHaveAttribute("data-atlas-models", "165");
  await expect(page.locator("[data-book-card][data-picked]")).toHaveCount(0);
  await expect(book).toBeInViewport();
});

test("reduced motion ranks the printed books immediately and preserves the mobile grid", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bookshelf");
  const atlas = page.locator(atlasSelector);
  await page.locator("[data-search-input]").fill("world");
  await expect(page.locator(visibleSelector)).toHaveCount(9);
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "rows");
  await settled(page);
  await expect(atlas).not.toHaveAttribute("data-atlas-ready");
  await expect(page.locator(`${visibleSelector} [data-book-open]`).first()).toHaveAccessibleName(
    /^The World: A Family History/,
  );
  await page.screenshot({ path: "artifacts/atlas/search-printed.png" });
  await page.locator("[data-search-input]").fill("");
  await page.locator("[data-atlas-scroll]").focus();
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "scattered");
  await page.keyboard.press("+");
  await expect(atlas).toHaveAttribute("data-atlas-arrangement", "scattered");
  await expect
    .poll(async () => Number(await atlas.getAttribute("data-atlas-zoom")))
    .toBeGreaterThan(1);
  await page.locator("[data-search-input]").fill("world");
  await expect(page.locator(visibleSelector)).toHaveCount(9);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(atlas).toHaveAttribute("data-atlas-mode", "grid");
  await expect(page.locator("[data-book-grid]")).toHaveCSS("display", "grid");
  await page.screenshot({ path: "artifacts/atlas/search-mobile.png" });
  await page.locator(`${visibleSelector} [data-book-open]`).first().click();
  await expect(page.locator("[data-book-inspector]")).toBeVisible();
});
