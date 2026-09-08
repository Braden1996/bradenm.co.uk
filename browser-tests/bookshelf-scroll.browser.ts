// cspell:ignore domcontentloaded networkidle
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/bookshelf");
  await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
    "data-bookshelf-initialized",
    "true",
  );
}
async function zoomIntoAtlas(page: Page) {
  await page.mouse.move(650, 420);
  await page.mouse.wheel(0, -450);
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);
}
async function zoomLevel(page: Page) {
  return Number(await page.locator("[data-atlas]").getAttribute("data-atlas-zoom"));
}

test("desktop table stays fixed near the wash, while mobile and the letter still scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1350, height: 940 });
  await ready(page);
  const wrap = page.locator(".page-wrap");
  await expect(wrap).toHaveCSS("overflow-y", "clip");
  await page.getByRole("link", { name: "About", exact: true }).hover();
  await page.mouse.wheel(0, 500);
  await wrap.evaluate((element) => element.scrollTo(0, 500));
  await page.locator("[data-atlas-scroll]").focus();
  await page.keyboard.press("PageDown");
  expect(await wrap.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator(".panel-shell")).toHaveCSS("transform", "none");
  const positions = await page.locator("[data-book-open]").evaluateAll((books) => {
    const boxes = books.map((book) => book.getBoundingClientRect());
    return {
      bottom: Math.max(...boxes.map((box) => box.bottom)),
      top: Math.min(...boxes.map((box) => box.top)),
      headerBottom:
        document.querySelector(".about-template__letterhead")?.getBoundingClientRect().bottom ?? 0,
      height: innerHeight,
    };
  });
  expect(positions.height - positions.bottom).toBeLessThan(60);
  expect(positions.height - positions.bottom).toBeGreaterThan(0);
  expect(positions.top).toBeGreaterThan(positions.headerBottom);
  expect(positions.top - positions.headerBottom).toBeLessThan(50);
  await page.screenshot({ path: "artifacts/atlas/fixed-desktop.png" });
  await page.setViewportSize({ width: 1100, height: 400 });
  await expect(wrap).toHaveCSS("overflow-y", "clip");
  await expect(page.locator("[data-book-open]").last()).toBeInViewport();
  await page.screenshot({ path: "artifacts/atlas/fixed-short-desktop.png" });
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(wrap).toHaveCSS("overflow-y", "auto");
  await wrap.evaluate((element) => element.scrollTo(0, 200));
  await expect.poll(() => wrap.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await expect(wrap).toHaveCSS("overflow-y", "clip");
  expect(await wrap.evaluate((element) => element.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(wrap).toHaveCSS("overflow-y", "visible");
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});
for (const { name, viewport } of [
  { name: "desktop", viewport: { width: 1350, height: 940 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
  { name: "short landscape", viewport: { width: 740, height: 320 } },
]) {
  test(`${name} reaches every book by keyboard without shifting the header`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    const scroller = page.locator("[data-atlas-scroll]");
    const books = page.locator("[data-book-open]");
    const header = await page.locator(".about-template__letterhead").boundingBox();
    await scroller.hover({ position: { x: viewport.width / 2, y: 100 } });
    if (viewport.width > 760) {
      await page.mouse.wheel(0, -150);
      await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);
    }
    await books.first().focus();
    await page.keyboard.press("End");
    await expect(books.last()).toBeFocused();
    await expect(books.last()).toBeInViewport();
    await expect(page.locator("[data-atlas-range]")).toHaveCount(0);
    const after = await page.locator(".about-template__letterhead").boundingBox();
    expect(Math.abs((after?.y ?? 0) - (header?.y ?? 0))).toBeLessThanOrEqual(1);
    await page.keyboard.press("Home");
    await expect(books.first()).toBeFocused();
    await expect(books.first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`${name} filters the atlas and restores its order`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    const cards = page.locator("[data-book-card]:not([hidden])");
    const original = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-book-id")),
    );
    if (viewport.width > 760) await zoomIntoAtlas(page);
    const input = page.locator("[data-search-input]");
    await input.fill("foundation");
    await expect(cards).toHaveCount(1);
    if (viewport.width > 760) await expect.poll(() => zoomLevel(page)).toBe(1);
    await expect(cards.first()).toBeInViewport();
    await input.fill("not-in-this-library-123");
    await expect(cards).toHaveCount(0);
    await expect(page.locator("[data-empty-state]")).toBeVisible();
    await page.locator("[data-empty-reset]").click();
    await expect(cards).toHaveCount(original.length);
    expect(
      await cards.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-book-id")),
      ),
    ).toEqual(original);
  });
}

test("dragging a book pans the table without picking it up", async ({ page }) => {
  await ready(page);
  const atlas = page.locator("[data-atlas]");
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  await zoomIntoAtlas(page);
  const book = page.locator("[data-book-open]").nth(82);
  await book.focus();
  const before = Number(await atlas.getAttribute("data-atlas-pan-x"));
  const bounds = await book.boundingBox();
  if (!bounds) throw new Error("Dragging needs a visible book");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 180, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => before - Number(await atlas.getAttribute("data-atlas-pan-x")))
    .toBeGreaterThan(100);
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
});

test("pickup, rotation and return preserve the selected book and browsing position", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  await zoomIntoAtlas(page);
  const before = await zoomLevel(page);
  const visible = page.locator("[data-book-open]");
  const index = await visible.evaluateAll((elements) =>
    elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 30 &&
        rect.right < innerWidth - 30 &&
        rect.top > 150 &&
        rect.bottom < innerHeight - 100
      );
    }),
  );
  const label = await visible.nth(index).getAttribute("aria-label");
  if (!label) throw new Error("A visible book must have its accessible title and author");
  const book = page.getByRole("button", { name: label, exact: true });
  await book.hover();
  await page.waitForTimeout(300);
  await book.click();
  const dialog = page.locator("[data-book-inspector]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await expect(page.locator("[data-inspect-title]")).toHaveText(label.split(" — ")[0] ?? "");
  await page.waitForTimeout(700);
  await page.locator("[data-inspect-rotation]").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(book).toBeFocused();
  expect(await zoomLevel(page)).toBeCloseTo(before, 0);
  await expect(page.locator("[data-book-card][data-picked]")).toHaveCount(0);
});

test("cached room changes suspend the atlas and reset its position", async ({ page }) => {
  await ready(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  await zoomIntoAtlas(page);
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "letter");
  const frames = await page.locator("[data-atlas]").getAttribute("data-atlas-frames");
  await page.waitForTimeout(300);
  expect(await page.locator("[data-atlas]").getAttribute("data-atlas-frames")).toBe(frames);
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "bookshelf");
  await expect.poll(() => zoomLevel(page)).toBe(1);
  await expect(page.locator("[data-book-open]").first()).toBeInViewport();
});

test("a lost WebGL context keeps the printed atlas and book details usable", async ({ page }) => {
  await ready(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  await page.locator("[data-atlas-canvas]").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-unavailable", "true");
  await expect(page.locator(".atlas-book__preview").first()).toBeVisible();
  await page.locator("[data-book-open]").first().click();
  await expect(page.locator("[data-book-inspector]")).toBeVisible();
  await expect(page.locator("[data-inspect-title]")).not.toHaveText("");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
});

test.describe("static atlas", () => {
  test.use({ reducedMotion: "reduce" });
  test("reduced motion retains the table and immediate book inspection without 3D downloads", async ({
    page,
  }) => {
    const assets: string[] = [];
    page.on("request", (request) => {
      if (/atlas-renderer.*\.js/.test(request.url())) assets.push(request.url());
    });
    await ready(page);
    await expect(page.locator(".atlas-book__preview").first()).toBeVisible();
    await page.locator("[data-book-open]").first().click();
    await expect(page.locator("[data-book-inspector]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
    expect(assets).toEqual([]);
  });
});

test.describe("atlas without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("all books are present and native details still open", async ({ page }) => {
    await page.goto("/bookshelf");
    await expect(page.locator("[data-book-open]")).toHaveCount(165);
    await page.locator("[data-book-open]").first().click();
    await expect(page.locator(".atlas-book__fallback:popover-open")).toBeVisible();
    await expect(page.locator(".atlas-book__fallback:popover-open")).toContainText(
      "12 Rules for Life",
    );
  });
});

test("delayed covers preserve previews and an early selection can close before 3D arrives", async ({
  page,
}) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route("**/bookshelf/atlas/covers.*", async (route) => {
    await promise;
    await route.continue();
  });
  try {
    await ready(page);
    await expect(page.locator(".atlas-book__preview").first()).toBeVisible();
    await page.locator("[data-book-open]").first().click();
    await expect(page.locator("[data-inspect-title]")).toHaveText("12 Rules for Life");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
    resolve();
    await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
    await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
    await expect(page.locator("[data-atlas-stage] [data-atlas-canvas]")).toHaveCount(1);
  } finally {
    resolve();
  }
});

test("failed inspection textures retain the browsing cover and usable details", async ({
  page,
}) => {
  await page.route("**/bookshelf/covers/**", (route) => route.abort());
  await ready(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  await page.locator("[data-book-open]").first().click();
  await expect(page.locator("[data-inspect-title]")).toHaveText("12 Rules for Life");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
});

test("hidden tabs stop drawing and resume the selected atlas position", async ({ page }) => {
  await ready(page);
  const atlas = page.locator("[data-atlas]");
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  await zoomIntoAtlas(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const frames = await atlas.getAttribute("data-atlas-frames");
  await page.waitForTimeout(300);
  expect(await atlas.getAttribute("data-atlas-frames")).toBe(frames);
  const before = await zoomLevel(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  expect(await zoomLevel(page)).toBe(before);
});

test("Save-Data keeps the complete atlas without acquiring Three.js", async ({ page }) => {
  const assets: string[] = [];
  page.on("request", (request) => {
    if (/atlas-renderer.*\.js/.test(request.url())) assets.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      value: Object.assign(new EventTarget(), { saveData: true }),
    });
  });
  await ready(page);
  await page.locator("[data-book-open]").first().click();
  await expect(page.locator("[data-book-inspector]")).toBeVisible();
  expect(assets).toEqual([]);
  await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-ready");
});

test("hiding the tab during return settles the modal and allows another pickup", async ({
  page,
}) => {
  await ready(page);
  const atlas = page.locator("[data-atlas]");
  const dialog = page.locator("[data-book-inspector]");
  const book = page.locator("[data-book-open]").nth(60);
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  await book.click();
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await book.click();
  await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[data-atlas-stage] [data-atlas-canvas]")).toHaveCount(1);
  await expect(page.locator("[data-book-card][data-picked]")).toHaveCount(0);
});

test("a failed base sheet leaves a complete preview that supports zoom and immediate details", async ({
  page,
}) => {
  await page.route("**/bookshelf/atlas/covers.*", (route) => route.abort());
  await ready(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-unavailable", "true");
  await page.mouse.move(650, 440);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);
  const book = page.locator("[data-book-open]").nth(82);
  await book.click();
  await expect(page.locator("[data-inspect-title]")).toHaveText("London for Dogs");
  await page.keyboard.press("Escape");
  await expect(book).toBeFocused();
});

test("late inspection textures cannot reopen a dismissed book or replace the next book", async ({
  page,
}) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route("**/bookshelf/covers/**", async (route) => {
    await promise;
    await route.continue();
  });
  try {
    await page.goto("/bookshelf", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
    const books = page.locator("[data-book-open]");
    const dialog = page.locator("[data-book-inspector]");
    await books.first().click();
    await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await books.nth(1).click();
    await expect(dialog).toHaveAttribute("data-inspector-ready", "true");
    resolve();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-inspect-title]")).toHaveText("Age Later");
    await expect(page.locator("[data-book-card][data-picked]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(books.nth(1)).toBeFocused();
  } finally {
    resolve();
  }
});
