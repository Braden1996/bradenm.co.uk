// cspell:ignore networkidle
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function ready(page: Page) {
  await page.goto("/bookshelf");
  await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
    "data-bookshelf-initialized",
    "true",
  );
}

function rendererRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/atlas-renderer|\/bookshelf\/atlas\/covers\./.test(request.url()))
      requests.push(request.url());
  });
  return requests;
}

test("an untouched desktop keeps the printed table without loading its renderer", async ({
  page,
}) => {
  const requests = rendererRequests(page);
  await ready(page);
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 1340, height: 930 });
  await page.evaluate(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(requests).toEqual([]);
  await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-ready");
  await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
  await expect(page.locator(".atlas-book__preview").first()).toBeVisible();
  await expect(page.locator("[data-book-open]")).toHaveCount(165);
});

for (const intent of ["pointer", "keyboard"] as const) {
  test(`${intent} intent prepares 3D while keeping the printed table unchanged`, async ({
    page,
  }, testInfo) => {
    const requests = rendererRequests(page);
    await ready(page);
    const stage = page.locator("[data-atlas-stage]");
    const atlas = page.locator("[data-atlas]");
    await page.evaluate(() => document.fonts.ready);
    const geometry = await stage.boundingBox();
    expect(requests).toEqual([]);
    const pending = Promise.withResolvers<void>();
    if (intent === "keyboard") {
      await page.route(/atlas-renderer[^?]*\.(?:js|ts)(?:\?|$)/, async (route) => {
        await pending.promise;
        await route.continue();
      });
    }
    // Keep keyboard focus identical across captures. The screenshot-only veil
    // style removes the unrelated fixed header's backdrop recomposition while
    // preserving its footprint and every underlying printed stage pixel.
    const style =
      intent === "keyboard" ? ".about-template__veil { visibility: hidden !important; }" : "";
    try {
      if (intent === "keyboard") {
        await page.locator("[data-atlas-scroll]").focus();
        await expect(atlas).not.toHaveAttribute("data-atlas-ready");
      }
      // Exclude finite page animations from the printed-view comparison.
      const before = await stage.screenshot({
        animations: "disabled",
        style,
        path: testInfo.outputPath("before.png"),
      });
      if (intent === "pointer") {
        if (!geometry) throw new Error("The printed table must have its reserved geometry");
        await page.mouse.move(geometry.x + 4, geometry.y + 4);
      }
      pending.resolve();
      await expect(atlas).toHaveAttribute("data-atlas-ready", "true", { timeout: 25_000 });
      await expect(atlas).not.toHaveAttribute("data-atlas-engaged");
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
      expect(await stage.boundingBox()).toEqual(geometry);
      if (intent === "keyboard") await expect(page.locator("[data-atlas-scroll]")).toBeFocused();
      const after = await stage.screenshot({
        animations: "disabled",
        style,
        path: testInfo.outputPath("after.png"),
      });
      try {
        if (intent === "keyboard") {
          const [previous, current] = await Promise.all(
            [before, after].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })),
          );
          if (!previous || !current) throw new Error("Both printed frames must be available");
          expect(current.info).toEqual(previous.info);
          const difference = previous.data.reduce(
            (maximum, channel, index) =>
              Math.max(maximum, Math.abs(channel - (current.data[index] ?? 0))),
            0,
          );
          // Software compositing can still round isolated channels by one level.
          // Retain the two-level limit across every pixel, without a changed-pixel quota.
          expect(difference).toBeLessThanOrEqual(2);
        } else expect(after.equals(before)).toBe(true);
      } catch (error) {
        await testInfo.attach("printed-before", { body: before, contentType: "image/png" });
        await testInfo.attach("printed-after", { body: after, contentType: "image/png" });
        throw error;
      }
      expect(requests.some((url) => /atlas-renderer/.test(url))).toBe(true);
    } finally {
      pending.resolve();
      if (intent === "keyboard") await page.locator("[data-atlas-scroll]").blur();
    }
  });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "mobile pickup" : "desktop pickup", () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1350, height: 940 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test("a direct selection opens immediately and upgrades when 3D arrives", async ({ page }) => {
      const requests = rendererRequests(page);
      const pending = Promise.withResolvers<void>();
      await page.route(/atlas-renderer[^?]*\.(?:js|ts)(?:\?|$)/, async (route) => {
        await pending.promise;
        await route.continue();
      });
      try {
        await ready(page);
        expect(requests).toEqual([]);
        // Activate directly so neither pointer entry nor focus can prewarm 3D.
        await page
          .locator("[data-book-open]")
          .first()
          .evaluate((button: HTMLButtonElement) => button.click());
        const dialog = page.locator("[data-book-inspector]");
        await expect(dialog).toBeVisible();
        await expect(page.locator("[data-inspect-title]")).toHaveText("12 Rules for Life");
        await expect(dialog).not.toHaveAttribute("data-inspector-ready");
        pending.resolve();
        await expect(dialog).toHaveAttribute("data-inspector-ready", "true", { timeout: 25_000 });
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(page.locator("[data-book-open]").first()).toBeFocused();
        await expect(page.locator("[data-atlas-stage] [data-atlas-canvas]")).toHaveCount(1);
      } finally {
        pending.resolve();
      }
    });
  });
}
