import { expect, type Page } from "@playwright/test";

export async function warmAtlas(page: Page): Promise<number> {
  await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
    "data-bookshelf-initialized",
    "true",
  );
  const stage = page.locator("[data-atlas-stage]");
  await expect(stage).toBeVisible();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("Atlas warmup needs its reserved stage geometry");
  // Leave any position retained through navigation, then enter the empty stage corner.
  await page.mouse.move(0, 0);
  const intentAt = await page.evaluate(() => performance.now());
  await page.mouse.move(bounds.x + 4, bounds.y + 4);
  return intentAt;
}
