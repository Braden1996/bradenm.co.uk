import { expect, type Page } from "@playwright/test";
import sharp from "sharp";

/** The largest single-channel difference between two screenshots of the same size. */
export async function largestChannelDifference(before: Buffer, after: Buffer) {
  const [previous, current] = await Promise.all(
    [before, after].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })),
  );
  if (!previous || !current) throw new Error("Both screenshots must decode");
  expect(current.info).toEqual(previous.info);
  return previous.data.reduce(
    (maximum, channel, index) => Math.max(maximum, Math.abs(channel - (current.data[index] ?? 0))),
    0,
  );
}

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
