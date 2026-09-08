import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import motionMetadata from "../../../../public/about/signature/dog-motion.json";
import { generatedAsset } from "../../../components/lib/generated-asset";
import { SIGNATURE_STROKES } from "./signature-strokes";

async function drawnSignature(landscape: Buffer, lettering: Buffer, width: number) {
  const layers = await Promise.all(
    [landscape, lettering].map(async (source) =>
      (
        await sharp(source)
          .resize({ width })
          .webp({ lossless: true, exact: true, effort: 6 })
          .toBuffer()
      ).toString("base64"),
    ),
  );
  let delay = 0;
  const paths = SIGNATURE_STROKES.map((stroke) => {
    const path = `<path d="${stroke.d}" stroke-width="${stroke.width}" pathLength="1" style="--delay:${delay}ms;--duration:${stroke.duration}ms"/>`;
    delay += stroke.duration;
    return path;
  }).join("");
  // A self-contained SVG starts drawing as soon as its image loads, including
  // with scripts blocked. Embedded layers keep each responsive size one request.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${(width * 334) / 1000}" viewBox="0 0 1000 334">
<style>
@media screen and (prefers-reduced-motion: no-preference) {
  path { stroke-dasharray: 1; animation: draw var(--duration) linear var(--delay) both; }
  rect { animation: complete ${delay}ms steps(1, end) both; }
}
@keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes complete { from { opacity: 0; } to { opacity: 1; } }
</style>
<defs><mask id="ink" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="334">
<g fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
<rect width="1000" height="334" fill="white"/>
</mask></defs>
<image href="data:image/webp;base64,${layers[0]}" width="1000" height="334"/>
<image href="data:image/webp;base64,${layers[1]}" width="1000" height="334" mask="url(#ink)"/>
</svg>`;
  return generatedAsset(`signature-drawn-${width}.svg`, Buffer.from(svg), "image/svg+xml");
}

async function loadAtlas(name: "dog-seated" | "dog-lying" | "dog-sprites") {
  const source = await readFile(`public/about/signature/${name}.webp`);
  if (
    createHash("sha256").update(source).digest("hex") !== motionMetadata.sources[`${name}.webp`]
  ) {
    throw new Error("Rebuild dog motion data after exporting changed signature artwork.");
  }
  return source;
}

async function fallback(source: Buffer) {
  const metadata = await sharp(source).metadata();
  const width = metadata.width / 7;
  const height = metadata.height / 5;
  return sharp(source)
    .extract({ left: width, top: height * 2, width, height })
    .webp({ lossless: true, exact: true })
    .toBuffer();
}

async function buildSignatureAssets() {
  const [seated, lying, transition, motion, landscape, lettering] = await Promise.all([
    loadAtlas("dog-seated"),
    loadAtlas("dog-lying"),
    loadAtlas("dog-sprites"),
    readFile("public/about/signature/dog-motion.png"),
    readFile("public/about/signature/landscape.webp"),
    readFile("public/about/signature/lettering.webp"),
  ]);
  const [seatedFallback, lyingFallback] = await Promise.all([fallback(seated), fallback(lying)]);
  // Keep a complete, compact print for reduced motion and paper output.
  const still = await sharp(landscape)
    .composite([{ input: lettering }])
    .webp({ lossless: true, exact: true })
    .toBuffer();
  const stills = await Promise.all(
    [480, 640, 800, 1000].map(async (width) =>
      generatedAsset(
        `signature-still-${width}.webp`,
        await sharp(still)
          .resize({ width })
          .webp({ lossless: true, exact: true, effort: 6 })
          .toBuffer(),
        "image/webp",
      ),
    ),
  );
  const [still480, still640, still800, still1000] = stills;
  if (!still480 || !still640 || !still800 || !still1000) throw new Error("Missing signature size");
  const [drawn480, drawn640, drawn800, drawn1000] = await Promise.all(
    [480, 640, 800, 1000].map((width) => drawnSignature(landscape, lettering, width)),
  );
  if (!drawn480 || !drawn640 || !drawn800 || !drawn1000) throw new Error("Missing signature size");
  return {
    still480,
    still640,
    still800,
    still1000,
    drawn480,
    drawn640,
    drawn800,
    drawn1000,
    seated: generatedAsset("signature-dog-seated.webp", seated, "image/webp"),
    lying: generatedAsset("signature-dog-lying.webp", lying, "image/webp"),
    transition: generatedAsset("signature-dog-transition.webp", transition, "image/webp"),
    motion: generatedAsset("signature-dog-motion.png", motion, "image/png"),
    seatedFallback: generatedAsset(
      "signature-dog-seated-fallback.webp",
      seatedFallback,
      "image/webp",
    ),
    lyingFallback: generatedAsset("signature-dog-lying-fallback.webp", lyingFallback, "image/webp"),
  };
}

let pending: ReturnType<typeof buildSignatureAssets> | undefined;

export function getSignatureAssets() {
  pending ??= buildSignatureAssets();
  return pending;
}
