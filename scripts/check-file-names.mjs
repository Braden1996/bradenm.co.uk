#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const allowedPaths = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "Dockerfile",
  "README.md",
  "public/_headers",
]);
const kebabSegmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isHiddenPath(filePath) {
  return filePath.split("/").some((segment) => segment.startsWith("."));
}

function isLowerKebabFileName(fileName) {
  return fileName.split(".").every((segment) => kebabSegmentPattern.test(segment));
}

function existsWithExactCase(filePath) {
  let currentPath = process.cwd();

  for (const segment of filePath.split("/")) {
    try {
      if (!readdirSync(currentPath).includes(segment)) {
        return false;
      }
    } catch {
      return false;
    }

    currentPath = path.join(currentPath, segment);
  }

  return true;
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((filePath) => existsWithExactCase(filePath))
  .toSorted((left, right) => left.localeCompare(right));

const violations = files.filter((filePath) => {
  if (allowedPaths.has(filePath) || isHiddenPath(filePath)) {
    return false;
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  return !isLowerKebabFileName(fileName);
});

if (violations.length > 0) {
  console.error("Filename lint failed. Use lower kebab case for file names.");

  for (const filePath of violations) {
    console.error(`- ${filePath}`);
  }

  process.exit(1);
}
