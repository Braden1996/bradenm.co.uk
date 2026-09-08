// cspell:ignore networkidle domcontentloaded
import { expect, test } from "@playwright/test";

test("search preserves input entered before its initial controller finishes loading", async ({
  page,
}) => {
  const { promise: requested, resolve: requestedModule } = Promise.withResolvers<void>();
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/_astro/bookshelf.*.js", async (route) => {
    requestedModule();
    await released;
    await route.continue();
  });
  try {
    await page.goto("/bookshelf", { waitUntil: "domcontentloaded" });
    await requested;
    const input = page.locator("[data-search-input]");
    await input.fill("foundation");
    await expect(page.locator("[data-bookshelf-root]")).not.toHaveAttribute(
      "data-bookshelf-initialized",
    );
    release();
    await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
      "data-bookshelf-initialized",
      "true",
    );
    await expect(input).toHaveValue("foundation");
    await expect(page.locator("[data-book-card]:not([hidden])")).toHaveCount(1);
    await expect(page.locator("[data-book-card]:not([hidden]) .atlas-book__caption")).toContainText(
      "Foundation",
    );
  } finally {
    release();
  }
});

test("prefetch and click share a request while the current room stays readable", async ({
  page,
}) => {
  await page.goto("/");
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  let fetches = 0;
  await page.route("**/bookshelf", async (route) => {
    if (route.request().resourceType() === "fetch") {
      fetches += 1;
      await released;
    }
    await route.continue();
  });
  try {
    const link = page.getByRole("link", { name: "Bookshelf", exact: true });
    await link.hover();
    await link.click();
    await expect(page.locator("[data-room-status]")).toHaveText("Loading bookshelf…");
    await expect(page.locator('[data-about-room="letter"]')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    release();
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "bookshelf");
    await expect(page.locator("[data-room-status]")).toBeHidden();
    expect(fetches).toBe(1);
  } finally {
    release();
  }
});

test("a room is not revealed before its bookshelf stylesheet has loaded", async ({ page }) => {
  await page.goto("/");
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/_astro/bookshelf.*.css", async (route) => {
    await released;
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    await expect(page.locator("[data-room-status]")).toBeVisible();
    await expect(page.locator('[data-about-room="letter"]')).toBeVisible();
    await expect(page.locator('[data-about-room="bookshelf"]')).toHaveCount(0);
    release();
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "bookshelf");
    await expect(page.locator('[data-about-room="bookshelf"]')).toBeVisible();
  } finally {
    release();
  }
});

test("cancelled feature imports do not initialize the inactive room", async ({ page }) => {
  await page.goto("/bookshelf");
  const { promise: requested, resolve: requestedModule } = Promise.withResolvers<void>();
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/_astro/signature-dog.*.js", async (route) => {
    requestedModule();
    await released;
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "About", exact: true }).click();
    await requested;
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    release();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "bookshelf");
    const portrait = page.locator(".about-portrait");
    await expect(portrait).toHaveAttribute("role", "img");
    await expect(portrait).not.toHaveAttribute("tabindex");
    await page.getByRole("link", { name: "About", exact: true }).click();
    await expect(page.locator("[data-about-rooms]")).toHaveAttribute("data-room", "letter");
    await expect(portrait).toHaveAttribute("role", "button");
    await expect(portrait).toHaveAttribute("tabindex", "0");
  } finally {
    release();
  }
});

test("room changes replace history and keep route metadata in sync", async ({ page }) => {
  await page.goto("/");
  const historyLength = await page.evaluate(() => history.length);
  /* eslint-disable no-await-in-loop -- Each room change must settle before checking the next history replacement. */
  for (const [name, path, title] of [
    ["Bookshelf", "/bookshelf/", "Bookshelf | Braden Marshall"],
    ["About", "/", "Braden Marshall"],
    ["Bookshelf", "/bookshelf/", "Bookshelf | Braden Marshall"],
  ] as const) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://bradenm.co.uk${path}`,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", title);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  }
  /* eslint-enable no-await-in-loop */
});

test("modified, targeted, download, and already handled links keep their native behavior", async ({
  page,
}) => {
  await page.goto("/");
  const prevented = await page
    .getByRole("link", { name: "Bookshelf", exact: true })
    .evaluate((link) => {
      const outcomes: boolean[] = [];
      for (const kind of ["modified", "target", "download", "handled"]) {
        if (kind === "target") link.setAttribute("target", "_blank");
        if (kind === "download") link.setAttribute("download", "bookshelf.html");
        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: kind === "modified",
        });
        if (kind === "handled") event.preventDefault();
        document.addEventListener(
          "click",
          (click) => {
            outcomes.push(click.defaultPrevented);
            // Observe the room handler, then suppress the native action in this test.
            click.preventDefault();
          },
          { once: true },
        );
        link.dispatchEvent(event);
        link.removeAttribute("target");
        link.removeAttribute("download");
      }
      return outcomes;
    });
  expect(prevented).toEqual([false, false, false, true]);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-about-rooms]")).not.toHaveAttribute("aria-busy");
});
