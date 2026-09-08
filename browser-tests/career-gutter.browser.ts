import { expect, test, type Locator } from "@playwright/test";

async function noteGeometry(card: Locator) {
  return card.evaluate((element) => {
    const body = element.querySelector("[data-career-card-body]");
    const heading = element.querySelector(".career-card__org");
    const visit = element.querySelector(".career-card__visit");
    const passage = document.querySelector("[data-about-passage]");
    const wash = document.querySelector("[data-paper-foot-wash]");
    const veil = document.querySelector(".about-template__veil");
    if (!body || !heading || !visit || !passage || !wash || !veil) {
      throw new Error("The note must be complete");
    }
    return {
      card: element.getBoundingClientRect().toJSON(),
      body: body.getBoundingClientRect().toJSON(),
      heading: heading.getBoundingClientRect().toJSON(),
      visit: visit.getBoundingClientRect().toJSON(),
      passage: passage.getBoundingClientRect().toJSON(),
      washTop: wash.getBoundingClientRect().top,
      veilBottom: veil.getBoundingClientRect().bottom,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });
}

for (const viewport of [
  { width: 1336, height: 1006 },
  { width: 1100, height: 800 },
]) {
  test(`long gutter notes use the available height at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-career-entity][href="#career-card-garrys-mod"]').click();
    const frame = page.locator("[data-career-popover]");
    await expect(frame).toHaveAttribute("data-state", "open");
    await expect(frame).toHaveAttribute("data-placement", "left");
    const card = frame.locator("[data-popover-layer=active]");
    const geometry = await noteGeometry(card);

    expect(geometry.card.top).toBeGreaterThanOrEqual(28);
    expect(geometry.heading.top).toBeGreaterThanOrEqual(geometry.veilBottom);
    expect(geometry.card.bottom).toBeLessThanOrEqual(viewport.height - 64);
    expect(geometry.card.right).toBeLessThan(geometry.passage.left);
    expect(geometry.scrollHeight - geometry.clientHeight).toBeLessThanOrEqual(1);
    expect(geometry.card.height).toBeGreaterThan(420);
    expect(geometry.visit.left).toBeCloseTo(geometry.heading.left, 1);
    expect(geometry.visit.left).toBeCloseTo(geometry.body.left, 1);
    expect(geometry.visit.top - geometry.body.bottom).toBeGreaterThan(0);
    expect(geometry.visit.top - geometry.body.bottom).toBeLessThan(24);
    expect(geometry.visit.bottom).toBeLessThan(geometry.washTop - 12);
    await page.screenshot({ path: `artifacts/career-gutters/desktop-${viewport.width}.png` });

    await page.locator('[data-career-entity][href="#career-card-isembard"]').click();
    await expect(frame).toHaveAttribute("data-placement", "right");
    const short = await noteGeometry(frame.locator("[data-popover-layer=active]"));
    expect(short.card.height).toBeLessThan(geometry.card.height);
    expect(short.scrollHeight - short.clientHeight).toBeLessThanOrEqual(1);
    expect(short.visit.left).toBeCloseTo(short.heading.left, 1);
  });
}

test("a short desktop window scrolls the note while keeping its website visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1336, height: 400 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const trigger = page.locator('[data-career-entity][href="#career-card-garrys-mod"]');
  await trigger.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await trigger.click();
  const card = page.locator("[data-popover-layer=active]");
  const geometry = await noteGeometry(card);
  expect(geometry.card.top).toBeGreaterThanOrEqual(28);
  expect(geometry.heading.top).toBeGreaterThanOrEqual(geometry.veilBottom);
  expect(geometry.card.bottom).toBeLessThanOrEqual(336);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.visit.bottom).toBeLessThan(geometry.washTop - 12);
  const body = card.locator("[data-career-card-body]");
  await body.focus();
  await page.keyboard.press("End");
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(body.locator("li").last()).toBeInViewport();
  await page.screenshot({ path: "artifacts/career-gutters/short-desktop.png" });
});

test("the long phone note retains a usable website link and keyboard dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.locator('[data-career-entity][href="#career-card-garrys-mod"]');
  await trigger.click();
  const modal = page.locator("[data-career-modal]");
  await expect(modal).toBeVisible();
  const geometry = await noteGeometry(modal.locator("[data-popover-layer=active]"));
  expect(geometry.visit.height).toBeGreaterThanOrEqual(44);
  expect(geometry.visit.left).toBeCloseTo(geometry.body.left, 1);
  expect(geometry.visit.bottom).toBeLessThan(640);
  await page.screenshot({ path: "artifacts/career-gutters/phone.png" });
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
