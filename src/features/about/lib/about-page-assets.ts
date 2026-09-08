// The about page's portrait assets, gathered once so every route that renders
// the page — the front page and the /career/<slug> views — loads the same set.
import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import aboutPortraitPoster from "../../../../images/source/about-motion/rendered/poster.png";
import aboutGlyphAtlas from "../../../../images/source/about-motion/packed/glyph-atlas.webp?url";
import aboutCorrespondence from "../../../../images/source/about-motion/packed/portrait-correspondence.png?url";
import aboutPackedStill from "../../../../images/source/about-motion/packed/portrait-packed-still.webp?url";
import aboutPackedVideo from "../../../../images/source/about-motion/packed/portrait-packed.mp4?url";
import aboutPropSupport from "../../../../images/source/about-motion/packed/prop-support.png?url";
import type { AboutPortraitAssets } from "./about-portrait-data";
import { getPortraitGeneratedAssets } from "./portrait-generated-assets";

export const aboutPageDescription =
  "Notes on making things, reading widely, training, food, and life in London.";

// Astro's dev image endpoint caches stable source URLs for a year. Version all
// poster candidates when the bake changes; production already hashes its assets.
const posterRevision = import.meta.env.DEV
  ? createHash("sha256")
      .update(await readFile("images/source/about-motion/rendered/poster.png"))
      .digest("hex")
      .slice(0, 12)
  : undefined;

async function posterAtWidth(width: number, format: "avif" | "webp") {
  const image = await getImage({
    src: aboutPortraitPoster,
    width,
    format,
    // Fine ink and partially transparent mark edges need more precision than
    // a photograph. Keep the native source available for dense displays, too.
    quality: format === "avif" ? 60 : 90,
  });

  const src = posterRevision
    ? `${image.src}${image.src.includes("?") ? "&" : "?"}v=${posterRevision}`
    : image.src;
  return { src, width };
}

const widths = [320, 480, 640, 800, 960, 1200, 1600, 1800];
const [webpPosters, avifPosters, paint] = await Promise.all([
  Promise.all(widths.map((width) => posterAtWidth(width, "webp"))),
  Promise.all(widths.map((width) => posterAtWidth(width, "avif"))),
  getPortraitGeneratedAssets(),
]);
const posterSrcSet = webpPosters.map((image) => `${image.src} ${image.width}w`).join(", ");
const posterAvifSrcSet = avifPosters.map((image) => `${image.src} ${image.width}w`).join(", ");
// Source-size font units use the initial font size, so the site's 1.2 root
// scale is included here. Narrow screens follow the exact composition width;
// wide screens use a conservative height bound without measuring after paint.
const posterSizes = [
  "(max-width: 760px) calc((100vw - 2.4rem) / 1.075)",
  "(max-width: 999px) calc((100vw - 3.6rem) / 1.075)",
  "min(calc(min(100vw, 105.6rem) - 3.6rem), max(calc(27rem / 1.075), 80vh))",
].join(", ");
const optimizedPoster = webpPosters.at(-1);
const optimizedAvif = avifPosters.at(-1);
if (!optimizedPoster || !optimizedAvif) throw new Error("Missing portrait poster candidates");

export const aboutPoster: ImageMetadata = {
  ...aboutPortraitPoster,
  src: optimizedPoster.src,
  format: "webp" as const,
};

export const aboutPortraitAssets: AboutPortraitAssets = {
  posterSrcSet,
  posterAvifSrcSet,
  posterSizes,
  paint: { green: paint.green.url, blue: paint.blue.url, foot: paint.foot.url },
  glyphAtlas: aboutGlyphAtlas,
  correspondence: aboutCorrespondence,
  packedStill: aboutPackedStill,
  packedVideo: aboutPackedVideo,
  propSupport: aboutPropSupport,
};

/** Preloads the front page's first paint needs; the slug routes want the same. */
// cspell:ignore imagesrcset imagesizes
export const aboutPreloads = [
  {
    as: "image",
    type: "image/avif",
    fetchpriority: "high",
    href: optimizedAvif.src,
    imagesrcset: posterAvifSrcSet,
    imagesizes: posterSizes,
  },
  // The rear paint is baked into the poster. Only the foreground wash is a
  // separate first-paint image; the live rear textures load on interaction.
  {
    as: "image",
    href: paint.foot.url,
    fetchpriority: "low",
  },
] as const;
