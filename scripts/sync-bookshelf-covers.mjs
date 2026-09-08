#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const csvPath = path.join(projectRoot, "data", "bookshelf.csv");
const manifestPath = path.join(projectRoot, "data", "bookshelf-covers.json");
const coverDir = path.join(projectRoot, "public", "bookshelf", "covers");
const publicCoverPrefix = "/bookshelf/covers";
/*
 * Bump to have every stored cover re-examined on the next run (no network
 * needed). v2: Google Books' drawn page-curl is painted out of the assets that
 * carry one, and new fetches ask for curl-free, larger scans. v3 retains source
 * provenance and downloads genuine portrait scans at up to 480px with --force.
 * v4 adds smaller responsive candidates derived locally from the stored master.
 */
const coverAssetVersion = 5;
/*
 * Keep enough detail for high-density displays and browser zoom, without
 * ever enlarging a small source. --force upgrades old assets.
 * Store the original URL and dimensions so a later refresh can reuse the source
 * directly instead of repeating an ambiguous title search.
 */
const coverOutputWidth = 1536;
const coverCandidateWidths = [128, 256, 384, 512, 768];
const coverSourceWidth = 1536;
const coverMinimumWidth = 300;
const coverWebpQuality = 84;
const coverFingerprintLength = 12;
const upgrade = process.argv.includes("--upgrade");
const force = process.argv.includes("--force") || upgrade;
const onlyIndex = process.argv.indexOf("--only");
const titleFilter = onlyIndex >= 0 ? normalizeText(process.argv[onlyIndex + 1] ?? "") : "";
const concurrency = 4;
const requestTimeout = 15_000;
const unavailableProviders = new Set();
let nextOpenLibraryRequest = 0;

function splitCsvLine(line) {
  const parts = line.split(",");
  const medium = parts.pop()?.trim() ?? "";
  const author = parts.pop()?.trim() ?? "";
  const title = parts.join(",").trim();

  return { title, author, medium };
}

function normalizeText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  const normalized = normalizeText(value).replace(/ +/g, "-");

  return normalized || "untitled";
}

function toContributors(author) {
  const cleanedAuthor = author.trim();

  if (!cleanedAuthor) {
    return ["Unknown author"];
  }

  return cleanedAuthor
    .split("&")
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripAuthorNoise(value) {
  return value
    .replace(/\(.*?\)/g, " ")
    .replace(/\bdr\.?\s+/gi, " ")
    .replace(/\bm\.?d\.?\b/gi, " ")
    .replace(/\bed\.?\b/gi, " ")
    .replace(/\bnarrated by.*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCacheKey(title, author) {
  return `${normalizeText(title)}::${normalizeText(author || "Unknown author")}`;
}

function scoreMatch(candidate, target) {
  if (!candidate || !target) {
    return 0;
  }

  if (candidate === target) {
    return 5;
  }

  if (candidate.includes(target) || target.includes(candidate)) {
    return 4;
  }

  const targetWords = target.split(" ").filter((word) => word.length > 2);
  const matchCount = targetWords.filter((word) => candidate.includes(word)).length;

  return matchCount / Math.max(targetWords.length, 1);
}

function buildTitleVariants(title) {
  const variants = new Set([title.trim()]);

  const withoutEdition = title.replace(/\s+\d+(?:st|nd|rd|th)\s+edition$/i, "");

  if (withoutEdition !== title) {
    variants.add(withoutEdition.trim());
  }

  if (title.includes(":")) {
    variants.add(title.split(":")[0].trim());
  }

  if (title.includes("(")) {
    variants.add(
      title
        .replace(/\(.*?\)/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return [...variants].filter(Boolean);
}

function buildAuthorVariants(book) {
  const variants = new Set();

  if (book.author && book.author !== "Unknown author") {
    variants.add(book.author);
    variants.add(stripAuthorNoise(book.author));
  }

  for (const contributor of book.contributors) {
    variants.add(contributor);
    variants.add(stripAuthorNoise(contributor));
  }

  return [...variants].filter((value) => value && value !== "Unknown author");
}

async function fileExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildExistingTitleIndex(covers) {
  const index = new Map();

  for (const [key, cover] of Object.entries(covers)) {
    const titleKey = normalizeText(cover.title ?? "");
    const entries = index.get(titleKey) ?? [];
    entries.push({ key, cover });
    index.set(titleKey, entries);
  }

  return index;
}

function findReusableExistingEntry(book, titleIndex) {
  if (book.author === "Unknown author") {
    return null;
  }

  const titleKey = normalizeText(book.title);
  const matches = (titleIndex.get(titleKey) ?? []).filter(
    ({ cover }) => cover.author === "Unknown author",
  );

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

async function readManifest() {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    return {
      assetVersion: Number(manifest.assetVersion ?? 0),
      updatedAt: manifest.updatedAt ?? null,
      coverCount: Number(manifest.coverCount ?? 0),
      missingCount: Number(manifest.missingCount ?? 0),
      covers: manifest.covers ?? {},
      missing: Array.isArray(manifest.missing) ? manifest.missing : [],
    };
  } catch {
    return {
      assetVersion: 0,
      updatedAt: null,
      coverCount: 0,
      missingCount: 0,
      covers: {},
      missing: [],
    };
  }
}

function buildCoverFileBase(book) {
  return `${slugify(book.title)}.${slugify(book.author)}`.slice(0, 120);
}

/*
 * Google's `edge=curl` thumbnails carry a drawn page-curl in the bottom-right
 * corner: a white lobe of turned-up page with a grey shadow along its upper-
 * left edge. Measured by diffing a thumbnail against its curl-free twin, the
 * lobe is about 0.23w tall and bulges to 0.20w wide a little above the foot.
 * `curlExtent(v)` is that outline, with a pixel or two to spare: for a row v
 * (in widths) above the bottom edge, how far in from the right edge (also in
 * widths) the curl reaches. Zero above the lobe.
 */
const curlProfile = [
  [0, 0.145],
  [0.03, 0.175],
  [0.07, 0.185],
  [0.1, 0.19],
  [0.115, 0.16],
  [0.13, 0.12],
  [0.145, 0.09],
  [0.16, 0.07],
  [0.19, 0.05],
  [0.21, 0.035],
  [0.235, 0.02],
  [0.26, 0],
];

function curlExtent(v) {
  for (let index = 1; index < curlProfile.length; index += 1) {
    const [v0, e0] = curlProfile[index - 1];
    const [v1, e1] = curlProfile[index];

    if (v <= v1) {
      return e0 + ((v - v0) / (v1 - v0)) * (e1 - e0);
    }
  }

  return 0;
}

function buildCurlMask(width, height) {
  const mask = new Uint8Array(width * height);
  const rows = Math.min(height, Math.ceil(width * curlProfile.at(-1)[0]));

  for (let y = height - rows; y < height; y += 1) {
    const extent = Math.ceil(width * curlExtent((height - 1 - y) / width));

    for (let x = Math.max(0, width - extent); x < width; x += 1) {
      mask[y * width + x] = 1;
    }
  }

  return mask;
}

function luminanceAt(data, offset) {
  return (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000;
}

/*
 * Not every thumbnail the API hands out with `edge=curl` in its URL actually
 * has one drawn — publisher-supplied images come back as they are. So look
 * before painting. The drawn curl is the same picture every time, scaled with
 * the thumbnail: on each row up from the bottom edge there is a run of near-
 * white paper in from the right edge, 0.118w long at the foot and shrinking by
 * 0.62px a row until it is gone at about 0.18w up, with a step down into grey
 * shadow right after it. Measured on the shipped 96px assets the runs are
 * 11, 10, 9, 9, 8, 8, 7, 7, 6, 5, 5, 4, 3, 3, 2, 2, 1. So test each row for
 * paper where the ramp says paper and a step right after it: a white cover
 * has the paper but no step (unless the curl is drawn on it, when the step is
 * its only trace); text in a white corner steps, but not along that ramp row
 * after row; a dark or coloured cover has no paper at all.
 */
function hasPageCurl(data, width, height, channels) {
  if (width < 24 || height < Math.round(width * 0.26)) {
    return false;
  }

  const sample = (x, y) => luminanceAt(data, (y * width + Math.max(0, x)) * channels);
  let checked = 0;
  let matched = 0;

  for (let row = 1; row <= Math.round(width * 0.18); row += 1) {
    const run = Math.round(width * 0.1177 - 0.62 * row);

    if (run < 1) {
      break;
    }

    const y = height - 1 - row;
    let paper = 0;

    /* The paper zone: everything the ramp says is turned page on this row. */
    for (let x = width - run; x < width; x += 1) {
      paper += sample(x, y);
    }

    const paperMean = paper / run;

    checked += 1;

    if (paperMean < 212) {
      continue;
    }

    /* And the shadow zone right after it: a step down within four pixels. */
    for (let x = width - run - 1; x >= Math.max(0, width - run - 4); x -= 1) {
      const luminance = sample(x, y);

      if (luminance <= 214 && luminance <= paperMean - 26) {
        matched += 1;
        break;
      }
    }
  }

  return checked > 0 && matched / checked >= 0.75;
}

/*
 * Paint the curl out by diffusion: every masked pixel settles to the average
 * of its neighbours, with the cover's own pixels around the lobe held fixed, so
 * flat fields stay flat, gradients carry on, and anything crossing the edge
 * softens into the corner instead of being dragged across it in streaks.
 */
function paintOutPageCurl(data, width, height, channels) {
  const mask = buildCurlMask(width, height);
  const output = Float32Array.from(data);
  const targets = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      targets.push(index);
    }
  }

  if (targets.length === 0) {
    return Buffer.from(data);
  }

  const neighbourOffsets = [-1, 1, -width, width];
  const seeds = new Float32Array(channels);
  let seedCount = 0;

  for (const index of targets) {
    for (const step of neighbourOffsets) {
      const neighbour = index + step;
      const sameRow =
        step === -1 || step === 1
          ? Math.floor(neighbour / width) === Math.floor(index / width)
          : true;

      if (neighbour < 0 || neighbour >= mask.length || !sameRow || mask[neighbour]) {
        continue;
      }

      for (let channel = 0; channel < channels; channel += 1) {
        seeds[channel] += data[neighbour * channels + channel];
      }

      seedCount += 1;
    }
  }

  for (const index of targets) {
    for (let channel = 0; channel < channels; channel += 1) {
      output[index * channels + channel] = seedCount ? seeds[channel] / seedCount : 255;
    }
  }

  const next = Float32Array.from(output);

  for (let iteration = 0; iteration < 400; iteration += 1) {
    for (const index of targets) {
      const x = index % width;
      let count = 0;
      const sums = [0, 0, 0, 0];

      for (const step of neighbourOffsets) {
        const neighbour = index + step;

        if (neighbour < 0 || neighbour >= mask.length) {
          continue;
        }

        if ((step === -1 && x === 0) || (step === 1 && x === width - 1)) {
          continue;
        }

        for (let channel = 0; channel < channels; channel += 1) {
          sums[channel] += output[neighbour * channels + channel];
        }

        count += 1;
      }

      for (let channel = 0; channel < channels; channel += 1) {
        next[index * channels + channel] = sums[channel] / count;
      }
    }

    for (const index of targets) {
      for (let channel = 0; channel < channels; channel += 1) {
        output[index * channels + channel] = next[index * channels + channel];
      }
    }
  }

  const result = Buffer.from(data);

  for (const index of targets) {
    for (let channel = 0; channel < channels; channel += 1) {
      result[index * channels + channel] = Math.round(
        Math.min(255, Math.max(0, output[index * channels + channel])),
      );
    }
  }

  return result;
}

/*
 * `removeCurl` says the source MAY carry Google's page-curl; it is painted out
 * only where one is actually found, and the asset is clean either way.
 */
async function writeOptimizedCover(book, input, { removeCurl = false } = {}) {
  let pipeline = sharp(input).rotate().resize({
    width: coverOutputWidth,
    height: coverOutputWidth,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (removeCurl) {
    const raw = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { channels, height, width } = raw.info;

    if (hasPageCurl(raw.data, width, height, channels)) {
      pipeline = sharp(paintOutPageCurl(raw.data, width, height, channels), {
        raw: { channels, height, width },
      });
    } else {
      pipeline = sharp(raw.data, { raw: { channels, height, width } });
    }
  }

  const { data, info } = await pipeline
    .webp({
      effort: 6,
      quality: coverWebpQuality,
      smartSubsample: true,
    })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error("Missing dimensions for bookshelf cover");
  }

  const fingerprint = createHash("sha256")
    .update(data)
    .digest("hex")
    .slice(0, coverFingerprintLength);
  const filename = `${buildCoverFileBase(book)}.${fingerprint}.webp`;

  await writeFile(path.join(coverDir, filename), data);

  return {
    filename,
    src: `${publicCoverPrefix}/${filename}`,
    width: info.width,
    height: info.height,
  };
}

/** Derive responsive copies locally, retaining the stored master byte for byte. */
async function addCoverCandidates(book, asset, existingCandidates = []) {
  const input = path.join(coverDir, asset.filename);
  const candidates = await Promise.all(
    coverCandidateWidths
      .filter((candidateWidth) => candidateWidth < asset.width)
      .map(async (width) => {
        const existing = existingCandidates.find((candidate) => candidate.width === width);
        if (existing && (await fileExists(path.join(coverDir, existing.filename)))) return existing;
        const { data, info } = await sharp(input)
          .resize({ width, withoutEnlargement: true })
          .webp({ effort: 6, quality: coverWebpQuality, smartSubsample: true })
          .toBuffer({ resolveWithObject: true });
        const fingerprint = createHash("sha256")
          .update(data)
          .digest("hex")
          .slice(0, coverFingerprintLength);
        const filename = `${buildCoverFileBase(book)}.${width}.${fingerprint}.webp`;
        await writeFile(path.join(coverDir, filename), data);
        return {
          filename,
          src: `${publicCoverPrefix}/${filename}`,
          width: info.width,
          height: info.height,
        };
      }),
  );
  candidates.push({
    filename: asset.filename,
    src: asset.src,
    width: asset.width,
    height: asset.height,
  });
  return { ...asset, candidates };
}

async function fetchJson(url) {
  const host = new URL(url).hostname;

  if (unavailableProviders.has(host)) {
    throw new Error(`${host} is unavailable for this sync`);
  }

  if (host === "openlibrary.org") {
    const wait = Math.max(0, nextOpenLibraryRequest - Date.now());
    nextOpenLibraryRequest = Date.now() + wait + 1_000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(requestTimeout),
    headers: {
      "user-agent": "bradenm.co.uk bookshelf cover sync",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      unavailableProviders.add(host);
    }

    throw new Error(`Request failed with ${response.status} for ${url}`);
  }

  return response.json();
}

async function searchOpenLibrary(book) {
  const expectedTitle = normalizeText(book.title);
  const expectedAuthor = normalizeText(book.author);
  const titleVariants = buildTitleVariants(book.title);
  const authorVariants = buildAuthorVariants(book);
  const attempts = [];

  for (const title of titleVariants) {
    for (const author of authorVariants.slice(0, 3)) {
      attempts.push({ title, author });
    }

    attempts.push({ title, author: "" });
  }

  for (const attempt of attempts) {
    const params = new URLSearchParams({
      title: attempt.title,
      limit: "8",
      fields: "title,author_name,cover_i",
      language: "eng",
    });

    if (attempt.author) {
      params.set("author", attempt.author);
    }

    // Stop once we find a strong match instead of exhaustively querying every variant.
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(`https://openlibrary.org/search.json?${params.toString()}`);
    const candidate = (data.docs ?? [])
      .filter(
        (entry) =>
          entry.cover_i &&
          scoreMatch(normalizeText(entry.title ?? ""), expectedTitle) >= 4 &&
          (book.author === "Unknown author" ||
            scoreMatch(normalizeText((entry.author_name ?? []).join(" ")), expectedAuthor) >= 0.5),
      )
      .map((entry) => ({
        provider: "openlibrary",
        score:
          scoreMatch(normalizeText(entry.title ?? ""), expectedTitle) +
          scoreMatch(normalizeText((entry.author_name ?? []).join(" ")), expectedAuthor),
        imageUrl: `https://covers.openlibrary.org/b/id/${entry.cover_i}.jpg?default=false`,
        matchedTitle: entry.title ?? "",
        matchedAuthor: (entry.author_name ?? []).join(", "),
      }))
      .toSorted((left, right) => right.score - left.score)[0];

    if (candidate && candidate.score >= 4) {
      return candidate;
    }
  }

  return null;
}

async function searchGoogleBooks(book) {
  const expectedTitle = normalizeText(book.title);
  const expectedAuthor = normalizeText(book.author);
  const titleVariants = buildTitleVariants(book.title);
  const authorVariants = buildAuthorVariants(book);
  const attempts = [];

  for (const title of titleVariants) {
    for (const author of authorVariants.slice(0, 3)) {
      attempts.push(`intitle:${title} inauthor:${author}`);
    }

    attempts.push(`intitle:${title}`);
  }

  for (const query of attempts) {
    const params = new URLSearchParams({
      q: query,
      maxResults: "8",
      printType: "books",
    });

    // Stop once we find a strong match instead of exhaustively querying every variant.
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
    );
    const candidate = (data.items ?? [])
      .map((item) => {
        const volumeInfo = item.volumeInfo ?? {};
        const imageLinks = volumeInfo.imageLinks ?? {};
        const imageUrl =
          imageLinks.extraLarge ??
          imageLinks.large ??
          imageLinks.medium ??
          imageLinks.small ??
          imageLinks.thumbnail ??
          imageLinks.smallThumbnail ??
          "";

        return {
          provider: "google-books",
          score:
            scoreMatch(normalizeText(volumeInfo.title ?? ""), expectedTitle) +
            scoreMatch(normalizeText((volumeInfo.authors ?? []).join(" ")), expectedAuthor),
          imageUrl: imageUrl.replace("http://", "https://"),
          matchedTitle: volumeInfo.title ?? "",
          matchedAuthor: (volumeInfo.authors ?? []).join(", "),
          /* The API hands out `edge=curl` thumbnails; the download asks for better. */
          edge: "curl",
        };
      })
      .filter((entry) => entry.imageUrl)
      .toSorted((left, right) => right.score - left.score)[0];

    if (candidate && candidate.score >= 4) {
      return candidate;
    }
  }

  return null;
}

/*
 * Try the original Open Library scan before the 500px-tall preview. Google's
 * thumbnail parameters need upgrading even when the URL has no page-curl.
 */
function buildImageAttempts(candidate) {
  let url;

  try {
    url = new URL(candidate.imageUrl);
  } catch {
    return [{ edge: candidate.edge === "curl" ? "curl" : "clean", url: candidate.imageUrl }];
  }

  if (url.hostname === "covers.openlibrary.org") {
    const original = new URL(url);
    original.pathname = original.pathname.replace(/-[SML]\.jpg$/, ".jpg");
    const large = new URL(original);
    large.pathname = large.pathname.replace(/\.jpg$/, "-L.jpg");

    return [
      { edge: "clean", url: original.toString() },
      { edge: "clean", url: large.toString() },
    ];
  }

  if (candidate.provider !== "google-books") {
    return [{ edge: "clean", url: candidate.imageUrl }];
  }

  const clean = new URL(url);
  clean.searchParams.delete("edge");
  const large = new URL(clean);
  large.searchParams.set("fife", `w${coverSourceWidth}`);

  return [
    { edge: "clean", url: large.toString() },
    { edge: "clean", url: clean.toString() },
    { edge: candidate.edge === "curl" ? "curl" : "clean", url: candidate.imageUrl },
  ];
}

async function downloadCover(book, candidate) {
  let lastError = null;
  let best = null;

  for (const attempt of buildImageAttempts(candidate)) {
    try {
      // Each URL is a fallback for the previous one, including low-resolution responses.
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(attempt.url, {
        signal: AbortSignal.timeout(requestTimeout),
        headers: {
          "user-agent": "bradenm.co.uk bookshelf cover sync",
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`Image download failed with ${response.status}`);
      }

      // eslint-disable-next-line no-await-in-loop
      const bytes = Buffer.from(await response.arrayBuffer());
      // eslint-disable-next-line no-await-in-loop
      const metadata = await sharp(bytes).metadata();
      const sourceWidth = metadata.autoOrient?.width ?? metadata.width ?? 0;
      const sourceHeight = metadata.autoOrient?.height ?? metadata.height ?? 0;

      // Reject provider placeholders and avoid stretching audiobook squares into books.
      if (sourceWidth < 80 || sourceHeight / sourceWidth < 1.15) {
        throw new Error("Source is too small or is not a portrait book cover");
      }

      if (!best || sourceWidth > best.sourceWidth) {
        best = { bytes, attempt, sourceWidth, sourceHeight };
      }

      if (sourceWidth >= coverOutputWidth) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!best) {
    throw lastError instanceof Error ? lastError : new Error("Image download failed");
  }

  return {
    ...(await writeOptimizedCover(book, best.bytes, {
      removeCurl: best.attempt.edge === "curl",
    })),
    sourceUrl: best.attempt.url,
    sourceWidth: best.sourceWidth,
    sourceHeight: best.sourceHeight,
  };
}

async function resolveCoverAsset(book, existing) {
  let best = null;
  const attempts = [];

  if (existing?.sourceUrl) {
    attempts.push(async () => ({
      provider: existing.provider,
      imageUrl: existing.sourceUrl,
      edge: new URL(existing.sourceUrl).searchParams.get("edge") === "curl" ? "curl" : "clean",
      matchedTitle: existing.matchedTitle,
      matchedAuthor: existing.matchedAuthor,
    }));
  }

  // An atlas upgrade preserves the chosen edition instead of repeating title searches.
  if (!upgrade) attempts.push(searchOpenLibrary, searchGoogleBooks);

  for (const provider of attempts) {
    if (
      (provider === searchGoogleBooks && unavailableProviders.has("www.googleapis.com")) ||
      (provider === searchOpenLibrary && unavailableProviders.has("openlibrary.org"))
    ) {
      continue;
    }

    try {
      // A fallback provider is only queried when the preferred source is insufficient.
      // eslint-disable-next-line no-await-in-loop
      const candidate = await provider(book);

      if (!candidate) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const downloaded = await downloadCover(book, candidate);

      if (!best || downloaded.width > best.downloaded.width) {
        best = { candidate, downloaded };
      }

      if (downloaded.width >= coverMinimumWidth) {
        return best;
      }
    } catch (error) {
      console.warn(`[bookshelf:covers] Source failed for "${book.title}": ${String(error)}`);
    }
  }

  return best;
}

async function removeIfExists(targetPath) {
  if (await fileExists(targetPath)) {
    await rm(targetPath, { force: true });
  }
}

async function fileHasPageCurl(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return hasPageCurl(data, info.width, info.height, info.channels);
}

/*
 * A stored cover is kept byte for byte unless something has to change: its
 * metadata is missing, or it predates v2 and carries Google's curl, in which
 * case it is painted out and the asset re-encoded. Covers from before the edge
 * was recorded are treated as possibly curled; each is looked at, and the
 * manifest records it clean from then on whether or not paint was needed.
 */
async function reuseExistingCover(book, existingCover, assetsAreCurrent) {
  const currentPath = path.join(coverDir, existingCover.filename);
  const fingerprint = existingCover.filename.match(/\.([a-f0-9]{12})\.webp$/)?.[1];
  const hasMetadata =
    Boolean(fingerprint) && Number(existingCover.width) > 0 && Number(existingCover.height) > 0;
  const storedEdge =
    existingCover.edge ?? (existingCover.provider === "google-books" ? "curl" : "clean");
  const mustPaint =
    !assetsAreCurrent && storedEdge === "curl" && (await fileHasPageCurl(currentPath));
  let asset;

  if (hasMetadata && !mustPaint) {
    const filename = `${buildCoverFileBase(book)}.${fingerprint}.webp`;
    const nextPath = path.join(coverDir, filename);

    if (existingCover.filename !== filename) {
      await removeIfExists(nextPath);
      await rename(currentPath, nextPath);
    }

    asset = {
      filename,
      src: `${publicCoverPrefix}/${filename}`,
      width: Number(existingCover.width),
      height: Number(existingCover.height),
    };
  } else {
    asset = await writeOptimizedCover(book, currentPath, { removeCurl: mustPaint });
  }

  const metadataMatches =
    existingCover.title === book.title && existingCover.author === book.author;

  return {
    title: book.title,
    author: book.author,
    ...(await addCoverCandidates(
      book,
      asset,
      assetsAreCurrent ? (existingCover.candidates ?? []) : [],
    )),
    provider: existingCover.provider,
    matchedTitle: metadataMatches ? existingCover.matchedTitle : book.title,
    matchedAuthor: metadataMatches ? existingCover.matchedAuthor : book.author,
    fetchedAt: existingCover.fetchedAt,
    sourceUrl: existingCover.sourceUrl,
    sourceWidth: existingCover.sourceWidth,
    sourceHeight: existingCover.sourceHeight,
    edge: assetsAreCurrent ? storedEdge : "clean",
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = Array.from({ length: items.length });
  let cursor = 0;

  async function worker() {
    const index = cursor;
    cursor += 1;

    if (index >= items.length) {
      return;
    }

    results[index] = await mapper(items[index], index);
    await worker();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  return results;
}

async function main() {
  await mkdir(coverDir, { recursive: true });

  const csv = await readFile(csvPath, "utf8");
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => {
      const { title, author, medium } = splitCsvLine(line);

      return {
        title,
        author: author || "Unknown author",
        medium,
        index,
        contributors: toContributors(author),
      };
    });

  const groupedBooks = new Map();

  for (const row of rows) {
    const key = buildCacheKey(row.title, row.author);
    const existing = groupedBooks.get(key);

    if (existing) {
      existing.mediums.add(row.medium);
      continue;
    }

    groupedBooks.set(key, {
      key,
      title: row.title,
      author: row.author,
      contributors: row.contributors,
      mediums: new Set([row.medium]),
      index: row.index,
    });
  }

  const books = [...groupedBooks.values()].toSorted((left, right) => left.index - right.index);
  const existingManifest = await readManifest();
  const assetsAreCurrent = existingManifest.assetVersion === coverAssetVersion;
  const existingTitleIndex = buildExistingTitleIndex(existingManifest.covers);
  const nextCovers = {};
  const missing = [];

  console.log(
    `[bookshelf:covers] Syncing ${books.length} unique titles${force ? " with force refresh" : ""}...`,
  );

  /*
   * A cover already on disk is never given up for a failed fetch: with --force
   * a book that cannot be refetched today (the Google Books API has a shared
   * daily quota and 429s when it is spent) keeps the asset it has, and a
   * download that fails on every URL is a miss for that one book rather than
   * the end of the run — the manifest and the stale-file sweep below only ever
   * see a complete picture.
   */
  await mapWithConcurrency(books, concurrency, async (book) => {
    const existing =
      existingManifest.covers[book.key] ??
      findReusableExistingEntry(book, existingTitleIndex)?.cover;
    const existingPath = existing?.filename ? path.join(coverDir, existing.filename) : "";
    const hasExistingAsset = Boolean(
      existing?.src && existingPath && (await fileExists(existingPath)),
    );

    const refresh = force && (!titleFilter || normalizeText(book.title).includes(titleFilter));

    if (!refresh && hasExistingAsset) {
      const previousFilename = existing.filename;

      nextCovers[book.key] = await reuseExistingCover(book, existing, assetsAreCurrent);
      console.log(
        `[bookshelf:covers] ${nextCovers[book.key].filename === previousFilename ? "Keep " : "Build"} ${book.title}`,
      );
      return;
    }

    const keepExisting = async (reason) => {
      if (hasExistingAsset) {
        nextCovers[book.key] = await reuseExistingCover(book, existing, assetsAreCurrent);
        console.log(`[bookshelf:covers] Kept  ${book.title} (${reason})`);
        return;
      }

      missing.push({
        key: book.key,
        title: book.title,
        author: book.author,
      });
      console.log(`[bookshelf:covers] Miss  ${book.title} (${reason})`);
    };

    const resolved = await resolveCoverAsset(book, existing);

    if (!resolved) {
      await keepExisting("no usable source found");
      return;
    }

    const { candidate, downloaded } = resolved;

    if (hasExistingAsset && downloaded.width < existing.width) {
      await keepExisting("available source is smaller than the stored cover");
      return;
    }

    nextCovers[book.key] = await addCoverCandidates(book, {
      title: book.title,
      author: book.author,
      filename: downloaded.filename,
      src: downloaded.src,
      width: downloaded.width,
      height: downloaded.height,
      sourceUrl: downloaded.sourceUrl,
      sourceWidth: downloaded.sourceWidth,
      sourceHeight: downloaded.sourceHeight,
      provider: candidate.provider,
      matchedTitle: candidate.matchedTitle,
      matchedAuthor: candidate.matchedAuthor,
      fetchedAt: new Date().toISOString(),
      edge: "clean",
    });

    console.log(
      `[bookshelf:covers] Saved ${book.title} <- ${candidate.provider} (${downloaded.width}×${downloaded.height})`,
    );
  });

  const manifest = {
    assetVersion: coverAssetVersion,
    updatedAt: new Date().toISOString(),
    coverCount: Object.keys(nextCovers).length,
    missingCount: missing.length,
    covers: nextCovers,
    missing,
  };

  const referencedFiles = new Set(
    Object.values(nextCovers)
      .flatMap((entry) =>
        [entry.filename].concat((entry.candidates ?? []).map((candidate) => candidate.filename)),
      )
      .filter(Boolean),
  );

  const staleEntries = (await readdir(coverDir, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && !referencedFiles.has(entry.name),
  );

  // Publish the complete manifest before removing assets that it supersedes.
  const temporaryManifestPath = `${manifestPath}.tmp`;
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryManifestPath, manifestPath);
  const lowResolution = Object.values(nextCovers)
    .filter((cover) => cover.height < 1000)
    .map((cover) => ({
      title: cover.title,
      author: cover.author,
      width: cover.width,
      height: cover.height,
      sourceUrl: cover.sourceUrl ?? null,
    }));
  await writeFile(
    path.join(projectRoot, "data", "bookshelf-cover-quality.json"),
    `${JSON.stringify({ targetHeight: 1000, coverCount: manifest.coverCount, unresolved: lowResolution }, null, 2)}\n`,
  );

  await Promise.all(
    staleEntries.map((entry) => rm(path.join(coverDir, entry.name), { force: true })),
  );

  console.log(
    `[bookshelf:covers] Complete. ${manifest.coverCount} covers available, ${manifest.missingCount} still missing.`,
  );
}

main().catch((error) => {
  console.error(
    `[bookshelf:covers] Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
