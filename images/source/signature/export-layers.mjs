import sharp from "sharp";
import { SIGNATURE_STROKES } from "../../../src/features/about/lib/signature-strokes.ts";

const root = new URL("../../../", import.meta.url);
const localPath = (path) => new URL(path, root).pathname;
const width = 2000;
const height = 667;
const paths = SIGNATURE_STROKES.map(
  (stroke) =>
    `<path d="${stroke.d}" stroke-width="${stroke.width}" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round"/>`,
).join("");
const mask = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 334">${paths}</svg>`,
  ),
)
  .ensureAlpha()
  .raw()
  .toBuffer();
const original = await sharp(localPath("images/source/signature.webp"))
  .ensureAlpha()
  .raw()
  .toBuffer();
const lettering = Buffer.from(original);
const misses = Buffer.alloc(original.length);
let inkPixels = 0;
let missedPixels = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const red = original[offset];
    const green = original[offset + 1];
    const blue = original[offset + 2];
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const onLandscape = x < 565 && y > 305;
    const onDog = x > 1635 && y > 340;
    const ink = high < 96 && high - low < 16;
    const maskAlpha = mask[offset + 3] / 255;
    const valid = (!onLandscape && !onDog) || ink;
    lettering[offset + 3] = valid ? Math.round(original[offset + 3] * maskAlpha) : 0;

    if (!onLandscape && !onDog && x < 1735 && original[offset + 3] > 128 && ink) {
      inkPixels++;
      if (maskAlpha < 0.5) {
        missedPixels++;
        misses[offset] = 255;
        misses[offset + 3] = 255;
      }
    }
  }
}
await sharp(lettering, { raw: { width, height, channels: 4 } })
  .resize(1000, 334)
  .webp({ lossless: true })
  .toFile(localPath("public/about/signature/lettering.webp"));
await sharp(misses, { raw: { width, height, channels: 4 } })
  .resize(1000, 334)
  .png()
  .toFile("/tmp/signature-missed-ink.png");
console.log({ inkPixels, missedPixels, coverage: 1 - missedPixels / inkPixels });

const landscape = await sharp(localPath("images/source/signature/landscape-generated.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: sourceWidth, height: sourceHeight } = landscape.info;
const visited = new Uint8Array(sourceWidth * sourceHeight);
const queue = new Int32Array(visited.length);
let head = 0;
let tail = 0;
const visit = (x, y) => {
  if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) return;
  const index = y * sourceWidth + x;
  if (visited[index]) return;
  const offset = index * 4;
  const minimum = Math.min(
    landscape.data[offset],
    landscape.data[offset + 1],
    landscape.data[offset + 2],
  );
  if (minimum < 236) return;
  visited[index] = 1;
  queue[tail++] = index;
};
for (let x = 0; x < sourceWidth; x++) {
  visit(x, 0);
  visit(x, sourceHeight - 1);
}
for (let y = 0; y < sourceHeight; y++) {
  visit(0, y);
  visit(sourceWidth - 1, y);
}
while (head < tail) {
  const index = queue[head++];
  const x = index % sourceWidth;
  const y = Math.floor(index / sourceWidth);
  visit(x - 1, y);
  visit(x + 1, y);
  visit(x, y - 1);
  visit(x, y + 1);
}
for (let index = 0; index < visited.length; index++) {
  if (visited[index]) landscape.data[index * 4 + 3] = 0;
}
const cutout = await sharp(landscape.data, {
  raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
})
  .trim({ threshold: 12 })
  .resize(275, 133, { fit: "fill" })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1000, height: 334, channels: 4, background: "#00000000" },
})
  .composite([{ input: cutout, left: 7, top: 151 }])
  .webp({ lossless: true })
  .toFile(localPath("public/about/signature/landscape.webp"));

await sharp(localPath("public/about/signature/landscape.webp"))
  .composite([{ input: localPath("public/about/signature/lettering.webp") }])
  .flatten({ background: "#fff" })
  .png()
  .toFile("/tmp/signature-layers.png");
