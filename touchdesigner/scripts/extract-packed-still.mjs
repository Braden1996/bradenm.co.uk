// cspell:words bunx
// Decode the reference through the runtime's own immutable frame loader, then
// preserve its pixels losslessly so playback cannot re-ink the resting pose.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: {
    source: {
      type: "string",
      default: "images/source/about-motion/packed/portrait-packed.mp4",
    },
    out: {
      type: "string",
      default: "images/source/about-motion/packed/portrait-packed-still.webp",
    },
    frame: { type: "string", default: "6" },
    check: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Extract the packed reference frame with the production browser decoder.

Usage: bun touchdesigner/scripts/extract-packed-still.mjs [options]
  --source PATH  Packed 2400×800 MP4 (default: the committed portrait video)
  --out PATH     Lossless WebP destination (default: the committed packed still)
  --frame INDEX  Zero-based source frame, 0–47 (default: 6)
  --check        Verify the existing output without writing it
  --help         Show this usage information

Install the pinned browser with bunx playwright install chromium.
CHROME_PATH can select another installed Chromium executable.`);
  process.exit(0);
}

const frame = Number(args.frame);
if (!Number.isInteger(frame) || frame < 0 || frame > 47) {
  throw new Error("--frame must be an integer between 0 and 47");
}
const outputPath = path.resolve(ROOT, args.out);
if (path.extname(outputPath).toLowerCase() !== ".webp") {
  throw new Error("--out must name a WebP file");
}
const source = Bun.file(path.resolve(ROOT, args.source));
if (!(await source.exists())) throw new Error(`Missing packed video: ${args.source}`);
const bundle = await Bun.build({
  entrypoints: [path.join(ROOT, "src/features/about/client/video-frame-decoder.ts")],
  target: "browser",
  format: "esm",
});
if (!bundle.success) throw new AggregateError(bundle.logs, "Could not bundle the frame decoder");
const decoderBundle = bundle.outputs[0];
if (!decoderBundle) throw new Error("Frame decoder bundle is empty");

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") {
      return new Response(
        "<!doctype html><html><title>Portrait reference extraction</title></html>",
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
    if (pathname === "/decoder.js") {
      return new Response(decoderBundle, {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }
    if (pathname === "/source.mp4") return new Response(source);
    return new Response("Not found", { status: 404 });
  },
});

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/`);
  const snapshots = await page.evaluate(async (frameIndex) => {
    const { createVideoFrameDecoder } = await import("/decoder.js");
    const decoder = createVideoFrameDecoder("/source.mp4", 12);
    try {
      const bitmaps = await Promise.all([
        decoder.decode(frameIndex, 0),
        decoder.decode(frameIndex, 1),
      ]);
      return bitmaps.map((bitmap) => {
        try {
          if (bitmap.width !== 2400 || bitmap.height !== 800) {
            throw new Error("The packed source frame must be 2400×800");
          }
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create a source extraction canvas");
          context.drawImage(bitmap, 0, 0);
          return canvas.toDataURL("image/png");
        } finally {
          bitmap.close();
        }
      });
    } finally {
      decoder.destroy();
    }
  }, frame);
  const pngs = snapshots.map((snapshot) => Buffer.from(snapshot.split(",")[1], "base64"));
  const pixels = await Promise.all(pngs.map((png) => sharp(png).ensureAlpha().raw().toBuffer()));
  if (!pixels[0]?.equals(pixels[1])) {
    throw new Error("The independent video decoders returned different reference pixels");
  }
  const webp = args.check
    ? await fs.readFile(outputPath)
    : await sharp(pngs[0]).webp({ lossless: true, effort: 6 }).toBuffer();
  const decoded = await sharp(webp).ensureAlpha().raw().toBuffer();
  if (!pixels[0].equals(decoded)) {
    throw new Error("The packed still differs from the browser-decoded reference frame");
  }
  if (!args.check) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, webp);
  }
  console.log(
    `${args.check ? "Verified" : "Wrote"} ${outputPath}: frame ${frame}, exact decoded pixels, ${webp.length} bytes`,
  );
} finally {
  await browser?.close();
  await server.stop(true);
}
