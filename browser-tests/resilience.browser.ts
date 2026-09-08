// cspell:ignore networkidle domcontentloaded
import { expect, test, type Page } from "@playwright/test";

async function settledRoom(page: Page, room: "letter" | "bookshelf") {
  const stage = page.locator("[data-about-rooms]");
  await expect(stage).toHaveAttribute("data-room", room);
  await expect(stage).not.toHaveAttribute("data-scrub");
  await expect(stage).not.toHaveAttribute("aria-busy");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test("a lost portrait context returns to the complete accessible print", async ({ page }) => {
  await page.goto("/");
  const portrait = page.locator(".about-portrait");
  // The SSR image becomes keyboard-interactive only when its intent handlers are mounted.
  await expect(portrait).toHaveAttribute("role", "button");
  await portrait.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-about-portrait]")).toHaveAttribute("data-motion-ready", "true");
  await page.waitForLoadState("networkidle");
  await page.locator("[data-about-portrait-canvas]").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("webgl2");
    const extension: WEBGL_lose_context | null | undefined =
      context?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("The browser must support simulating WebGL context loss");
    extension.loseContext();
  });
  await expect(portrait).toHaveAttribute("data-enhancement-unavailable");
  await expect(portrait).toHaveAttribute("role", "img");
  await expect(portrait).not.toHaveAttribute("tabindex");
  await expect(page.locator("[data-about-portrait]")).not.toHaveAttribute("data-motion-ready");
  await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "1");
  await expect(page.locator(".about-portrait video")).toHaveCount(0);
  await portrait.hover();
  await expect(page.locator("[data-about-portrait]")).not.toHaveAttribute("data-motion-ready");
});

test.describe("native touch scrolling", () => {
  test.use({ viewport: { width: 390, height: 667 }, hasTouch: true, isMobile: true });

  test("a vertical gesture over the portrait scrolls without acquiring its effects", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const portrait = page.locator(".about-portrait");
    const bounds = await portrait.boundingBox();
    if (!bounds) throw new Error("The first portrait must have a reserved visible box");
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(Math.min(bounds.y + bounds.height - 20, 550));
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      // A native gesture must deliver ordered points with a paint between them.
      /* eslint-disable no-await-in-loop */
      for (const distance of [30, 70, 120]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - distance }],
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      /* eslint-enable no-await-in-loop */
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.waitForLoadState("networkidle");
      await expect(portrait).not.toHaveAttribute("data-enhancement-requested");
      expect(
        requests.filter((url) =>
          /portrait-packed|portrait-correspondence|glyph-atlas|prop-support|about-portrait\.[^/]+\.js/.test(
            url,
          ),
        ),
      ).toEqual([]);
    } finally {
      await session.detach();
    }
  });
});

test("cached room switches keep listener and scrollbar counts stable", async ({ page }) => {
  await page.goto("/");
  const session = await page.context().newCDPSession(page);
  const switchTo = async (room: "letter" | "bookshelf") => {
    await page
      .getByRole("link", { name: room === "letter" ? "About" : "Bookshelf", exact: true })
      .click();
    await settledRoom(page, room);
  };
  const snapshot = async () => {
    await session.send("HeapProfiler.collectGarbage");
    const counters = await session.send("Memory.getDOMCounters");
    return {
      listeners: counters.jsEventListeners,
      scrollbars: await page.locator("[data-overlay-scrollbar]").count(),
      rooms: await page.locator("[data-about-room]").count(),
    };
  };
  try {
    // Both rooms retain feature controllers; warm those once before measuring reuse.
    await switchTo("bookshelf");
    await switchTo("letter");
    await switchTo("bookshelf");
    const shelfBaseline = await snapshot();
    await switchTo("letter");
    const letterBaseline = await snapshot();
    // Each snapshot measures the settled room produced by the preceding transition.
    /* eslint-disable no-await-in-loop */
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await switchTo("bookshelf");
      const shelf = await snapshot();
      expect(shelf.listeners).toBeLessThanOrEqual(shelfBaseline.listeners);
      expect(shelf.scrollbars).toBe(shelfBaseline.scrollbars);
      expect(shelf.rooms).toBe(shelfBaseline.rooms);
      await switchTo("letter");
      const letter = await snapshot();
      expect(letter.listeners).toBeLessThanOrEqual(letterBaseline.listeners);
      expect(letter.scrollbars).toBe(letterBaseline.scrollbars);
      expect(letter.rooms).toBe(letterBaseline.rooms);
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    await session.detach();
  }
});

for (const scenario of [
  { name: "small phone", width: 390, height: 667, ratio: 3 },
  { name: "below the layout breakpoint", width: 999, height: 800, ratio: 2 },
  { name: "short desktop at the breakpoint", width: 1000, height: 650, ratio: 1 },
  { name: "tall desktop", width: 1350, height: 1100, ratio: 1 },
]) {
  test.describe(scenario.name, () => {
    test.use({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: scenario.ratio,
    });

    test("blocked scripts and delayed fonts preserve readable, stable first paint", async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        let total = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if ("value" in entry && "hadRecentInput" in entry && !entry.hadRecentInput) {
              total += Number(entry.value);
            }
          }
          document.documentElement.dataset.testLayoutShift = String(total);
        });
        observer.observe({ type: "layout-shift", buffered: true });
      });
      const { promise: released, resolve: releaseFonts } = Promise.withResolvers<void>();
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() === "script") {
          await route.abort();
          return;
        }
        if (route.request().resourceType() === "font") await released;
        await route.continue();
      });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator(".about-passage__sentence").first()).toHaveCSS("opacity", "1");
        await expect(page.locator(".signature__art")).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator(".about-portrait__poster")
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        const before = await page.locator(".signature__art").boundingBox();
        if (!before) throw new Error("The server-rendered signature must reserve its box");
        await expect(page.locator(".about-portrait")).toHaveAttribute("role", "img");
        // Playwright's screenshot waits for fonts.ready, which is deliberately
        // pending here. Capture the rendered surface without waiting for fonts.
        const capture = await page.context().newCDPSession(page);
        try {
          const screenshot = await capture.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
            fromSurface: true,
          });
          await testInfo.attach("initial-print-with-fonts-blocked", {
            body: Buffer.from(screenshot.data, "base64"),
            contentType: "image/png",
          });
        } finally {
          await capture.detach();
        }
        releaseFonts();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const after = await page.locator(".signature__art").boundingBox();
        if (!after) throw new Error("The signature must remain complete after fonts load");
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
        expect(
          await page.evaluate(() => Number(document.documentElement.dataset.testLayoutShift ?? 0)),
        ).toBeLessThanOrEqual(0.02);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true);
        await testInfo.attach("print-after-font-substitution", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      } finally {
        releaseFonts();
      }
    });
  });
}
