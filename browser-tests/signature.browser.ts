// cspell:ignore domcontentloaded fulfill
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const signatureSelector = ".signature__art";

async function printedInk(screenshot: Buffer) {
  const { width, height } = await sharp(screenshot).metadata();
  // The centre of the name contains only handwriting. Leave the painted
  // landscape and independently interactive dog outside the measurement.
  const pixels = await sharp(screenshot)
    .extract({
      left: Math.ceil(width * 0.3),
      top: Math.ceil(height * 0.2),
      width: Math.floor(width * 0.5),
      height: Math.floor(height * 0.65),
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  let ink = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    if (Math.max(pixels[index] ?? 255, pixels[index + 1] ?? 255, pixels[index + 2] ?? 255) < 150) {
      ink += 1;
    }
  }
  return ink / (pixels.length / 3);
}

async function decodedSignature(page: Page) {
  await expect
    .poll(() =>
      page
        .locator(signatureSelector)
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
}

for (const scriptsBlocked of [false, true]) {
  test(`signature draws and restarts on refresh${scriptsBlocked ? " with scripts blocked" : ""}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (scriptsBlocked) {
      await page.route("**/*", (route) =>
        route.request().resourceType() === "script" ? route.abort() : route.continue(),
      );
    }
    let delivery = Promise.withResolvers<void>();
    await page.route("**/generated/signature-drawn-*.svg", async (route) => {
      const response = await route.fetch();
      await delivery.promise;
      await route.fulfill({ response });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const signature = page.locator(signatureSelector);
    await signature.scrollIntoViewIfNeeded();
    const initialBox = await signature.boundingBox();
    if (!initialBox) throw new Error("The signature must reserve its box before its image loads");
    delivery.resolve();
    await decodedSignature(page);
    const early = await signature.screenshot();
    await page.waitForTimeout(2800);
    const middle = await signature.screenshot();
    await page.waitForTimeout(3000);
    const complete = await signature.screenshot();
    expect(await signature.boundingBox()).toEqual(initialBox);

    // Compare the finished animation with its independent, complete image.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => signature.evaluate((image: HTMLImageElement) => image.currentSrc))
      .toMatch(/signature-still-.*\.webp$/);
    await decodedSignature(page);
    const stillInk = await printedInk(await signature.screenshot());
    const earlyInk = await printedInk(early);
    const middleInk = await printedInk(middle);
    const completeInk = await printedInk(complete);
    expect(stillInk).toBeGreaterThan(0.005);
    expect(earlyInk).toBeLessThan(stillInk * 0.15);
    expect(middleInk).toBeGreaterThan(stillInk * 0.1);
    expect(middleInk).toBeLessThan(stillInk * 0.9);
    expect(completeInk).toBeGreaterThan(stillInk * 0.9);
    expect(completeInk).toBeLessThan(stillInk * 1.1);
    expect(await signature.boundingBox()).toEqual(initialBox);
    await testInfo.attach("signature-early", { body: early, contentType: "image/png" });
    await testInfo.attach("signature-middle", { body: middle, contentType: "image/png" });
    await testInfo.attach("signature-complete", { body: complete, contentType: "image/png" });

    delivery = Promise.withResolvers<void>();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await signature.scrollIntoViewIfNeeded();
    delivery.resolve();
    await decodedSignature(page);
    expect(await printedInk(await signature.screenshot())).toBeLessThan(stillInk * 0.15);
    expect(await signature.boundingBox()).toEqual(initialBox);
  });
}

for (const media of ["reduced motion", "print"] as const) {
  test(`${media} shows the complete signature immediately`, async ({ page }) => {
    await page.emulateMedia(
      media === "print"
        ? { media: "print", reducedMotion: "no-preference" }
        : { media: "screen", reducedMotion: "reduce" },
    );
    const animatedRequests: string[] = [];
    page.on("request", (request) => {
      if (/signature-drawn-.*\.svg$/.test(request.url())) animatedRequests.push(request.url());
    });
    await page.goto("/");
    await decodedSignature(page);
    const signature = page.locator(signatureSelector);
    expect(await signature.evaluate((image: HTMLImageElement) => image.currentSrc)).toMatch(
      /signature-still-.*\.webp$/,
    );
    expect(await printedInk(await signature.screenshot())).toBeGreaterThan(0.005);
    expect(animatedRequests).toEqual([]);
  });
}
