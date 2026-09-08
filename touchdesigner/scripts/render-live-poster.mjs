// cspell:words typogravure swiftshader bunx
// Bake the SSR portrait with the actual WebGL renderer and committed packed
// still. There is deliberately no second implementation of the print recipe.
// Run with Bun and an installed Playwright Chromium:
//   bun touchdesigner/scripts/render-live-poster.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { MEDIA_TO_STAGE_X, rearAboutBlocks } from "../../src/features/about/lib/about-blocks";
import { getPortraitGeneratedAssets } from "../../src/features/about/lib/portrait-generated-assets";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: "images/source/about-motion/rendered/poster.png" },
    width: { type: "string", default: "1800" },
    "display-width": { type: "string", default: "480" },
    frame: { type: "string" },
    "motion-preview": { type: "boolean", default: false },
    "solid-source": { type: "boolean", default: false },
    preview: { type: "boolean", default: false },
    "verify-sizes": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Render the live portrait's packed still with its production WebGL shader.

Usage: bun touchdesigner/scripts/render-live-poster.mjs [options]
  --out PATH       Transparent PNG destination (default: the committed poster)
  --width PIXELS   Cropped output width, 320–4800 (default: 1800)
  --display-width CSS_PIXELS  Media layout width, 160–2400 (default: 480)
  --frame NUMBER   Render one video frame, 1–48, instead of the packed still
  --motion-preview  Save selected poses, loop return and a contact sheet
  --solid-source   Hold tone and matte constant; omit rear paint to isolate ink
  --preview        Also write a PNG composited over the site's paper colour
  --verify-sizes   Check ink coverage at 480, 800 and 1200 CSS pixels at 1×/2×
  --help           Show this usage information

Both --out=PATH and --out PATH are supported. Install the pinned browser with:
  bunx playwright install chromium`);
  process.exit(0);
}

const outputWidth = Number(args.width);
if (!Number.isInteger(outputWidth) || outputWidth < 320 || outputWidth > 4800) {
  throw new Error("--width must be an integer between 320 and 4800 pixels");
}
const displayCssWidth = Number(args["display-width"]);
if (!Number.isFinite(displayCssWidth) || displayCssWidth < 160 || displayCssWidth > 2400) {
  throw new Error("--display-width must be between 160 and 2400 CSS pixels");
}
const outputPath = path.resolve(ROOT, args.out);
if (path.extname(outputPath).toLowerCase() !== ".png") {
  throw new Error("--out must name a PNG file so the portrait retains transparency");
}
const selectedFrame = args.frame === undefined ? null : Number(args.frame);
if (
  selectedFrame !== null &&
  (!Number.isInteger(selectedFrame) || selectedFrame < 1 || selectedFrame > 48)
) {
  throw new Error("--frame must be an integer between 1 and 48");
}
if (
  (selectedFrame !== null || args["motion-preview"] || args["solid-source"]) &&
  !process.argv.some((argument) => argument === "--out" || argument.startsWith("--out="))
) {
  throw new Error(
    "Frame and motion diagnostics require an explicit --out path to protect the SSR poster",
  );
}

const bundle = await Bun.build({
  entrypoints: [path.join(ROOT, "src/features/about/client/typogravure-renderer.ts")],
  target: "browser",
  format: "esm",
  minify: false,
});
if (!bundle.success)
  throw new AggregateError(bundle.logs, "Could not bundle the portrait renderer");
const rendererBundle = bundle.outputs[0];
if (!rendererBundle) throw new Error("Portrait renderer bundle is empty");

const packedDirectory = path.join(ROOT, "images/source/about-motion/packed");
const paint = await getPortraitGeneratedAssets();
const blockRects = Object.entries(rearAboutBlocks).map(([name, block]) => ({
  name,
  rect: [block.rect.left + MEDIA_TO_STAGE_X, block.rect.top, block.rect.width, block.rect.height],
}));
const assets = new Map([
  ["/atlas.webp", Bun.file(path.join(packedDirectory, "glyph-atlas.webp"))],
  ["/correspondence.png", Bun.file(path.join(packedDirectory, "portrait-correspondence.png"))],
  ["/still.webp", Bun.file(path.join(packedDirectory, "portrait-packed-still.webp"))],
  ["/support.png", Bun.file(path.join(packedDirectory, "prop-support.png"))],
  ["/source.mp4", Bun.file(path.join(packedDirectory, "portrait-packed.mp4"))],
]);
for (const [name, asset] of assets) {
  // eslint-disable-next-line no-await-in-loop -- Check each required input before starting the browser.
  if (!(await asset.exists())) throw new Error(`Missing portrait input: ${name}`);
}

// This isolated local server exists only for the render command. It exposes
// the bundle and its declared assets, never an arbitrary filesystem path.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/") {
      return new Response("<!doctype html><html><title>Portrait poster bake</title></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/renderer.js") {
      return new Response(rendererBundle, {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }
    if (pathname === "/green.webp" || pathname === "/blue.webp") {
      const block = pathname === "/green.webp" ? paint.green : paint.blue;
      return new Response(block.bytes, { headers: { "Content-Type": block.contentType } });
    }
    const asset = assets.get(pathname);
    return asset ? new Response(asset) : new Response("Not found", { status: 404 });
  },
});

async function renderPortrait(browser, url, cssWidth, ratio, frameNumbers = [selectedFrame]) {
  const targetWidth = Math.round(cssWidth * ratio);
  const page = await browser.newPage({
    viewport: { width: Math.ceil(cssWidth * 1.2), height: Math.ceil((cssWidth * 2) / 3) },
    deviceScaleFactor: ratio,
  });
  try {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url);
    const capture = await page.evaluate(
      async (configuration) => {
        const { createTypogravureRenderer } = await import("/renderer.js");
        // eslint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this callback into an isolated browser context.
        const loadImage = async (imageURL) => {
          const image = new Image();
          image.src = imageURL;
          await image.decode();
          return image;
        };
        const [atlas, correspondence, propSupport, still, green, blue] = await Promise.all([
          loadImage("/atlas.webp"),
          loadImage("/correspondence.png"),
          loadImage("/support.png"),
          loadImage("/still.webp"),
          loadImage("/green.webp"),
          loadImage("/blue.webp"),
        ]);
        let video;
        if (configuration.frameNumbers.some((frame) => frame !== null)) {
          video = document.createElement("video");
          video.preload = "auto";
          video.muted = true;
          video.playsInline = true;
          await new Promise((resolve, reject) => {
            video.addEventListener("loadeddata", resolve, { once: true });
            video.addEventListener(
              "error",
              () => reject(new Error("Could not decode packed portrait video")),
              { once: true },
            );
            video.src = "/source.mp4";
          });
        }
        let constantSource;
        if (configuration.solidSource) {
          constantSource = document.createElement("canvas");
          constantSource.width = 2400;
          constantSource.height = 800;
          const context = constantSource.getContext("2d");
          context.fillStyle = "rgb(96, 96, 96)";
          context.fillRect(0, 0, 1200, 800);
          context.fillStyle = "white";
          context.fillRect(1200, 0, 1200, 800);
        }
        const canvas = document.createElement("canvas");
        const displayWidth = configuration.displayWidth;
        canvas.style.cssText = `display:block;width:${displayWidth * 1.2}px;height:${(displayWidth * 2) / 3}px`;
        document.body.style.margin = "0";
        document.body.append(canvas);
        // Bake the live block pass with the ink: its framed matte, paper gap
        // and cast shadow must already exist before the first interaction.
        const blocks = configuration.solidSource
          ? []
          : configuration.blockRects.map(({ name, rect }) => ({
              paint: name === "green" ? green : blue,
              rect,
            }));
        const renderer = await createTypogravureRenderer(
          canvas,
          { atlas, correspondence, propSupport },
          blocks,
        );
        if (!renderer) throw new Error("Could not initialize the production WebGL2 renderer");
        const prints = [];
        let controlPng;
        try {
          renderer.resize();
          renderer.uploadSource(constantSource ?? still);
          renderer.render();
          if (constantSource) controlPng = canvas.toDataURL("image/png");
          for (const frame of configuration.frameNumbers) {
            const time = frame === null ? 6.5 / 12 : (frame - 0.5) / 12;
            if (frame !== null) {
              // eslint-disable-next-line no-await-in-loop -- A shared video must finish decoding one seek before the next frame is sampled.
              await new Promise((resolve, reject) => {
                video.addEventListener("seeked", resolve, { once: true });
                video.addEventListener(
                  "error",
                  () => reject(new Error(`Could not seek portrait frame ${frame}`)),
                  { once: true },
                );
                video.currentTime = time;
              });
            }
            const source = constantSource ?? (frame === null ? still : video);
            renderer.uploadSource(source);
            if (frame !== null) {
              // Capture a held arrangement; the animation harness reviews transitions.
              for (let tick = 0; tick < 40; tick++) renderer.updatePhysics(0.05);
            }
            renderer.render();
            // PNG export correctly converts premultiplied ink to straight alpha.
            // Capturing in the same task avoids an intervening framebuffer clear.
            const png = canvas.toDataURL("image/png");
            renderer.render();
            if (canvas.toDataURL("image/png") !== png) {
              throw new Error("The cached portrait differs from its first render");
            }
            renderer.uploadSource(source);
            renderer.render();
            if (canvas.toDataURL("image/png") !== png) {
              throw new Error("An unchanged source produced different portrait pixels");
            }
            const gl = canvas.getContext("webgl2");
            if (!gl || gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
              throw new Error("WebGL reported an error while rendering the poster");
            }
            prints.push({ png, frame, time });
            if (controlPng) {
              renderer.render();
              if (canvas.toDataURL("image/png") !== controlPng) {
                throw new Error("A held image kept moving while the video sought another frame");
              }
            }
          }
          if (
            prints.length > 1 &&
            prints[0].frame === prints.at(-1).frame &&
            prints[0].png !== prints.at(-1).png
          ) {
            throw new Error("Returning to the first pose did not restore the same particles");
          }
          return { prints, controlPng, width: canvas.width, height: canvas.height };
        } finally {
          renderer.destroy();
          video?.removeAttribute("src");
          video?.load();
        }
      },
      { displayWidth: cssWidth, frameNumbers, solidSource: args["solid-source"], blockRects },
    );
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
    const frames = [];
    for (const print of capture.prints) {
      const stagePng = Buffer.from(print.png.split(",")[1], "base64");
      // eslint-disable-next-line no-await-in-loop -- Crop one frame at a time to bound native image memory.
      const poster = await sharp(stagePng)
        .extract({
          left: Math.round((capture.width - targetWidth) / 2),
          top: 0,
          width: targetWidth,
          height: capture.height,
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
      // eslint-disable-next-line no-await-in-loop -- Validate each decoded frame before retaining it.
      const statistics = await sharp(poster).stats();
      const alpha = statistics.channels[3];
      if (!alpha || (!args["solid-source"] && alpha.min !== 0) || alpha.max === 0) {
        throw new Error(
          "The rendered portrait must contain visible ink and preserve its paper channels",
        );
      }
      frames.push({
        poster,
        width: targetWidth,
        height: capture.height,
        frame: print.frame,
        time: print.time,
      });
    }
    let motionControl;
    if (capture.controlPng) {
      motionControl = await sharp(Buffer.from(capture.controlPng.split(",")[1], "base64"))
        .extract({
          left: Math.round((capture.width - targetWidth) / 2),
          top: 0,
          width: targetWidth,
          height: capture.height,
        })
        .png()
        .toBuffer();
    }
    return { ...frames[0], frames, motionControl };
  } finally {
    await page.close();
  }
}

function verifyHeldParticles(frames, control) {
  for (const frame of frames) {
    if (!frame.poster.equals(control)) {
      throw new Error(`A held image kept moving at video frame ${frame.frame}`);
    }
  }
  console.log("Held-source particles stay exactly still across every video seek.");
}

async function writeMotionPreview(frames, destination) {
  const directory = destination.replace(/\.png$/i, "-frames");
  await fs.mkdir(directory, { recursive: true });
  const thumbnails = [];
  const tileWidth = 480;
  const tileHeight = 320;
  const labelHeight = 32;
  const columns = Math.min(5, frames.length);
  for (const [index, frame] of frames.entries()) {
    const name = `frame-${String(frame.frame ?? 7).padStart(2, "0")}-${String(index).padStart(2, "0")}`;
    // eslint-disable-next-line no-await-in-loop -- Keep output order aligned with the sequence and its return pose.
    await fs.writeFile(path.join(directory, `${name}.png`), frame.poster);
    // eslint-disable-next-line no-await-in-loop -- Bound sharp's native buffers to one contact-sheet tile.
    const thumb = await sharp(frame.poster)
      .flatten({ background: PAPER })
      .resize(tileWidth, tileHeight)
      .png()
      .toBuffer();
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * (tileHeight + labelHeight);
    thumbnails.push({ input: thumb, left, top });
    const label = `<svg width="${tileWidth}" height="${labelHeight}"><text x="12" y="22" font-family="sans-serif" font-size="15" fill="#463a30">Frame ${frame.frame ?? "still"} · ${frame.time.toFixed(3)} s</text></svg>`;
    thumbnails.push({ input: Buffer.from(label), left, top: top + tileHeight });
  }
  const contactSheet = destination.replace(/\.png$/i, "-contact-sheet.png");
  await sharp({
    create: {
      width: tileWidth * columns,
      height: Math.ceil(frames.length / columns) * (tileHeight + labelHeight),
      channels: 3,
      background: PAPER,
    },
  })
    .composite(thumbnails)
    .png()
    .toFile(contactSheet);
  console.log(`Motion sequence: ${directory}; contact sheet: ${contactSheet}`);
}

// These registered regions distinguish fabric from skin: averaging only the
// full transparent canvas could hide a substantial change in shirt density.
const toneRegions = [
  { name: "full", rect: [0, 0, 1, 1] },
  { name: "shirt", rect: [0.62, 0.46, 0.16, 0.22] },
  { name: "forehead", rect: [0.49, 0.19, 0.07, 0.09] },
  { name: "arm", rect: [0.09, 0.75, 0.08, 0.12] },
];
const PAPER = { r: 244, g: 239, b: 230 };
const PAPER_LUMA = (PAPER.r * 0.2126 + PAPER.g * 0.7152 + PAPER.b * 0.0722) / 255;

async function measureTone(poster) {
  const { data, info } = await sharp(poster).raw().toBuffer({ resolveWithObject: true });
  return Object.fromEntries(
    toneRegions.map(({ name, rect: [left, top, width, height] }) => {
      const xStart = Math.round(left * info.width);
      const yStart = Math.round(top * info.height);
      const xEnd = Math.round((left + width) * info.width);
      const yEnd = Math.round((top + height) * info.height);
      let coverage = 0;
      let luma = 0;
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const pixel = (y * info.width + x) * 4;
          const alpha = data[pixel + 3] / 255;
          const ink =
            (data[pixel] * 0.2126 + data[pixel + 1] * 0.7152 + data[pixel + 2] * 0.0722) / 255;
          coverage += alpha;
          luma += ink * alpha + PAPER_LUMA * (1 - alpha);
        }
      }
      const pixels = (xEnd - xStart) * (yEnd - yStart);
      return [name, { alpha: coverage / pixels, luma: luma / pixels }];
    }),
  );
}

async function verifySizes(browser, url) {
  const measurements = [];
  for (const width of [480, 800, 1200]) {
    for (const ratio of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop -- Keep software GPU memory bounded and each measurement isolated.
      const { poster } = await renderPortrait(browser, url, width, ratio);
      // eslint-disable-next-line no-await-in-loop -- Measure each completed render before releasing its image.
      const regions = await measureTone(poster);
      measurements.push({ width, ratio, regions });
      console.log(JSON.stringify({ width, ratio, regions }));
    }
  }
  const failures = [];
  for (const { name } of toneRegions) {
    for (const metric of ["alpha", "luma"]) {
      const values = measurements.map(({ regions }) => regions[name][metric]);
      const span = Math.max(...values) - Math.min(...values);
      // One percentage point of coverage or paper-composited luminance is
      // about 2.5 byte values: visibly stable without requiring matching dots
      // after a change in the number of available display pixels.
      if (span > 0.01) failures.push(`${name} ${metric} varies by ${(span * 100).toFixed(2)}%`);
    }
  }
  if (failures.length) throw new Error(`Portrait size consistency failed: ${failures.join("; ")}`);
  console.log("Portrait tone is consistent within 1% across all six display configurations.");
}

let browser;
try {
  // Software WebGL keeps the build independent of the author's GPU and
  // supports the same WebGL2 shaders on development machines and CI.
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const url = `http://127.0.0.1:${server.port}/?portrait-debug`;
  const frameNumbers = args["motion-preview"]
    ? [1, 7, 13, 19, 25, 31, 37, 43, 48, 1]
    : [selectedFrame];
  const { poster, height, frames, motionControl } = await renderPortrait(
    browser,
    url,
    displayCssWidth,
    outputWidth / displayCssWidth,
    frameNumbers,
  );
  if (args["motion-preview"]) await writeMotionPreview(frames, outputPath);
  if (args["motion-preview"] && motionControl) verifyHeldParticles(frames, motionControl);
  if (args["verify-sizes"]) await verifySizes(browser, url);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, poster);
  if (args.preview) {
    await sharp(poster)
      .flatten({ background: PAPER })
      .png({ compressionLevel: 9 })
      .toFile(outputPath.replace(/\.png$/i, "-preview.png"));
  }
  console.log(`Rendered ${outputPath} (${outputWidth}×${height}, ${poster.length} bytes)`);
} finally {
  await browser?.close();
  await server.stop(true);
}
