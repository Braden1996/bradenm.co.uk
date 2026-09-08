// cspell:ignore domcontentloaded
import { expect, test, type Page } from "@playwright/test";
import { paperOverscrollColumnHeight } from "../src/components/lib/paper-overscroll-renderer";

async function geometry(page: Page) {
  return page.evaluate(() => {
    const pageWrap = document.querySelector<HTMLElement>(".page-wrap");
    const sheet = pageWrap?.querySelector<HTMLElement>(".panel-shell");
    const tail = pageWrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const foot = pageWrap?.querySelector<HTMLElement>("[data-paper-foot-wash]");
    if (!pageWrap || !sheet || !tail || !foot) {
      throw new Error("Paper geometry needs the page, sheet, scroll tail, and footer wash");
    }
    const mobile = matchMedia("(max-width: 760px)").matches;
    const owner = mobile ? document.scrollingElement : pageWrap;
    if (!owner) throw new Error("Paper geometry needs a native scroll owner");
    return {
      bottom: owner.scrollHeight - owner.clientHeight - tail.offsetHeight,
      scrollTop: owner.scrollTop,
      scrollHeight: owner.scrollHeight,
      travel: tail.offsetHeight,
      sheetHeight: sheet.getBoundingClientRect().height,
      sheetBottom: sheet.getBoundingClientRect().bottom,
      footBottom: foot.getBoundingClientRect().bottom,
      footLeft: foot.getBoundingClientRect().left,
      footRight: foot.getBoundingClientRect().right,
      viewportWidth: innerWidth,
      viewportBottom: mobile ? innerHeight : pageWrap.getBoundingClientRect().bottom,
    };
  });
}

async function holdPull(page: Page, distance: number) {
  await page.evaluate(async (pull) => {
    const pageWrap = document.querySelector<HTMLElement>(".page-wrap");
    const tail = pageWrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : pageWrap;
    if (!tail || !owner) throw new Error("Holding a paper pull needs its tail and scroll owner");
    const bottom = owner.scrollHeight - owner.clientHeight - tail.offsetHeight;
    owner.dispatchEvent(new Event("overlay-scrollbar-drag-start"));
    owner.scrollTo({ top: bottom + pull, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, distance);
}

async function washColumns(page: Page) {
  return page.locator("[data-paper-overscroll]").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Wash sampling needs its drawing context");
    const scale = canvas.clientHeight / canvas.height;
    return [0, Math.floor(canvas.width / 2), canvas.width - 1].map((x) => {
      const pixels = context.getImageData(x, 0, 1, canvas.height).data;
      let top = canvas.height;
      for (let y = 0; y < canvas.height; y += 1) {
        if ((pixels[y * 4 + 3] ?? 0) >= 8) {
          top = y;
          break;
        }
      }
      return {
        height: (canvas.height - top) * scale,
        bottomAlpha: pixels.at(-1) ?? 0,
      };
    });
  });
}

async function stretchedColourDifference(page: Page) {
  const wash = page.locator("[data-paper-overscroll]");
  const { width, height, cssHeight } = await wash.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    cssHeight: canvas.clientHeight,
  }));
  const columnHeights = Array.from(
    { length: width },
    (_, x) => paperOverscrollColumnHeight(x / (width - 1), 1, cssHeight) * (height / cssHeight),
  );

  return wash.evaluate(async (canvas: HTMLCanvasElement, heights) => {
    const source = new Image();
    source.src = canvas.dataset.overscrollSrc ?? "";
    await source.decode();
    const reference = document.createElement("canvas");
    reference.width = canvas.width;
    reference.height = canvas.height;
    const context = reference.getContext("2d");
    const rendered = canvas.getContext("2d");
    if (!context || !rendered) throw new Error("Pigment comparison needs drawing contexts");

    // Stretch the unchanged resting wash into the same geometry. Pull strength
    // may add coverage, but the underlying orange, blue, and green must agree.
    for (const [x, columnHeight] of heights.entries()) {
      context.drawImage(
        source,
        x,
        0,
        1,
        source.naturalHeight,
        x,
        canvas.height - columnHeight,
        1,
        columnHeight,
      );
    }
    const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const actual = rendered.getImageData(0, 0, canvas.width, canvas.height).data;
    let difference = 0;
    let compared = 0;
    for (let offset = 0; offset < expected.length; offset += 4) {
      // Sample the visible body and compare both pigments at the pulled wash's
      // coverage, so alpha strengthening itself does not count as a hue change.
      if ((expected[offset + 3] ?? 0) < 64) continue;
      const coverage = (actual[offset + 3] ?? 0) / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        difference = Math.max(
          difference,
          Math.abs(
            Math.round((actual[offset + channel] ?? 0) * coverage) -
              Math.round((expected[offset + channel] ?? 0) * coverage),
          ),
        );
      }
      compared += 1;
    }
    return { compared, difference };
  }, columnHeights);
}

for (const { name, viewport, travel, lift } of [
  { name: "desktop", viewport: { width: 1350, height: 940 }, travel: 480, lift: 133 },
  { name: "mobile", viewport: { width: 390, height: 844 }, travel: 410, lift: 114 },
]) {
  test(`${name} wash grows upward and strengthens its colours across its full width`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
    await page.evaluate(() => document.fonts.ready);
    await holdPull(page, 1);
    await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "1");
    await holdPull(page, 0);

    const restingDifference = await page
      .locator("[data-paper-overscroll]")
      .evaluate(async (canvas: HTMLCanvasElement) => {
        const source = new Image();
        source.src = canvas.dataset.overscrollSrc ?? "";
        await source.decode();
        const reference = document.createElement("canvas");
        reference.width = canvas.width;
        reference.height = canvas.height;
        const context = reference.getContext("2d");
        const rendered = canvas.getContext("2d");
        if (!context || !rendered) throw new Error("Wash comparison needs drawing contexts");
        const height = (45 * canvas.height) / canvas.clientHeight;
        context.drawImage(source, 0, canvas.height - height, canvas.width, height);
        const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const actual = rendered.getImageData(0, 0, canvas.width, canvas.height).data;
        let alphaDifference = 0;
        let colourDifference = 0;
        for (let offset = 0; offset < expected.length; offset += 4) {
          const actualAlpha = actual[offset + 3] ?? 0;
          const expectedAlpha = expected[offset + 3] ?? 0;
          alphaDifference = Math.max(alphaDifference, Math.abs(actualAlpha - expectedAlpha));
          for (let channel = 0; channel < 3; channel += 1) {
            const actualColour = ((actual[offset + channel] ?? 0) * actualAlpha) / 255;
            const expectedColour = ((expected[offset + channel] ?? 0) * expectedAlpha) / 255;
            // Compare the visible eight-bit colour over black and white,
            // exposing pigment and coverage without amplifying near-zero alpha.
            colourDifference = Math.max(
              colourDifference,
              Math.abs(Math.round(actualColour) - Math.round(expectedColour)),
              Math.abs(
                Math.round(actualColour + 255 - actualAlpha) -
                  Math.round(expectedColour + 255 - expectedAlpha),
              ),
            );
          }
        }
        return { alphaDifference, colourDifference };
      });
    // A whole-image resize and individual column resampling can round coverage
    // by two levels and composited colour by three, even for the same source.
    expect(restingDifference.alphaDifference).toBeLessThanOrEqual(2);
    expect(restingDifference.colourDifference).toBeLessThanOrEqual(3);

    const resting = await washColumns(page);
    let previous = resting;
    for (const column of previous) {
      expect(column.height).toBeGreaterThan(0);
      expect(column.height).toBeLessThanOrEqual(45);
      expect(column.bottomAlpha).toBeGreaterThan(0);
    }
    for (const distance of [1, 4, 10, 24, 48, travel]) {
      // eslint-disable-next-line no-await-in-loop -- Each larger pull must paint before its pixels are sampled.
      await holdPull(page, distance);
      // eslint-disable-next-line no-await-in-loop -- Compare this painted band with the previous pull.
      const current = await washColumns(page);
      for (const [index, column] of current.entries()) {
        expect(column.height).toBeGreaterThanOrEqual((previous[index]?.height ?? 0) - 1);
        expect(column.bottomAlpha).toBeGreaterThan(0);
        expect(column.bottomAlpha).toBeGreaterThanOrEqual((previous[index]?.bottomAlpha ?? 0) - 1);
      }
      previous = current;
    }
    for (const [index, column] of previous.entries()) {
      expect(column.height).toBeGreaterThan(45);
      expect(column.bottomAlpha).toBeGreaterThan((resting[index]?.bottomAlpha ?? 0) + 30);
    }
    const pigments = await stretchedColourDifference(page);
    expect(pigments.compared).toBeGreaterThan(1000);
    // Allow only three visible eight-bit levels from Canvas2D resampling.
    expect(pigments.difference).toBeLessThanOrEqual(3);
  });

  for (const path of ["/", "/bookshelf"]) {
    test(`${name} ${path} wash stays visible through page scrolling, a pull, and spring return`, async ({
      page,
    }) => {
      await page.setViewportSize({
        ...viewport,
        height: name === "desktop" ? 640 : viewport.height,
      });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const firstPaint = await geometry(page);
      expect(firstPaint.footBottom).toBeCloseTo(firstPaint.viewportBottom, 0);
      expect(firstPaint.footLeft).toBe(0);
      expect(firstPaint.footRight).toBe(firstPaint.viewportWidth);
      await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
      await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      const initial = await geometry(page);
      if (name === "desktop" && path === "/bookshelf") {
        expect(initial.travel).toBe(0);
        await holdPull(page, travel);
        expect((await geometry(page)).scrollTop).toBe(0);
        await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
        await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "0");
        return;
      }
      expect(initial.travel).toBe(travel);

      if (path === "/") expect(initial.bottom).toBeGreaterThan(80);
      expect(initial.footBottom).toBeCloseTo(initial.viewportBottom, 0);
      for (const distance of [-initial.bottom / 2, -Math.min(80, initial.bottom), 0]) {
        // eslint-disable-next-line no-await-in-loop -- Check the wash while content passes through ordinary scrolling.
        await holdPull(page, distance);
        // eslint-disable-next-line no-await-in-loop -- Sample each position before moving toward the scroll boundary.
        const frame = await geometry(page);
        expect(frame.footBottom).toBeCloseTo(frame.viewportBottom, 0);
        expect(frame.footLeft).toBe(0);
        expect(frame.footRight).toBe(frame.viewportWidth);
        expect(frame.scrollHeight).toBe(initial.scrollHeight);
        // eslint-disable-next-line no-await-in-loop -- The resting wash must stay visible before any stretched paint is needed.
        await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
        // eslint-disable-next-line no-await-in-loop -- Normal scrolling must not turn on the stretch canvas.
        await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "0");
      }

      await holdPull(page, 1);
      await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "1");

      // Small pulls must keep the same bottom anchor while the wash stretches.
      for (const distance of [1, 4, 10, 24, 48, travel, 24, 10, 4, 1]) {
        // eslint-disable-next-line no-await-in-loop -- Each pull must paint before its geometry is sampled.
        await holdPull(page, distance);
        // eslint-disable-next-line no-await-in-loop -- Sample this pull before moving to the next distance.
        const frame = await geometry(page);
        expect(frame.scrollTop - frame.bottom).toBeCloseTo(distance, 0);
        expect(frame.footBottom).toBeCloseTo(frame.viewportBottom, 0);
        expect(frame.sheetHeight).toBeCloseTo(initial.sheetHeight, 0);
        expect(frame.scrollHeight).toBe(initial.scrollHeight);
        expect(frame.sheetBottom).toBeLessThan(frame.viewportBottom);
        if (distance === travel) {
          expect(frame.viewportBottom - frame.sheetBottom).toBeCloseTo(lift, 0);
        }
      }

      await holdPull(page, travel);
      const frames = await page.evaluate(async () => {
        const pageWrap = document.querySelector<HTMLElement>(".page-wrap");
        const tail = pageWrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
        const foot = pageWrap?.querySelector<HTMLElement>("[data-paper-foot-wash]");
        const owner = matchMedia("(max-width: 760px)").matches
          ? document.scrollingElement
          : pageWrap;
        if (!tail || !foot || !owner) {
          throw new Error("Spring sampling needs the scroll tail, footer wash, and native owner");
        }
        const bottom = owner.scrollHeight - owner.clientHeight - tail.offsetHeight;
        const samples: { distance: number; footBottom: number }[] = [];
        owner.dispatchEvent(new Event("overlay-scrollbar-drag-end"));
        for (let frame = 0; frame < 120; frame += 1) {
          // eslint-disable-next-line no-await-in-loop -- Consecutive painted frames measure the spring's full return.
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const distance = owner.scrollTop - bottom;
          samples.push({ distance, footBottom: foot.getBoundingClientRect().bottom });
          if (distance === 0) break;
        }
        return samples;
      });

      expect(frames.length).toBeGreaterThan(1);
      expect(frames.at(-1)?.distance).toBe(0);
      let previousDistance = travel;
      for (const frame of frames) {
        expect(frame.distance).toBeGreaterThanOrEqual(0);
        expect(frame.distance).toBeLessThanOrEqual(previousDistance);
        expect(frame.footBottom).toBeCloseTo(initial.viewportBottom, 0);
        previousDistance = frame.distance;
      }
      const settled = await geometry(page);
      expect(settled.sheetBottom).toBeCloseTo(settled.viewportBottom, 0);
      expect(settled.scrollHeight).toBe(initial.scrollHeight);
      await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
      await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "0");
    });
  }
}

async function controlWashDecode(page: Page, reject: boolean) {
  await page.addInitScript((shouldReject) => {
    // eslint-disable-next-line typescript/unbound-method -- Call the saved decoder with its original image receiver.
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (!this.src.includes("/generated/paper-wash")) return decode.call(this);
      document.documentElement.dataset.paperWashDecode = shouldReject ? "failed" : "pending";
      if (shouldReject) return Promise.reject(new Error("Deliberate wash decode failure"));
      return new Promise<void>((resolve, rejectDecode) => {
        document.addEventListener(
          "test:release-wash-decode",
          () => {
            void decode.call(this).then(resolve, rejectDecode);
          },
          { once: true },
        );
      });
    };
  }, reject);
}

test("a delayed wash decode keeps the resting wash visible until it can paint", async ({
  page,
}) => {
  await controlWashDecode(page, false);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
  await page.evaluate(() => document.fonts.ready);
  await holdPull(page, 96);
  await expect(page.locator("html")).toHaveAttribute("data-paper-wash-decode", "pending");
  const foot = page.locator("[data-paper-foot-wash]");
  const decoration = page.locator("[data-paper-overscroll]");
  await expect(foot).toHaveCSS("opacity", "1");
  await expect(decoration).toHaveCSS("opacity", "0");
  const pending = await geometry(page);
  expect(pending.footBottom).toBeCloseTo(pending.viewportBottom, 0);

  await page.evaluate(() => document.dispatchEvent(new Event("test:release-wash-decode")));
  await expect(decoration).toHaveCSS("opacity", "1");
  await expect(foot).toHaveCSS("opacity", "0");
  const decoded = await geometry(page);
  expect(decoded.footBottom).toBeCloseTo(decoded.viewportBottom, 0);
  expect(decoded.scrollTop).toBe(pending.scrollTop);
  expect(decoded.sheetBottom).toBeCloseTo(pending.sheetBottom, 0);
});

test("a failed wash decode preserves the visible wash at the scroll boundary", async ({ page }) => {
  await controlWashDecode(page, true);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
  await page.evaluate(() => document.fonts.ready);
  await holdPull(page, 96);
  await expect(page.locator("html")).toHaveAttribute("data-paper-wash-decode", "failed");
  await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-paper-overscroll]")).toHaveCSS("opacity", "0");
  const frame = await geometry(page);
  expect(frame.footBottom).toBeCloseTo(frame.viewportBottom, 0);
  expect(frame.scrollTop - frame.bottom).toBe(96);
});

for (const mode of ["without JavaScript", "with reduced motion"]) {
  test.describe(mode, () => {
    test.use({
      javaScriptEnabled: mode !== "without JavaScript",
      reducedMotion: mode === "with reduced motion" ? "reduce" : "no-preference",
    });

    for (const viewport of [
      { width: 1350, height: 640 },
      { width: 390, height: 844 },
    ]) {
      test(`${viewport.width}px wash stays on the viewport edge ${mode}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        const firstPaint = await geometry(page);
        expect(firstPaint.footBottom).toBeCloseTo(firstPaint.viewportBottom, 0);
        await page.evaluate(() => document.fonts.ready);
        const initial = await geometry(page);
        expect(initial.travel).toBe(0);
        expect(initial.bottom).toBeGreaterThan(80);
        for (const distance of [-initial.bottom, -initial.bottom / 2, 0]) {
          // eslint-disable-next-line no-await-in-loop -- Inspect ordinary page scrolling with the decorative motion disabled.
          await page.evaluate((top) => {
            const owner = matchMedia("(max-width: 760px)").matches
              ? document.scrollingElement
              : document.querySelector(".page-wrap");
            owner?.scrollTo({ top, behavior: "instant" });
          }, initial.bottom + distance);
          // eslint-disable-next-line no-await-in-loop -- The fixed edge must remain correct at each scroll position.
          const frame = await geometry(page);
          expect(frame.footBottom).toBeCloseTo(frame.viewportBottom, 0);
          expect(frame.footLeft).toBe(0);
          expect(frame.footRight).toBe(frame.viewportWidth);
          expect(frame.scrollHeight).toBe(initial.scrollHeight);
          // eslint-disable-next-line no-await-in-loop -- This CSS wash remains visible without the scripted handoff.
          await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
        }
      });
    }
  });
}
