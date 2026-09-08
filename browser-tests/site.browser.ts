// cspell:ignore networkidle domcontentloaded
import { expect, test, type Page } from "@playwright/test";

const enhancementAsset =
  /portrait-packed|portrait-correspondence|glyph-atlas|prop-support|about-portrait\.[^/]+\.js|signature-dog-mesh|signature-dog-(?:seated|lying|transition|motion)\.[a-f0-9]+\.(?:webp|png)|\/generated\/(?:room-drain-|paper-overscroll)/;

async function room(page: Page, name: "letter" | "bookshelf") {
  await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", name);
  await expect(page.locator("[data-about-rooms]")).not.toHaveAttribute("data-scrub");
  await expect(page.locator(`[data-about-room="${name}"]`)).toBeVisible();
}

for (const [url, name, absent] of [
  ["/", "letter", "bookshelf"],
  ["/bookshelf", "bookshelf", "letter"],
] as const) {
  test(`direct ${url} only renders its active room and waits for intent`, async ({
    page,
    request,
  }) => {
    const assets: string[] = [];
    const violations: string[] = [];
    page.on("request", (entry) => assets.push(entry.url()));
    page.on("console", (message) => {
      if (message.type() === "error") violations.push(message.text());
    });
    const response = await request.get(url);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`data-about-room="${name}"`);
    expect(html).not.toContain(`data-about-room="${absent}"`);
    await page.goto(url);
    await room(page, name);
    await page.waitForLoadState("networkidle");
    expect(assets.filter((asset) => enhancementAsset.test(asset))).toEqual([]);
    const inactiveAsset =
      name === "letter"
        ? /\/bookshelf(?:\/|$)|\/generated\/bookshelf\//
        : /\/poster\.|\/generated\/(?:portrait-|signature-)|\/about-portrait-loader\./;
    expect(assets.filter((asset) => inactiveAsset.test(asset))).toEqual([]);
    expect(violations).toEqual([]);
    expect(response.headers()["content-security-policy"]).toContain("default-src");
  });
}

test("rooms load on demand, preserve search, and reuse the fetched room", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/bookshelf") requests.push(request.resourceType());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await room(page, "bookshelf");
  await expect(page).toHaveURL(/\/bookshelf$/);
  const input = page.locator("[data-search-input]");
  await input.fill("foundation");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(1);
  await expect(page.locator("[data-book-card]:not([hidden]) .atlas-book__caption")).toContainText(
    "Foundation",
  );
  await page.getByRole("link", { name: "About", exact: true }).click();
  await room(page, "letter");
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await room(page, "bookshelf");
  await expect(input).toHaveValue("foundation");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(1);
  expect(requests).toHaveLength(1);
});

test("direct bookshelf can load the letter and reverse an in-flight room request", async ({
  page,
}) => {
  await page.goto("/bookshelf");
  await page.route("/", async (route) => {
    if (route.request().resourceType() === "fetch") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "About", exact: true }).click();
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await room(page, "bookshelf");
  await page.getByRole("link", { name: "About", exact: true }).click();
  await room(page, "letter");
  await expect(page).toHaveURL(/\/$/);
});

test("a failed room fetch falls back to its native public route", async ({ page }) => {
  await page.goto("/");
  let nativeNavigations = 0;
  await page.route("**/bookshelf", async (route) => {
    if (route.request().isNavigationRequest()) {
      nativeNavigations += 1;
      await route.continue();
    } else {
      await route.abort("failed");
    }
  });
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await room(page, "bookshelf");
  expect(nativeNavigations).toBe(1);
});

test("search retains server order through author, empty, and clear states", async ({ page }) => {
  await page.goto("/bookshelf");
  const cards = page.locator("[data-book-card]");
  const before = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-book-id")),
  );
  const input = page.locator("[data-search-input]");
  await input.fill("Jordan B. Peterson");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(3);
  await input.fill("no-such-title-123");
  await expect(page.locator("[data-empty-state]")).toBeVisible();
  await page.locator("[data-empty-reset]").click();
  await expect(input).toHaveValue("");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(before.length);
  expect(
    await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-book-id")),
    ),
  ).toEqual(before);
});

test("the poster and letter remain available when fonts are delayed", async ({ page }) => {
  const { promise: released, resolve: releaseFonts } = Promise.withResolvers<void>();
  await page.route("**/*.woff2", async (route) => {
    await released;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".about-passage")).toBeVisible();
    await expect(page.locator(".about-passage__sentence").first()).toHaveCSS("opacity", "1");
    await expect(page.locator(".about-portrait__poster")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".about-portrait__poster")
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  } finally {
    releaseFonts();
  }
});

for (const preference of ["reduced", "save-data"] as const) {
  test(`${preference} keeps the complete static portrait even after intent`, async ({ page }) => {
    const assets: string[] = [];
    page.on("request", (request) => assets.push(request.url()));
    if (preference === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    else
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "connection", {
          value: Object.assign(new EventTarget(), { saveData: true }),
        });
      });
    await page.goto("/");
    await page.locator(".about-portrait").hover();
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    expect(assets.filter((asset) => enhancementAsset.test(asset))).toEqual([]);
    await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "1");
  });
}

test("unavailable WebGL keeps the poster after a portrait interaction", async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line typescript/unbound-method -- The stub forwards the calling canvas through Function.call.
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(
        this: HTMLCanvasElement,
        contextId: string,
        options?: CanvasRenderingContext2DSettings | WebGLContextAttributes,
      ) {
        if (contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl")
          return null;
        return original.call(this, contextId, options);
      },
    });
  });
  await page.goto("/");
  await page.locator(".about-portrait").focus();
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-about-portrait]")).toBeVisible();
  await expect(page.locator("[data-about-portrait]")).not.toHaveAttribute(
    "data-motion-ready",
    "true",
  );
});

test("settled pages have no recurring animation-frame work before intent", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        const root = document.documentElement;
        root.dataset.testAnimationFrames = String(
          Number(root.dataset.testAnimationFrames ?? 0) + 1,
        );
        callback(time);
      });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // A bounded observation window catches recurring frame loops without changing application state.
  const count = await page.evaluate(async () => {
    const start = Number(document.documentElement.dataset.testAnimationFrames ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return Number(document.documentElement.dataset.testAnimationFrames ?? 0) - start;
  });
  expect(count).toBe(0);
});

test("mobile cover geometry survives image decode and content stays within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 823 });
  const { promise: released, resolve: releaseCovers } = Promise.withResolvers<void>();
  await page.route("**/bookshelf/covers/**", async (route) => {
    await released;
    await route.continue();
  });
  try {
    await page.goto("/bookshelf", { waitUntil: "domcontentloaded" });
    const first = page.locator(".book__volume").first();
    const before = await first.boundingBox();
    expect(before).not.toBeNull();
    releaseCovers();
    await page.waitForLoadState("networkidle");
    const after = await first.boundingBox();
    expect(after).not.toBeNull();
    if (!before || !after) throw new Error("The first book needs a reserved SSR box");
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    releaseCovers();
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("both public rooms and their navigation remain usable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".about-passage")).toBeVisible();
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    expect(await page.locator("[data-book-card]").count()).toBeGreaterThan(0);
    await expect(page.locator("[data-book-card]").first()).toBeVisible();
    await page.getByRole("link", { name: "About", exact: true }).click();
    await expect(page.locator(".about-portrait__poster")).toBeVisible();
  });
});
