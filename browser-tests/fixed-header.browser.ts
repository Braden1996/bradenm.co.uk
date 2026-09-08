import { expect, test, type Page } from "@playwright/test";

async function headerGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".about-template__letterhead");
    const menu = header?.querySelector<HTMLElement>(".site-menu");
    const search = header?.querySelector<HTMLElement>("[data-search-input]");
    if (!header || !menu) throw new Error("The letterhead needs its navigation");
    // eslint-disable-next-line unicorn/consistent-function-scoping -- This helper must live inside the browser evaluation.
    const bounds = (element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const transformedAncestors: string[] = [];
    for (let ancestor = header.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).transform !== "none") {
        transformedAncestors.push(ancestor.className);
      }
    }
    return {
      menu: bounds(menu),
      search: search ? bounds(search) : null,
      transformedAncestors,
    };
  });
}

function expectHeaderAt(
  actual: Awaited<ReturnType<typeof headerGeometry>>,
  expected: Awaited<ReturnType<typeof headerGeometry>>,
) {
  for (const control of ["menu", "search"] as const) {
    const before = expected[control];
    const after = actual[control];
    expect(Boolean(after)).toBe(Boolean(before));
    if (!before || !after) continue;
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after[dimension] - before[dimension])).toBeLessThanOrEqual(1);
    }
  }
  expect(actual.transformedAncestors).toEqual([]);
}

async function scrollContent(page: Page) {
  return page.evaluate(async () => {
    const wrap = document.querySelector<HTMLElement>(".page-wrap");
    const tail = wrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : wrap;
    if (!owner || !tail) throw new Error("Scrolling needs the paper viewport and its tail");
    const bottom = owner.scrollHeight - owner.clientHeight - tail.offsetHeight;
    const atlas = document.querySelector<HTMLElement>("[data-atlas-scroll]");
    if (
      atlas &&
      !matchMedia("(max-width: 760px)").matches &&
      document.querySelector<HTMLElement>("[data-about-rooms]")?.dataset.room === "bookshelf"
    ) {
      atlas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -200,
          clientX: 300,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return Number(document.querySelector<HTMLElement>("[data-atlas]")?.dataset.atlasZoom) - 1;
    }
    if (bottom <= 0) throw new Error("The test viewport must have ordinary scrolling content");
    owner.scrollTo({ top: Math.min(120, bottom), behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return owner.scrollTop;
  });
}

async function holdMaximumPull(page: Page) {
  return page.evaluate(async () => {
    const wrap = document.querySelector<HTMLElement>(".page-wrap");
    const tail = wrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : wrap;
    if (!owner || !tail) throw new Error("Holding a pull needs the paper viewport and its tail");
    owner.dispatchEvent(new Event("overlay-scrollbar-drag-start"));
    owner.scrollTo({ top: owner.scrollHeight - owner.clientHeight, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      distance: owner.scrollTop - (owner.scrollHeight - owner.clientHeight - tail.offsetHeight),
      travel: tail.offsetHeight,
    };
  });
}

for (const { name, viewport } of [
  { name: "desktop", viewport: { width: 1350, height: 640 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
  { name: "short landscape", viewport: { width: 740, height: 320 } },
]) {
  for (const route of ["/", "/bookshelf"] as const) {
    test(`${name} ${route} keeps its header usable through scrolling and full stretch`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      const initial = await headerGeometry(page);
      expect(await scrollContent(page)).toBeGreaterThan(0);
      expectHeaderAt(await headerGeometry(page), initial);

      const pull = await holdMaximumPull(page);
      const fixedAtlas = name === "desktop" && route === "/bookshelf";
      if (fixedAtlas) expect(pull.travel).toBe(0);
      else expect(pull.travel).toBeGreaterThan(0);
      expect(pull.distance).toBeCloseTo(pull.travel, 0);
      if (fixedAtlas) await expect(page.locator(".panel-shell")).toHaveCSS("transform", "none");
      else await expect(page.locator(".panel-shell")).not.toHaveCSS("transform", "none");
      expectHeaderAt(await headerGeometry(page), initial);

      const connect = page.getByRole("button", { name: "Connect", exact: true });
      await connect.click();
      await expect(connect).toHaveAttribute("aria-expanded", "true");
      const place = page.getByRole("link", { name: "GitHub (opens in a new tab)", exact: true });
      await expect(place).toBeInViewport();
      // A trial click checks that neither the new veil nor moving sheet covers
      // the unfolded link, without navigating away to an external service.
      await place.click({ trial: true });
      expectHeaderAt(await headerGeometry(page), initial);

      await page.evaluate(() => {
        const owner = matchMedia("(max-width: 760px)").matches
          ? document.scrollingElement
          : document.querySelector(".page-wrap");
        owner?.dispatchEvent(new Event("overlay-scrollbar-drag-end"));
      });
      await expect(page.locator(".panel-shell")).toHaveCSS("transform", "none");
      expectHeaderAt(await headerGeometry(page), initial);
    });
  }
}

test("a wrapped mobile bookshelf header reserves its height before the first shelf", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bookshelf");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-size-root", "2.4rem");
    return document.fonts.ready;
  });
  await expect(page.locator("html")).toHaveCSS("font-size", "38.4px");
  const geometry = await page.evaluate(() => {
    const header = document.querySelector(".about-template__letterhead");
    const book = document.querySelector(".book__volume");
    if (!header || !book) throw new Error("The header and first shelf need reserved boxes");
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      bookTop: book.getBoundingClientRect().top,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.bookTop).toBeGreaterThanOrEqual(geometry.headerBottom);
  expect(geometry.documentWidth).toBeLessThanOrEqual(390);
  const initial = await headerGeometry(page);
  expect(await scrollContent(page)).toBeGreaterThan(0);
  expectHeaderAt(await headerGeometry(page), initial);
  await page.locator("[data-search-input]").fill("foundation");
  await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(1);
});
