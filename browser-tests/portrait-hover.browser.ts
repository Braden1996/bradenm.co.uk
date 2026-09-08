// cspell:ignore networkidle
import { expect, test, type Page } from "@playwright/test";

async function displacedDots(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-about-portrait-canvas]");
    const gl = canvas?.getContext("webgl2");
    if (!gl) throw new Error("Portrait context is unavailable");
    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const framebuffer = gl.createFramebuffer();
    try {
      // Unit five holds the actual per-dot positions, encoded around 32767.
      gl.activeTexture(gl.TEXTURE5);
      const positions = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, positions, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Portrait position texture is unavailable");
      const pixels = new Uint8Array(400 * 207 * 4);
      gl.readPixels(0, 0, 400, 207, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let displaced = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const x = (pixels[index] ?? 0) * 256 + (pixels[index + 1] ?? 0);
        const y = (pixels[index + 2] ?? 0) * 256 + (pixels[index + 3] ?? 0);
        if (x !== 32767 || y !== 32767) displaced++;
      }
      return displaced;
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
      gl.deleteFramebuffer(framebuffer);
      gl.activeTexture(activeTexture);
    }
  });
}

test("hover parts the portrait dots without pressing, then they spring home", async ({ page }) => {
  // Keep the image fixed so only the kinetic cursor can move these dots.
  await page.route("**/*.mp4*", (route) => route.abort());
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const portrait = page.locator(".about-portrait");
  await portrait.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-about-portrait]")).toHaveAttribute("data-motion-ready", "true");
  await expect.poll(() => displacedDots(page)).toBe(0);
  const box = await page.locator("[data-about-portrait-canvas]").boundingBox();
  if (!box) throw new Error("Portrait geometry is unavailable");
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.6);
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.6, { steps: 12 });
  await expect.poll(() => displacedDots(page)).toBeGreaterThan(20);
  await page.mouse.move(0, 0);
  await expect.poll(() => displacedDots(page), { timeout: 5_000 }).toBe(0);
});
