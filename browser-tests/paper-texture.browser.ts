import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function paperGeometry(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".page-wrap");
    const sheet = wrap?.querySelector<HTMLElement>(".panel-shell");
    const tail = wrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : wrap;
    if (!wrap || !sheet || !tail || !owner) throw new Error("Missing paper scroll geometry");
    const style = getComputedStyle(wrap);
    return {
      bottom: owner.scrollHeight - owner.clientHeight - tail.offsetHeight,
      scrollTop: owner.scrollTop,
      scrollHeight: owner.scrollHeight,
      sheetTop: sheet.getBoundingClientRect().top,
      lightPositions: style.backgroundPosition.split(",").slice(0, 2),
      lightAttachments: style.backgroundAttachment.split(",").slice(0, 2),
    };
  });
}

async function movePaper(page: Page, distance: number) {
  await page.evaluate(async (pull) => {
    const wrap = document.querySelector<HTMLElement>(".page-wrap");
    const tail = wrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : wrap;
    if (!tail || !owner) throw new Error("Missing paper scroll owner");
    owner.dispatchEvent(new Event("overlay-scrollbar-drag-start"));
    owner.scrollTo({
      top: owner.scrollHeight - owner.clientHeight - tail.offsetHeight + pull,
      behavior: "instant",
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, distance);
}

async function textureRows(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Texture sampling needs a viewport");
  const screenshot = await page.screenshot({
    clip: { x: 8, y: 24, width: 1, height: Math.min(600, viewport.height - 80) },
  });
  const pixels = await sharp(screenshot).removeAlpha().greyscale().raw().toBuffer();
  return Array.from(pixels, (value) => (value < 180 ? 1 : 0));
}

function paintedDisplacement(before: number[], after: number[]) {
  let bestOffset = 0;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let offset = -180; offset <= 180; offset += 1) {
    let difference = 0;
    let overlap = 0;
    for (let y = 0; y < after.length; y += 1) {
      const reference = before[y - offset];
      if (reference === undefined) continue;
      difference += Math.abs((after[y] ?? 0) - reference);
      overlap += 1;
    }
    const score = difference / overlap;
    if (score < bestDifference) {
      bestDifference = score;
      bestOffset = offset;
    }
  }
  expect(bestDifference).toBeLessThan(0.04);
  return bestOffset;
}

for (const { name, viewport, travel } of [
  { name: "desktop", viewport: { width: 1350, height: 640 }, travel: 480 },
  { name: "mobile", viewport: { width: 390, height: 844 }, travel: 410 },
]) {
  test(`${name} paper texture stays attached through scrolling, pulling, and release`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
    await page.evaluate(() => document.fonts.ready);

    // Uneven marks make the actual painted movement unambiguous. Replacing
    // only the tile preserves the production attachment, position and blend.
    const stripes = [9, 31, 68, 119, 152, 191, 249, 281, 337, 372, 413]
      .map((y) => `<rect y="${y}" width="448" height="7"/>`)
      .join("");
    const tile = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="448" height="448"><rect width="448" height="448" fill="white"/>${stripes}</svg>`,
    )}`;
    await page.addStyleTag({
      content: `
        :root, .page-wrap { --paper-sheet: url("${tile}") !important; }
        .panel-shell__body, .about-template__letterhead,
        [data-paper-foot-wash], [data-paper-overscroll], [data-paper-occlusion] {
          visibility: hidden !important;
        }
      `,
    });

    const initial = await paperGeometry(page);
    expect(initial.bottom).toBeGreaterThan(80);
    await movePaper(page, -80);
    const beforeBoundary = await paperGeometry(page);
    const beforeRows = await textureRows(page);
    expect(beforeRows).toContain(1);
    expect(beforeRows).toContain(0);

    await movePaper(page, 0);
    const boundary = await paperGeometry(page);
    const boundaryRows = await textureRows(page);
    expect(boundary.sheetTop - beforeBoundary.sheetTop).toBeCloseTo(-80, 0);
    expect(paintedDisplacement(beforeRows, boundaryRows)).toBeCloseTo(-80, 0);
    expect(boundary.lightAttachments.map((value) => value.trim())).toEqual(["fixed", "fixed"]);

    for (const distance of [8, 64, travel, 64, 8]) {
      // eslint-disable-next-line no-await-in-loop -- Sample each held pull before changing its native scroll position.
      await movePaper(page, distance);
      // eslint-disable-next-line no-await-in-loop -- Read content geometry for the same held frame as its texture.
      const frame = await paperGeometry(page);
      // eslint-disable-next-line no-await-in-loop -- Pixel motion must be measured before the next pull.
      const rows = await textureRows(page);
      expect(frame.scrollTop - frame.bottom).toBeCloseTo(distance, 0);
      expect(frame.scrollHeight).toBe(initial.scrollHeight);
      expect(frame.lightPositions).toEqual(boundary.lightPositions);
      expect(frame.lightAttachments).toEqual(boundary.lightAttachments);
      expect(
        Math.abs(paintedDisplacement(boundaryRows, rows) - (frame.sheetTop - boundary.sheetTop)),
      ).toBeLessThanOrEqual(1);
    }

    await page.evaluate(() => {
      const owner = matchMedia("(max-width: 760px)").matches
        ? document.scrollingElement
        : document.querySelector(".page-wrap");
      if (!owner) throw new Error("Missing paper scroll owner");
      owner.dispatchEvent(new Event("overlay-scrollbar-drag-end"));
    });
    await expect.poll(async () => (await paperGeometry(page)).scrollTop).toBe(boundary.bottom);
    const settled = await paperGeometry(page);
    expect(settled.sheetTop).toBeCloseTo(boundary.sheetTop, 0);
    expect(settled.scrollHeight).toBe(initial.scrollHeight);
    expect(paintedDisplacement(boundaryRows, await textureRows(page))).toBe(0);
  });
}
