// cspell:ignore domcontentloaded networkidle cixin describedby
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { warmAtlas } from "./helpers/atlas";

for (const viewport of [
  { width: 1350, height: 940 },
  { width: 1100, height: 600 },
]) {
  test(`the ${viewport.width}px first frame remains static through startup and refresh`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const scripts = Promise.withResolvers<void>();
    await page.route(/\.js(?:\?|$)/, async (route) => {
      await scripts.promise;
      await route.continue();
    });
    try {
      await page.goto("/bookshelf", { waitUntil: "commit" });
      await page.locator("[data-book-open]").first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        const atlas = document.querySelector<HTMLElement>("[data-atlas]");
        const image = new Image();
        image.src = (atlas?.style.getPropertyValue("--atlas-preview-sheet") ?? "")
          .slice(4, -1)
          .replaceAll('"', "");
        await image.decode();
      });
      const stage = page.locator("[data-atlas-stage]");
      const before = await stage.screenshot();
      const geometry = await stage.boundingBox();
      scripts.resolve();
      await warmAtlas(page);
      await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
      await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-engaged");
      expect(await stage.boundingBox()).toEqual(geometry);
      expect((await stage.screenshot()).equals(before)).toBe(true);
      const spacing = await page.evaluate(() => {
        const header = document
          .querySelector(".about-template__letterhead")
          ?.getBoundingClientRect();
        const table = document.querySelector("[data-atlas-stage]")?.getBoundingClientRect();
        if (!header || !table) throw new Error("Header and table must be present");
        return table.top - header.bottom;
      });
      expect(spacing).toBeGreaterThanOrEqual(0);
      expect(spacing).toBeLessThan(12);
      await page.screenshot({ path: `artifacts/atlas/static-first-${viewport.width}.png` });
      const book = page.locator("[data-book-open]").nth(82);
      await book.hover();
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
      await expect(page.getByRole("tooltip")).toBeVisible();
      // A stationary pointer left over a book must not activate 3D on reload.
      await page.reload();
      await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-engaged");
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
      await expect(page.getByRole("tooltip")).not.toBeVisible();
      await warmAtlas(page);
      await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
      await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-engaged");
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
    } finally {
      scripts.resolve();
    }
  });
}

for (const profile of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
  { name: "landscape", width: 740, height: 320 },
]) {
  test.describe(profile.name, () => {
    test.use({ viewport: profile, hasTouch: profile.width <= 760, isMobile: profile.width <= 760 });
    test("reserves book geometry and supports inspection before and after enhancement", async ({
      page,
    }) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.route(/atlas-renderer[^?]*\.(?:js|ts)(?:\?|$)/, async (route) => {
        await promise;
        await route.continue();
      });
      await mkdir("artifacts/atlas", { recursive: true });
      try {
        await page.goto("/bookshelf", { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        const first = page.locator("[data-book-open]").first();
        const before = await first.boundingBox();
        if (profile.width > 760) {
          const stage = await page.locator("[data-atlas-stage]").boundingBox();
          expect(stage?.height).toBeGreaterThan(profile.height / 2);
          await expect(page.locator(".atlas-view-controls, .atlas-view-button")).toHaveCount(0);
          await expect(
            page.getByText("Scroll to zoom · Drag to move", { exact: true }),
          ).toHaveCount(0);
        }
        if (profile.width > 760)
          await page.evaluate(async () => {
            const url = document
              .querySelector<HTMLElement>("[data-atlas]")
              ?.style.getPropertyValue("--atlas-preview-sheet")
              .slice(4, -1)
              .replaceAll('"', "");
            if (url) {
              const image = new Image();
              image.src = url;
              await image.decode();
            }
          });
        else
          await expect
            .poll(() =>
              page
                .locator(".atlas-book__mobile img")
                .first()
                .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
            )
            .toBe(true);
        await page.screenshot({ path: `artifacts/atlas/${profile.name}-preview.png` });
        resolve();
        const atlas = page.locator("[data-atlas]");
        if (profile.width > 760) {
          await warmAtlas(page);
          await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
          await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "0");
          const stage = await page.locator("[data-atlas-stage]").boundingBox();
          if (!stage) throw new Error("The table must have its reserved geometry");
          await page.mouse.move(stage.x + 4, stage.y + 4);
          await page.mouse.wheel(0, 100);
          await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "1");
        } else {
          await expect(atlas).toHaveAttribute("data-atlas-mode", "grid");
          expect(requests.filter((url) => /atlas-renderer|\/bookshelf\/atlas\//.test(url))).toEqual(
            [],
          );
        }
        await page.screenshot({ path: `artifacts/atlas/${profile.name}-live.png` });
        const after = await first.boundingBox();
        if (!before || !after) throw new Error("Book geometry must be reserved");
        for (const key of ["x", "y", "width", "height"] as const)
          expect(Math.abs(before[key] - after[key])).toBeLessThanOrEqual(1);
        await first.click();
        await expect(page.locator("[data-book-inspector]")).toBeVisible();
        if (profile.width > 760) {
          await expect(page.locator("[data-book-inspector]")).toHaveAttribute(
            "data-inspector-ready",
            "true",
          );
          await page.waitForTimeout(650);
          await page.locator("[data-inspect-rotation]").focus();
          await page.keyboard.press("ArrowRight");
        }
        await page.screenshot({ path: `artifacts/atlas/${profile.name}-inspection.png` });
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
        await expect(first).toBeFocused();
      } finally {
        resolve();
      }
    });
  });
}

test("desktop opens with every book fitted, zooms around the pointer and returns to fit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/bookshelf");
  const atlas = page.locator("[data-atlas]");
  await warmAtlas(page);
  await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
  await expect(atlas).toHaveAttribute("data-atlas-models", "165");
  await expect(atlas).toHaveAttribute("data-atlas-zoom", "1.0000");
  expect(
    await page.locator("[data-book-open]").evaluateAll((books) => {
      const stage = document.querySelector("[data-atlas-stage]")?.getBoundingClientRect();
      if (!stage) throw new Error("Missing stage");
      return books.filter((book) => {
        const r = book.getBoundingClientRect();
        return (
          r.left < stage.left ||
          r.right > stage.right ||
          r.top < stage.top ||
          r.bottom > stage.bottom
        );
      }).length;
    }),
  ).toBe(0);
  await page.screenshot({ path: "artifacts/atlas/desktop-overview.png" });
  const book = page.locator("[data-book-open]").nth(82);
  const before = await book.boundingBox();
  if (!before) throw new Error("Missing book");
  const x = before.x + before.width / 2,
    y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -450);
  await expect
    .poll(async () => Number(await atlas.getAttribute("data-atlas-zoom")))
    .toBeGreaterThan(2);
  const after = await book.boundingBox();
  if (!after) throw new Error("Missing zoomed book");
  expect(Math.abs(after.x + after.width / 2 - x)).toBeLessThan(1);
  expect(Math.abs(after.y + after.height / 2 - y)).toBeLessThan(1);
  await page.mouse.wheel(0, 2000);
  await expect(atlas).toHaveAttribute("data-atlas-zoom", "1.0000");
  await expect(atlas).toHaveAttribute("data-atlas-pan-x", "0.00");
  await expect(atlas).toHaveAttribute("data-atlas-pan-y", "0.00");
});

for (const live of [false, true]) {
  test(`hover leaves books and shadows unchanged in the ${live ? "live" : "printed"} table`, async ({
    page,
  }) => {
    await page.goto("/bookshelf");
    const atlas = page.locator("[data-atlas]");
    const stage = page.locator("[data-atlas-stage]");
    await warmAtlas(page);
    await expect(atlas).toHaveAttribute("data-atlas-ready", "true");
    if (live) {
      await stage.hover({ position: { x: 4, y: 4 } });
      await page.mouse.wheel(0, 100);
      await expect(page.locator("[data-atlas-canvas]")).toHaveCSS("opacity", "1");
    }
    await page.waitForTimeout(300);
    const frames = await atlas.getAttribute("data-atlas-frames");
    const capture = (state: string) =>
      stage.screenshot({
        path: `artifacts/atlas/hover-${live ? "live" : "printed"}-${state}.png`,
        style: "[role=tooltip], [data-atlas-tooltip-arrow] { visibility: hidden; }",
      });
    const before = await capture("before");
    await page.locator("[data-book-open]").nth(82).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.waitForTimeout(350);
    expect((await capture("first")).equals(before)).toBe(true);
    await page.locator("[data-book-open]").nth(81).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    expect((await capture("next")).equals(before)).toBe(true);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).not.toBeVisible();
    expect((await capture("leave")).equals(before)).toBe(true);
    await expect(atlas).toHaveAttribute("data-atlas-frames", frames ?? "");
  });
}

test("hover and keyboard focus show metadata in a tooltip above the canvas", async ({ page }) => {
  await page.goto("/bookshelf");
  await warmAtlas(page);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-ready", "true");
  const book = page.locator("[data-book-open]").nth(82);
  await book.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("London for Dogs");
  await expect(tooltip).toContainText("Sarah Guy");
  await expect(tooltip).not.toContainText("Physical");
  await expect(tooltip.locator("[data-tooltip-date]")).toHaveText("2017");
  await expect(tooltip).toHaveAttribute("data-surface", "notebook");
  const arrow = page.locator("[data-atlas-tooltip-arrow]");
  await expect(arrow).toBeVisible();
  await expect(book).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id")) ?? "");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/atlas/desktop-hover.png" });
  const bounds = await tooltip.boundingBox();
  const bookBounds = await book.boundingBox();
  if (!bounds || !bookBounds) throw new Error("The label and its book must be visible");
  expect(bounds.width).toBeLessThan(330);
  expect(bounds.height).toBeLessThan(110);
  expect(
    bounds.x > bookBounds.x + bookBounds.width ||
      bounds.x + bounds.width < bookBounds.x ||
      bounds.y > bookBounds.y + bookBounds.height ||
      bounds.y + bounds.height < bookBounds.y,
  ).toBe(true);
  const paper = await tooltip.evaluate(
    (element) => getComputedStyle(element, "::before").backgroundImage,
  );
  expect(paper).toContain("radial-gradient");
  const tip = await arrow
    .locator("[data-tooltip-arrow-line]")
    .evaluate((element: SVGPathElement) => {
      const point = element.getPointAtLength(element.getTotalLength());
      const stage = document.querySelector("[data-atlas-stage]")?.getBoundingClientRect();
      return { x: point.x + (stage?.x ?? 0), y: point.y + (stage?.y ?? 0) };
    });
  const distance = Math.min(
    Math.abs(tip.x - bookBounds.x),
    Math.abs(tip.x - bookBounds.x - bookBounds.width),
    Math.abs(tip.y - bookBounds.y),
    Math.abs(tip.y - bookBounds.y - bookBounds.height),
  );
  expect(distance).toBeLessThan(6);
  expect(bounds?.y).toBeGreaterThan(90);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThan(940);
  await page.mouse.move(0, 0);
  await expect(tooltip).not.toBeVisible();
  await expect(arrow).not.toBeVisible();
  await book.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).not.toBeVisible();
  await expect(arrow).not.toBeVisible();
  await page.keyboard.press("Enter");
  await expect(tooltip).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
  await expect(tooltip).not.toBeVisible();
});

test("search resets zoom and resizing an inspection to mobile preserves usable focus", async ({
  page,
}) => {
  await page.goto("/bookshelf");
  await page.mouse.move(650, 440);
  await page.mouse.wheel(0, -200);
  await page.locator("[data-search-input]").fill("cixin");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(4);
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-zoom", "1.0000");
  await page.locator("[data-search-input]").fill("");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(165);
  const book = page.locator("[data-book-open]").nth(80);
  await book.click();
  await expect(page.locator("[data-book-inspector]")).toHaveAttribute(
    "data-inspector-ready",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
  await expect(book).toBeFocused();
  await expect(book).toBeInViewport();
  await expect(page.locator("[data-atlas]")).toHaveAttribute("data-atlas-mode", "grid");
  await expect(page.locator(".atlas-view-controls")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(page.locator("[data-book-open]").last()).toBeInViewport();
});

test.describe("mobile gestures", () => {
  test.use({ viewport: { width: 390, height: 667 }, isMobile: true, hasTouch: true });
  test("vertical swipes scroll the grid without selecting books", async ({ page }) => {
    await page.goto("/bookshelf");
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 180, y: 550 }],
      });
      /* eslint-disable no-await-in-loop */
      for (const y of [510, 450, 360, 280, 200]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 180, y }],
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      /* eslint-enable no-await-in-loop */
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(150);
      await expect(page.locator("[data-book-inspector]")).not.toBeVisible();
      await expect(page.locator("[data-atlas]")).not.toHaveAttribute("data-atlas-ready");
    } finally {
      await session.detach();
    }
  });
});
