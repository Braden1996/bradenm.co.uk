// cspell:ignore networkidle
import { expect, test, type Page } from "@playwright/test";

const motionAsset =
  /portrait-packed|portrait-correspondence|glyph-atlas|prop-support|room-drain-|signature-dog-(?:seated|lying|transition|motion)\.[a-f0-9]+\.(?:webp|png)/;

async function settledRoom(page: Page, room: "letter" | "bookshelf") {
  const stage = page.locator("[data-about-rooms]");
  await expect(stage).toHaveAttribute("data-room", room);
  await expect(stage).not.toHaveAttribute("data-scrub");
  await expect(stage).not.toHaveAttribute("aria-busy");
}

test("confirmed WebGL failure makes later dog and room interactions static", async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line typescript/unbound-method -- The wrapper forwards the calling canvas with Function.call.
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(
        this: HTMLCanvasElement,
        contextId: string,
        options?: CanvasRenderingContext2DSettings | WebGLContextAttributes,
      ) {
        if (contextId === "webgl2") return null;
        return original.call(this, contextId, options);
      },
    });
  });
  const requested: string[] = [];
  page.on("request", (request) => {
    if (motionAsset.test(request.url())) requested.push(request.url());
  });
  await page.goto("/");
  const portrait = page.locator(".about-portrait");
  await portrait.focus();
  await page.keyboard.press("Enter");
  await expect(portrait).toHaveAttribute("data-enhancement-unavailable");
  await expect(portrait).toHaveAttribute("role", "img");
  const dog = page.locator("[data-signature-dog]");
  await dog.focus();
  await page.keyboard.press("Enter");
  await expect(dog).toHaveAttribute("data-dog-static-pose", "lying");
  await expect(dog).not.toHaveAttribute("data-dog-canvas");
  await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
  await settledRoom(page, "bookshelf");
  await page.getByRole("link", { name: "About", exact: true }).click();
  await settledRoom(page, "letter");
  await page.waitForLoadState("networkidle");
  await expect(dog).toHaveAttribute("aria-pressed", "true");
  expect(requested).toEqual([]);
});

test("a failed portrait asset does not disable the independent dog artwork", async ({ page }) => {
  await page.route("**/*glyph-atlas*", (route) => route.abort("failed"));
  await page.goto("/");
  const portrait = page.locator(".about-portrait");
  await portrait.focus();
  await page.keyboard.press("Enter");
  await expect(portrait).toHaveAttribute("data-enhancement-unavailable");
  await expect(portrait).toHaveAttribute("role", "img");
  const dog = page.locator("[data-signature-dog]");
  await dog.focus();
  await expect(dog).toHaveAttribute("data-dog-canvas", "ready");
});

test("a late portrait import waits for its cached room to become active again", async ({
  page,
}) => {
  const { promise: released, resolve: releasePortrait } = Promise.withResolvers<void>();
  let heldImports = 0;
  const portraitAssets: string[] = [];
  page.on("request", (request) => {
    if (/portrait-packed|portrait-correspondence|glyph-atlas|prop-support/.test(request.url())) {
      portraitAssets.push(request.url());
    }
  });
  await page.route(/\/about-portrait\.[^/]+\.js(?:\?|$)/, async (route) => {
    heldImports += 1;
    await released;
    await route.continue();
  });
  try {
    await page.goto("/");
    await page.locator(".about-portrait").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => heldImports).toBe(1);
    await page.getByRole("link", { name: "Bookshelf", exact: true }).click();
    await settledRoom(page, "bookshelf");
    releasePortrait();
    await page.waitForLoadState("networkidle");
    expect(portraitAssets).toEqual([]);
    await expect(page.locator("[data-about-portrait]")).not.toHaveAttribute("data-motion-ready");
    await page.getByRole("link", { name: "About", exact: true }).click();
    await settledRoom(page, "letter");
    await expect(page.locator("[data-about-portrait]")).toHaveAttribute(
      "data-motion-ready",
      "true",
    );
  } finally {
    releasePortrait();
  }
});
