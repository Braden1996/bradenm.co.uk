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
const coverAssetVersion = 1;
const coverOutputWidth = 96;
const coverWebpQuality = 80;
const coverFingerprintLength = 12;
const force = process.argv.includes("--force");
const concurrency = 4;

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

async function writeOptimizedCover(book, input) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({
      width: coverOutputWidth,
      withoutEnlargement: true,
    })
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "bradenm.co.uk bookshelf cover sync",
      accept: "application/json",
    },
  });

  if (!response.ok) {
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
    });

    if (attempt.author) {
      params.set("author", attempt.author);
    }

    // Stop once we find a strong match instead of exhaustively querying every variant.
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(`https://openlibrary.org/search.json?${params.toString()}`);
    const candidate = (data.docs ?? [])
      .filter((entry) => entry.cover_i)
      .map((entry) => ({
        provider: "openlibrary",
        score:
          scoreMatch(normalizeText(entry.title ?? ""), expectedTitle) +
          scoreMatch(normalizeText((entry.author_name ?? []).join(" ")), expectedAuthor),
        imageUrl: `https://covers.openlibrary.org/b/id/${entry.cover_i}-L.jpg?default=false`,
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

async function resolveCoverCandidate(book) {
  const providers = [searchGoogleBooks, searchOpenLibrary];

  for (const provider of providers) {
    try {
      // Keep provider preference stable so the first preferred source wins.
      // eslint-disable-next-line no-await-in-loop
      const candidate = await provider(book);

      if (candidate) {
        return candidate;
      }
    } catch (error) {
      console.warn(
        `[bookshelf:covers] Provider failed for "${book.title}" (${book.author}): ${String(error)}`,
      );
    }
  }

  return null;
}

async function downloadCover(book, candidate) {
  const response = await fetch(candidate.imageUrl, {
    headers: {
      "user-agent": "bradenm.co.uk bookshelf cover sync",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Image download failed with ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  return writeOptimizedCover(book, bytes);
}

async function removeIfExists(targetPath) {
  if (await fileExists(targetPath)) {
    await rm(targetPath, { force: true });
  }
}

async function reuseExistingCover(book, existingCover, assetsAreCurrent) {
  const currentPath = path.join(coverDir, existingCover.filename);
  const fingerprint = existingCover.filename.match(/\.([a-f0-9]{12})\.webp$/)?.[1];
  const canKeepAsset =
    assetsAreCurrent &&
    fingerprint &&
    Number(existingCover.width) > 0 &&
    Number(existingCover.height) > 0;
  let asset;

  if (canKeepAsset) {
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
    asset = await writeOptimizedCover(book, currentPath);
  }

  const metadataMatches =
    existingCover.title === book.title && existingCover.author === book.author;

  return {
    title: book.title,
    author: book.author,
    ...asset,
    provider: existingCover.provider,
    matchedTitle: metadataMatches ? existingCover.matchedTitle : book.title,
    matchedAuthor: metadataMatches ? existingCover.matchedAuthor : book.author,
    fetchedAt: existingCover.fetchedAt,
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

  await mapWithConcurrency(books, concurrency, async (book) => {
    const existing =
      existingManifest.covers[book.key] ??
      findReusableExistingEntry(book, existingTitleIndex)?.cover;
    const existingPath = existing?.filename ? path.join(coverDir, existing.filename) : "";

    if (!force && existing?.src && existingPath && (await fileExists(existingPath))) {
      nextCovers[book.key] = await reuseExistingCover(book, existing, assetsAreCurrent);
      console.log(`[bookshelf:covers] ${assetsAreCurrent ? "Keep " : "Build"} ${book.title}`);
      return;
    }

    const candidate = await resolveCoverCandidate(book);

    if (!candidate) {
      missing.push({
        key: book.key,
        title: book.title,
        author: book.author,
      });
      console.log(`[bookshelf:covers] Miss  ${book.title}`);
      return;
    }

    const downloaded = await downloadCover(book, candidate);

    if (existing?.filename && existing.filename !== downloaded.filename) {
      await removeIfExists(path.join(coverDir, existing.filename));
    }

    nextCovers[book.key] = {
      title: book.title,
      author: book.author,
      filename: downloaded.filename,
      src: downloaded.src,
      width: downloaded.width,
      height: downloaded.height,
      provider: candidate.provider,
      matchedTitle: candidate.matchedTitle,
      matchedAuthor: candidate.matchedAuthor,
      fetchedAt: new Date().toISOString(),
    };

    console.log(`[bookshelf:covers] Saved ${book.title} <- ${candidate.provider}`);
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
      .map((entry) => entry.filename)
      .filter(Boolean),
  );

  const staleEntries = (await readdir(coverDir, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && !referencedFiles.has(entry.name),
  );

  await Promise.all(
    staleEntries.map((entry) => rm(path.join(coverDir, entry.name), { force: true })),
  );

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
