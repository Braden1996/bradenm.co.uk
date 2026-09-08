import { expect, test } from "bun:test";
import sharp from "sharp";
import { getSignatureAssets } from "../src/features/about/lib/signature-assets";

test("responsive signature retains both complete original layers", async () => {
  const assets = await getSignatureAssets();
  const [expected, actual] = await Promise.all([
    sharp("public/about/signature/landscape.webp")
      .composite([{ input: "public/about/signature/lettering.webp" }])
      .ensureAlpha()
      .raw()
      .toBuffer(),
    sharp(assets.still1000.bytes).ensureAlpha().raw().toBuffer(),
  ]);
  expect(actual.equals(expected)).toBe(true);
  const small = await sharp(assets.still480.bytes).metadata();
  expect(small.width).toBe(480);
  expect(small.hasAlpha).toBe(true);
  expect(assets.still480.bytes.length).toBeLessThan(assets.still1000.bytes.length / 3);
});

test("static dog poses preserve the exact neutral atlas frames without downloading an atlas", async () => {
  const assets = await getSignatureAssets();
  await Promise.all(
    [
      [assets.seated, assets.seatedFallback],
      [assets.lying, assets.lyingFallback],
    ].map(async ([atlas, fallback]) => {
      if (!atlas || !fallback) throw new Error("Missing generated pose");
      const [expected, actual] = await Promise.all([
        sharp(atlas.bytes)
          .extract({ left: 150, top: 360, width: 150, height: 180 })
          .ensureAlpha()
          .raw()
          .toBuffer(),
        sharp(fallback.bytes).ensureAlpha().raw().toBuffer(),
      ]);
      expect(actual.equals(expected)).toBe(true);
      expect(fallback.bytes.length).toBeLessThan(atlas.bytes.length / 10);
      expect(fallback.url).toMatch(/^\/generated\/signature-dog-.*\.[0-9a-f]{12}\.webp$/);
    }),
  );
});
