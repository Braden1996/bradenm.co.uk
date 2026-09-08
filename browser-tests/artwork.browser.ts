// cspell:ignore networkidle
import { expect, test } from "@playwright/test";
import sharp from "sharp";

for (const tier of ["full", "light"] as const) {
  test(`activating the ${tier} portrait preserves its printed tone and geometry`, async ({
    page,
  }) => {
    await page.addInitScript(
      (cores) => {
        Object.defineProperty(navigator, "hardwareConcurrency", { get: () => cores });
      },
      tier === "full" ? 8 : 4,
    );
    // Hold the known still so this compares printing, not a later animation pose.
    await page.route("**/*.mp4*", (route) => route.abort());
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const portrait = page.locator(".about-portrait");
    const before = await portrait.screenshot();
    const rectangle = await portrait.boundingBox();
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-about-portrait]");
      const poster = root?.querySelector<HTMLElement>(".about-portrait__poster");
      const canvas = root?.querySelector<HTMLElement>(".about-portrait__canvas");
      if (!root || !poster || !canvas) throw new Error("Missing portrait layers");
      root.dataset.testInkOverlap = "false";
      const sample = () => {
        const stillOpacity = Number(getComputedStyle(poster).opacity);
        const liveOpacity = Number(getComputedStyle(canvas).opacity);
        if (stillOpacity + liveOpacity > 1.01) root.dataset.testInkOverlap = "true";
        if (stillOpacity > 0 || liveOpacity < 1) requestAnimationFrame(sample);
        else root.dataset.testHandoffComplete = "true";
      };
      requestAnimationFrame(sample);
    });
    await portrait.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-about-portrait]")).toHaveAttribute(
      "data-motion-ready",
      "true",
    );
    await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "0");
    await expect(page.locator("[data-about-portrait]")).toHaveAttribute(
      "data-test-handoff-complete",
      "true",
    );
    await expect(page.locator("[data-about-portrait]")).toHaveAttribute(
      "data-test-ink-overlap",
      "false",
    );
    const after = await portrait.screenshot();
    expect(await portrait.boundingBox()).toEqual(rectangle);

    // Compare local printed tone, allowing individual antialiased marks to
    // resolve differently in the compressed poster and device-pixel canvas.
    const [staticPrint, livePrint] = await Promise.all(
      [before, after].map((png) => sharp(png).blur(3).removeAlpha().raw().toBuffer()),
    );
    if (!staticPrint || !livePrint) throw new Error("Missing portrait comparison");
    expect(staticPrint.length).toBe(livePrint.length);
    let difference = 0;
    for (let index = 0; index < staticPrint.length; index += 1) {
      difference += Math.abs((staticPrint[index] ?? 0) - (livePrint[index] ?? 0));
    }
    expect(difference / staticPrint.length).toBeLessThan(4);
  });
}

test("portrait semantics follow motion preferences without hiding its print", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const portrait = page.locator(".about-portrait");
  await expect(portrait).toHaveAttribute("role", "img");
  await expect(portrait).not.toHaveAttribute("tabindex");
  await expect(portrait).toHaveAttribute("aria-label", /Braden smiling/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(portrait).toHaveAttribute("role", "button");
  await expect(portrait).toHaveAttribute("tabindex", "0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(portrait).toHaveAttribute("role", "img");
  await expect(portrait).not.toHaveAttribute("tabindex");
  await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "1");
});

test("keyboard approach loads only the dog's current pose before activation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const dog = page.locator("[data-signature-dog]");
  const assets = await dog.evaluate((button) => {
    const asset = (name: string) => new URL(button.getAttribute(name) ?? "", location.href).href;
    return {
      seated: asset("data-dog-seated"),
      lying: asset("data-dog-lying"),
      transition: asset("data-dog-transition"),
      motion: asset("data-dog-motion"),
    };
  });
  await dog.focus();
  await expect(dog).toHaveAttribute("data-dog-canvas", "ready");
  expect(requests).toContain(assets.seated);
  for (const asset of [assets.lying, assets.transition, assets.motion]) {
    expect(requests).not.toContain(asset);
  }
  await page.keyboard.press("Enter");
  await expect(dog).toHaveAttribute("aria-pressed", "true");
  await expect(dog).toHaveAttribute("data-dog-state", "lying");
  expect(requests).toContain(assets.lying);
  expect(requests).toContain(assets.transition);
});

test("the reduced-motion dog changes pose without motion assets", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const dog = page.locator("[data-signature-dog]");
  const motionAssets = await dog.evaluate((button) =>
    ["data-dog-seated", "data-dog-lying", "data-dog-transition", "data-dog-motion"].map(
      (name) => new URL(button.getAttribute(name) ?? "", location.href).href,
    ),
  );
  await dog.focus();
  await page.keyboard.press("Enter");
  await expect(dog).toHaveAttribute("data-dog-static-pose", "lying");
  await expect(dog).toHaveAttribute("aria-label", "Ask the dog to sit up");
  await page.keyboard.press("Enter");
  await expect(dog).toHaveAttribute("data-dog-static-pose", "seated");
  await page.waitForLoadState("networkidle");
  for (const asset of motionAssets) expect(requests).not.toContain(asset);
});

test("the portrait draws its pending first frame after a tab pause", async ({ page }) => {
  // A failed video leaves the packed still as the only possible first canvas frame.
  await page.route("**/*.mp4", (route) => route.abort());
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    let hold = true;
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        if (hold) document.documentElement.dataset.testHeldFrame = "true";
        else callback(time);
      });
    document.addEventListener("test:resume-frames", () => {
      hold = false;
    });
  });
  const canvas = page.locator("[data-about-portrait-canvas]");
  const initialWidth = await canvas.getAttribute("width");
  await page.locator(".about-portrait").focus();
  await page.keyboard.press("Enter");
  // Renderer allocation precedes queuing its first source upload and draw.
  await expect(canvas).not.toHaveAttribute("width", initialWidth ?? "");
  await expect(page.locator("html")).toHaveAttribute("data-test-held-frame", "true");
  await expect(page.locator("[data-about-portrait]")).not.toHaveAttribute("data-motion-ready");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("test:resume-frames"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-about-portrait]")).toHaveAttribute("data-motion-ready", "true");
  await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "0");
});
