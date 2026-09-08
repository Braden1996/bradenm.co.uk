// cspell:ignore networkidle fulfill
import { expect, test, type Page } from "@playwright/test";

const drainAsset = /\/generated\/room-drain-(?:coarse|mid|fine)\.[a-f0-9]+\.png(?:\?|$)/;

async function configureDevice(page: Page, mode: "full" | "reduced" | "save-data" | "light") {
  await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
  // Make the intended quality tier independent of the CI worker's CPU count.
  await page.addInitScript((tier) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { value: tier === "light" ? 2 : 8 });
    Object.defineProperty(navigator, "deviceMemory", { value: 8 });
    Object.defineProperty(navigator, "connection", {
      value: Object.assign(new EventTarget(), {
        effectiveType: "4g",
        saveData: tier === "save-data",
      }),
    });
  }, mode);
}

async function settledRoom(page: Page, name: "letter" | "bookshelf") {
  const stage = page.locator("[data-about-rooms]");
  await expect(stage).toHaveAttribute("data-room", name);
  await expect(stage).not.toHaveAttribute("data-scrub");
  await expect(stage).not.toHaveAttribute("aria-busy");
  await expect(page.locator(`[data-about-room="${name}"]`)).toBeVisible();
}

for (const scenario of [
  { path: "/", current: "letter", next: "bookshelf", link: "Bookshelf" },
  { path: "/bookshelf", current: "bookshelf", next: "letter", link: "About" },
] as const) {
  test(`${scenario.current} stays readable while its requested scrub masks load`, async ({
    page,
  }) => {
    await configureDevice(page, "full");
    const requested: string[] = [];
    page.on("request", (request) => {
      if (drainAsset.test(request.url())) requested.push(request.url());
    });
    const { promise: released, resolve: releaseMasks } = Promise.withResolvers<void>();
    let holdMasks = false;
    await page.route(drainAsset, async (route) => {
      if (holdMasks) await released;
      await route.continue();
    });
    try {
      await page.goto(scenario.path);
      await page.waitForLoadState("networkidle");
      expect(requested).toEqual([]);
      holdMasks = true;
      const link = page.getByRole("link", { name: scenario.link, exact: true });
      await link.hover();
      await expect.poll(() => new Set(requested).size).toBe(3);
      const stage = page.locator("[data-about-rooms]");
      await expect(stage).not.toHaveAttribute("data-scrub");
      await link.click();
      await expect(stage).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("[data-room-status]")).toBeVisible();
      await expect(page.locator(`[data-about-room="${scenario.current}"]`)).toBeVisible();
      await expect(stage).toHaveAttribute("data-room", scenario.current);
      await expect(stage).not.toHaveAttribute("data-scrub");
      releaseMasks();
      await settledRoom(page, scenario.next);
      await expect(page.locator("[data-room-status]")).toBeHidden();
    } finally {
      releaseMasks();
    }
  });
}

for (const mode of ["reduced", "save-data", "light"] as const) {
  test(`${mode} room changes never request scrub masks`, async ({ page }) => {
    await configureDevice(page, mode);
    const requested: string[] = [];
    page.on("request", (request) => {
      if (drainAsset.test(request.url())) requested.push(request.url());
    });
    await page.goto("/");
    await page.getByRole("link", { name: "Bookshelf", exact: true }).hover();
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    await settledRoom(page, "bookshelf");
    await page.getByRole("link", { name: "About", exact: true }).click();
    await settledRoom(page, "letter");
    await page.waitForLoadState("networkidle");
    expect(requested).toEqual([]);
  });
}

for (const failure of ["network", "decode"] as const) {
  test(`scrub mask ${failure} failure follows the destination's native route`, async ({ page }) => {
    await configureDevice(page, "full");
    let destinationNavigations = 0;
    let failedMasks = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && new URL(request.url()).pathname === "/bookshelf") {
        destinationNavigations += 1;
      }
    });
    await page.route(drainAsset, async (route) => {
      failedMasks += 1;
      if (failure === "network") await route.abort("failed");
      else await route.fulfill({ status: 200, contentType: "image/png", body: "invalid PNG" });
    });
    await page.goto("/");
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    await settledRoom(page, "bookshelf");
    expect(failedMasks).toBeGreaterThan(0);
    expect(destinationNavigations).toBe(1);
    await expect(page).toHaveURL(/\/bookshelf$/);
    // A native destination starts with just its own complete server-rendered room.
    await expect(page.locator('[data-about-room="letter"]')).toHaveCount(0);
  });
}
