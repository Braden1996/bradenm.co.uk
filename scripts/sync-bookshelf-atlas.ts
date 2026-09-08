import { array, number, object, parse, string } from "valibot";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { loadBookshelfSource } from "../src/features/bookshelf/lib/bookshelf-source";
import { ATLAS_SHEET, atlasCoverRegion } from "../src/features/bookshelf/lib/atlas-sheet";
import { atlasFingerprint } from "./lib/atlas-fingerprint";

type PreviewManifest = {
  version: number;
  fingerprint: string;
  sheets?: { covers: string; previews: string; count: number };
  books: { id: string; src: string; width: number; height: number }[];
};

const fingerprint = await atlasFingerprint();
const manifestPath = "data/bookshelf-atlas.json";
const books = loadBookshelfSource().payload.atlas;

if (process.argv.includes("--check")) {
  const manifest = parse(
    object({
      version: number(),
      fingerprint: string(),
      sheets: object({ covers: string(), previews: string(), count: number() }),
      books: array(object({ id: string(), src: string(), width: number(), height: number() })),
    }),
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (
    manifest.fingerprint !== fingerprint ||
    manifest.books.length !== books.length ||
    manifest.books.some((book, index) => book.id !== books[index]?.id)
  ) {
    throw new Error("Atlas previews are stale. Run bun run bookshelf:atlas-assets.");
  }
  await Promise.all(
    [
      ...manifest.books.map((book) => book.src),
      manifest.sheets.covers,
      manifest.sheets.previews,
    ].map((src) => access(path.join("public", src))),
  );
  console.log(`Atlas previews match all ${books.length} books.`);
} else {
  const limitArgument = process.argv.indexOf("--limit");
  const limit = limitArgument < 0 ? books.length : Number(process.argv[limitArgument + 1]);
  const partial = limit < books.length;
  const output = partial ? "artifacts/atlas-proof" : "public/bookshelf/atlas";
  await mkdir(output, { recursive: true });
  const bundle = await Bun.build({
    entrypoints: ["scripts/lib/atlas-preview-renderer.ts"],
    target: "browser",
    minify: true,
  });
  if (!bundle.success || !bundle.outputs[0])
    throw new Error("Could not bundle atlas preview renderer");
  const script = await bundle.outputs[0].text();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        return new Response(
          '<!doctype html><html><body><script type="module" src="/bake.js"></script></body></html>',
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      }
      if (url.pathname === "/bake.js")
        return new Response(script, { headers: { "Content-Type": "text/javascript" } });
      if (!url.pathname.startsWith("/bookshelf/covers/"))
        return new Response("Not found", { status: 404 });
      const file = Bun.file(path.join("public", decodeURIComponent(url.pathname)));
      return (await file.exists())
        ? new Response(file)
        : new Response("Not found", { status: 404 });
    },
  });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  });
  const manifest: PreviewManifest = { version: 1, fingerprint, books: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
    page.on("pageerror", (error) => console.error(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForFunction(() => Boolean(window.renderAtlasPreview));
    for (const [index, book] of books.slice(0, limit).entries()) {
      // Each frame uses the same renderer and releases the preceding model and texture.
      // eslint-disable-next-line no-await-in-loop
      const data = await page.evaluate((entry) => window.renderAtlasPreview(entry), book);
      const png = Buffer.from(data.split(",")[1] ?? "", "base64");
      // eslint-disable-next-line no-await-in-loop
      const webp = await sharp(png).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
      const hash = createHash("sha256").update(webp).digest("hex").slice(0, 12);
      const filename = `${book.id}.${hash}.webp`;
      // eslint-disable-next-line no-await-in-loop
      await writeFile(path.join(output, filename), webp);
      manifest.books.push({
        id: book.id,
        src: `/bookshelf/atlas/${filename}`,
        width: 640,
        height: 640,
      });
      if (index % 12 === 0 || index === limit - 1)
        console.log(`Rendered ${index + 1}/${limit}: ${book.title}`);
    }
    if (!partial) {
      const rows = Math.ceil(books.length / ATLAS_SHEET.columns);
      const coverParts = [];
      const previewParts = [];
      for (const [index, book] of books.entries()) {
        const region = atlasCoverRegion(book, books.length);
        // eslint-disable-next-line no-await-in-loop
        const cover = await sharp(path.join("public", book.cover.src))
          .resize(region.width, region.height)
          .toBuffer();
        coverParts.push({ input: cover, left: region.x, top: region.y });
        const preview = manifest.books[index];
        if (!preview) continue;
        // eslint-disable-next-line no-await-in-loop
        const print = await sharp(path.join("public", preview.src))
          .resize(ATLAS_SHEET.previewSize)
          .toBuffer();
        previewParts.push({
          input: print,
          left: (index % ATLAS_SHEET.columns) * ATLAS_SHEET.previewSize,
          top: Math.floor(index / ATLAS_SHEET.columns) * ATLAS_SHEET.previewSize,
        });
      }
      const sheet = async (
        name: string,
        width: number,
        height: number,
        parts: OverlayOptions[],
      ) => {
        const bytes = await sharp({
          create: { width, height, channels: 4, background: "#00000000" },
        })
          .composite(parts)
          .webp({ quality: 75, alphaQuality: 90, effort: 6 })
          .toBuffer();
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
        const filename = `${name}.${hash}.webp`;
        await writeFile(path.join(output, filename), bytes);
        console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} KiB`);
        return `/bookshelf/atlas/${filename}`;
      };
      manifest.sheets = {
        covers: await sheet(
          "covers",
          ATLAS_SHEET.columns * ATLAS_SHEET.coverWidth,
          rows * ATLAS_SHEET.coverHeight,
          coverParts,
        ),
        previews: await sheet(
          "previews",
          ATLAS_SHEET.columns * ATLAS_SHEET.previewSize,
          rows * ATLAS_SHEET.previewSize,
          previewParts,
        ),
        count: books.length,
      };
    }
    await writeFile(
      partial ? `${output}/manifest.json` : manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (!partial) {
      const current = new Set(
        [
          ...manifest.books.map((book) => book.src),
          manifest.sheets?.covers ?? "",
          manifest.sheets?.previews ?? "",
        ].map((src) => path.basename(src)),
      );
      const stale = (await readdir(output)).filter(
        (file) =>
          /^(?:book-[\w-]+|covers|previews)\.[a-f0-9]{12}\.webp$/.test(file) && !current.has(file),
      );
      await Promise.all(stale.map((file) => unlink(path.join(output, file))));
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}
