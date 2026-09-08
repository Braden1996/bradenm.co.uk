import { expect, test, type Page } from "@playwright/test";

async function letterGeometry(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".page-wrap");
    const tail = wrap?.querySelector<HTMLElement>("[data-paper-scroll-tail]");
    const wash = wrap?.querySelector<HTMLElement>("[data-paper-foot-wash]");
    const illustration = document.querySelector<HTMLElement>(".about-intro__visual");
    const signature = document.querySelector<HTMLElement>(".about-passage__signature");
    const veil = document.querySelector<HTMLElement>(".about-template__veil");
    const owner = matchMedia("(max-width: 760px)").matches ? document.scrollingElement : wrap;
    if (!wrap || !tail || !wash || !illustration || !signature || !veil || !owner) {
      throw new Error("The letter needs its illustration, signature, header, and paper viewport");
    }
    return {
      illustrationTop: illustration.getBoundingClientRect().top,
      veilBottom: veil.getBoundingClientRect().bottom,
      signatureBottom: signature.getBoundingClientRect().bottom,
      washTop: wash.getBoundingClientRect().top,
      washBottom: wash.getBoundingClientRect().bottom,
      scrollTop: owner.scrollTop,
      contentBottom: owner.scrollHeight - owner.clientHeight - tail.offsetHeight,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      paperOverflow: wrap.scrollWidth - wrap.clientWidth,
      viewportHeight: innerHeight,
    };
  });
}

function expectClearFooter(geometry: Awaited<ReturnType<typeof letterGeometry>>) {
  expect(geometry.washTop - geometry.signatureBottom).toBeGreaterThanOrEqual(24);
  expect(Math.abs(geometry.washBottom - geometry.viewportHeight)).toBeLessThanOrEqual(1);
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.paperOverflow).toBeLessThanOrEqual(1);
}

for (const viewport of [
  { width: 1783, height: 1181 },
  { width: 1350, height: 940 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}×${viewport.height} fits the letter between the header fade and footer`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
    await page.evaluate(() => document.fonts.ready);

    const initial = await letterGeometry(page);
    expect(initial.scrollTop).toBe(0);
    expect(initial.contentBottom).toBeLessThanOrEqual(1);
    expect(initial.illustrationTop).toBeGreaterThanOrEqual(initial.veilBottom - 1);
    expectClearFooter(initial);
    await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
    await expect(page.locator(".panel-shell")).toHaveCSS("transform", "none");
  });
}

for (const viewport of [
  { width: 1350, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`${viewport.width}×${viewport.height} scrolls the signature clear of the resting footer`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-paper-overscroll-ready", "true");
    await page.evaluate(() => document.fonts.ready);

    const initial = await letterGeometry(page);
    expect(initial.illustrationTop).toBeGreaterThanOrEqual(initial.veilBottom - 1);
    expect(initial.contentBottom).toBeGreaterThan(0);
    await page.evaluate(async (bottom) => {
      const owner = matchMedia("(max-width: 760px)").matches
        ? document.scrollingElement
        : document.querySelector(".page-wrap");
      if (!owner) throw new Error("The letter needs a native scroll owner");
      owner.scrollTo({ top: bottom, behavior: "instant" });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, initial.contentBottom);

    const bottom = await letterGeometry(page);
    expect(Math.abs(bottom.scrollTop - bottom.contentBottom)).toBeLessThanOrEqual(1);
    expectClearFooter(bottom);
    await expect(page.locator("[data-paper-foot-wash]")).toHaveCSS("opacity", "1");
    await expect(page.locator(".panel-shell")).toHaveCSS("transform", "none");
  });
}
