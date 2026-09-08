import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function installContentProbe(page: Page) {
  await page.evaluate(() => {
    const wrap = document.querySelector(".page-wrap");
    if (!wrap) throw new Error("The paper edge needs its page");
    const probe = document.createElement("div");
    probe.dataset.edgeProbe = "";
    probe.style.cssText = "position:fixed;inset:0;z-index:1;pointer-events:none";
    wrap.append(probe);
  });
}

async function edgePixels(page: Page, color: string) {
  await page.locator("[data-edge-probe]").evaluate((probe, background) => {
    probe.style.background = background;
  }, color);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The paper edge needs a viewport");
  const screenshot = await page.screenshot({
    clip: { x: 0, y: viewport.height - 224, width: viewport.width, height: 224 },
  });
  return sharp(screenshot).removeAlpha().raw().toBuffer();
}

async function expectHiddenContent(page: Page, stretched = false) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The paper edge needs a viewport");
  const columns = stretched
    ? await page.locator("[data-paper-overscroll]").evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The stretched edge needs its paint");
        return [0.01, 0.25, 0.5, 0.75, 0.99].map((position) => {
          const x = Math.round(position * (canvas.width - 1));
          const pixels = context.getImageData(x, 0, 1, canvas.height).data;
          let top = 0;
          while (top < canvas.height && (pixels[top * 4 + 3] ?? 0) < 8) top += 1;
          return {
            position,
            top:
              224 -
              canvas.clientHeight +
              Math.ceil((top / canvas.height) * canvas.clientHeight) +
              2,
          };
        });
      })
    : [0.01, 0.25, 0.5, 0.75, 0.99].map((position) => ({ position, top: 224 - 45 }));
  const black = await edgePixels(page, "black");
  const white = await edgePixels(page, "white");
  for (const column of columns) {
    const x = Math.round(column.position * (viewport.width - 1));
    // The probe is visible above the edge, so a passing test cannot mean all
    // content was hidden or that the probe failed to paint behind the wash.
    const above = (20 * viewport.width + x) * 3;
    expect(Math.abs((black[above] ?? 0) - (white[above] ?? 0))).toBeGreaterThan(200);
    let difference = 0;
    for (let y = column.top; y < 224; y += 1) {
      const offset = (y * viewport.width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        difference = Math.max(
          difference,
          Math.abs((black[offset + channel] ?? 0) - (white[offset + channel] ?? 0)),
        );
      }
    }
    expect(difference).toBeLessThanOrEqual(1);
  }
}

for (const viewport of [
  { width: 1350, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`${viewport.width}px paper edge hides content through stretch and return`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
    await installContentProbe(page);
    await expectHiddenContent(page);
    await page.evaluate(() => {
      const wrap = document.querySelector(".page-wrap");
      const owner = matchMedia("(max-width:760px)").matches ? document.scrollingElement : wrap;
      if (!owner) throw new Error("The paper needs a scroll owner");
      owner.dispatchEvent(new Event("overlay-scrollbar-drag-start"));
      owner.scrollTo({ top: owner.scrollHeight - owner.clientHeight, behavior: "instant" });
    });
    await expect(page.locator("[data-paper-occlusion]")).toHaveCSS("opacity", "1");
    // Let the shape-only decode reveal finish before sampling its full curve.
    await page.waitForTimeout(100);
    await expectHiddenContent(page, true);
    await page.evaluate(() => {
      const owner = matchMedia("(max-width:760px)").matches
        ? document.scrollingElement
        : document.querySelector(".page-wrap");
      owner?.dispatchEvent(new Event("overlay-scrollbar-drag-end"));
    });
    await expect(page.locator("[data-paper-occlusion]")).toHaveCSS("opacity", "0");
    await expectHiddenContent(page);

    // The returned canvas holds its zero-pull frame. Switching it back on
    // must match the CSS footer, including the feather above the colour.
    const resting = await edgePixels(page, "black");
    await page.evaluate(() => {
      for (const selector of ["[data-paper-overscroll]", "[data-paper-occlusion]"]) {
        document.querySelector<HTMLElement>(selector)?.style.setProperty("opacity", "1");
      }
      document
        .querySelector<HTMLElement>("[data-paper-foot-wash]")
        ?.style.setProperty("opacity", "0");
    });
    const canvas = await edgePixels(page, "black");
    let difference = 0;
    for (const [index, value] of resting.entries()) {
      difference = Math.max(difference, Math.abs(value - (canvas[index] ?? 0)));
    }
    expect(difference).toBeLessThanOrEqual(3);
  });

  for (const mode of ["no scripting", "reduced motion"]) {
    test.describe(`${viewport.width}px ${mode}`, () => {
      test.use({
        javaScriptEnabled: mode !== "no scripting",
        reducedMotion: mode === "reduced motion" ? "reduce" : "no-preference",
      });
      test("the resting paper edge completely hides underlying content", async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto("/");
        await installContentProbe(page);
        await expectHiddenContent(page);
      });
    });
  }
}
