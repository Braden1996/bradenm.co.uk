// cspell:ignore networkidle
import { expect, test } from "@playwright/test";

const enhancementAsset =
  /portrait-packed|portrait-correspondence|glyph-atlas|prop-support|about-portrait\.[^/]+\.js|signature-dog-(?:seated|lying|transition|motion)\.[a-f0-9]+\.(?:webp|png)/;

for (const route of ["/", "/bookshelf"] as const) {
  test(`doubled root font size keeps ${route} readable within a narrow viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((rootFontSize: string) => {
      const resizeType = () => {
        if (!document.documentElement) return false;
        // The site's normal root is 1.2em against the browser's initial 16px.
        // At the root, 2.4rem resolves to 38.4px: doubled type, not browser zoom.
        document.documentElement.style.setProperty("--font-size-root", rootFontSize);
        return true;
      };
      if (!resizeType()) {
        const observer = new MutationObserver(() => {
          if (resizeType()) observer.disconnect();
        });
        observer.observe(document, { childList: true });
      }
    }, "2.4rem");
    await page.goto(route);
    await expect(page.locator("html")).toHaveCSS("font-size", "38.4px");
    const navigation = page.getByRole("navigation", { name: "Site", exact: true });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole("link", { name: "About", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookshelf", exact: true })).toBeVisible();
    const content =
      route === "/" ? page.locator(".about-passage") : page.locator(".book__volume").first();
    await expect(content).toBeVisible();
    await content.scrollIntoViewIfNeeded();
    await expect(content).toBeInViewport();
    if (route === "/") {
      await expect(content).toContainText("Hello internet");
      await expect(page.locator(".about-passage__sentence").first()).toHaveCSS("opacity", "1");
    } else {
      await expect(page.locator("[data-book-card] .atlas-book__caption").first()).not.toHaveText(
        "",
      );
      const input = page.locator("[data-search-input]");
      await input.fill("foundation");
      await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(1);
      await input.fill("");
      await expect(content).toBeVisible();
    }
    const bounds = await content.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Reading content must retain its layout box");
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const next = page.getByRole("link", {
      name: route === "/" ? "Bookshelf" : "About",
      exact: true,
    });
    await next.focus();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute(
      "data-room",
      route === "/" ? "bookshelf" : "letter",
    );
  });

  test(`a warm reload of ${route} reuses hashed assets and keeps enhancement deferred`, async ({
    page,
  }, testInfo) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const readAssets = () =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter(
            (entry): entry is PerformanceResourceTiming =>
              entry instanceof PerformanceResourceTiming &&
              /\/(?:_astro|generated|bookshelf\/(?:covers|atlas))\//.test(
                new URL(entry.name).pathname,
              ),
          )
          .map(({ name, transferSize, encodedBodySize, decodedBodySize }) => ({
            name,
            transferSize,
            encodedBodySize,
            decodedBodySize,
          })),
      );
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const cold = await readAssets();
    const image = page
      .locator(route === "/" ? ".about-portrait__poster" : ".atlas-book__preview")
      .first();
    const criticalSource = await image.evaluate((element) =>
      element instanceof HTMLImageElement
        ? element.currentSrc
        : getComputedStyle(element).backgroundImage.slice(5, -2),
    );
    const before = await image.boundingBox();
    await page.reload();
    await page.waitForLoadState("networkidle");
    if (route === "/") await expect(image).toBeVisible();
    else await expect(page.locator(".atlas-book__button").first()).toBeVisible();
    await expect(image).toHaveCSS("opacity", "1");
    await expect
      .poll(() =>
        image.evaluate((element) =>
          element instanceof HTMLImageElement
            ? element.complete && element.naturalWidth > 0
            : getComputedStyle(element).backgroundImage !== "none",
        ),
      )
      .toBe(true);
    const warm = await readAssets();
    const cached = warm.filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0);
    await testInfo.attach("warm-cache.json", {
      contentType: "application/json",
      body: JSON.stringify({ route, criticalSource, cold, warm, cached }, null, 2),
    });
    expect(cold.some((entry) => entry.transferSize > 0)).toBe(true);
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.some((entry) => entry.name === criticalSource)).toBe(true);
    expect(requests.filter((url) => enhancementAsset.test(url))).toEqual([]);
    const after = await image.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (!before || !after) throw new Error("The first image must keep its reserved box on reload");
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("navigation", { name: "Site", exact: true })).toBeVisible();
    if (route === "/") await expect(page.locator(".about-passage")).toContainText("Hello internet");
    else await expect(page.locator(".book__volume").first()).toBeVisible();
  });
}
