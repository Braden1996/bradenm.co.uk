import sharp from "sharp";
import { generatedAsset } from "./generated-asset";
import { createPaperWashImage } from "./paper-gradient";

async function buildAssets() {
  const wash = createPaperWashImage({ opacity: 0.65 });
  const washBytes = Buffer.from(wash.slice(wash.indexOf(",") + 1), "base64");
  return {
    wash: generatedAsset(
      "paper-wash.webp",
      await sharp(washBytes).webp({ lossless: true }).toBuffer(),
      "image/webp",
    ),
  };
}

let pending: ReturnType<typeof buildAssets> | undefined;

export function getPaperAssets() {
  pending ??= buildAssets();
  return pending;
}
