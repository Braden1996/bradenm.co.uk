import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function atlasFingerprint() {
  const files = [
    "data/bookshelf.json",
    "data/bookshelf-covers.json",
    "src/features/bookshelf/lib/atlas-layout.ts",
    "src/features/bookshelf/client/atlas-scene.ts",
    "src/features/bookshelf/client/atlas-lighting.ts",
    "scripts/lib/atlas-preview-renderer.ts",
    "src/features/bookshelf/lib/atlas-sheet.ts",
    "scripts/sync-bookshelf-atlas.ts",
  ];
  const hash = createHash("sha256");
  for (const content of await Promise.all(files.map((file) => readFile(file))))
    hash.update(content);
  return hash.digest("hex");
}
