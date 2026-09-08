import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "dist");
const requiredFiles = [
  "index.html",
  "404.html",
  "bookshelf/index.html",
  "bookshelf/details.json",
  "_headers",
];

await Promise.all(
  requiredFiles.map(async (file) => {
    const info = await stat(path.join(output, file));
    if (!info.isFile() || info.size === 0) throw new Error(`Missing deployment output: ${file}`);
  }),
);

async function inspectDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return inspectDirectory(filename);
      if (!entry.isFile()) {
        throw new Error(`Deployment output must contain regular files: ${filename}`);
      }
      const { size } = await stat(filename);
      if (size > 25 * 1024 * 1024) {
        throw new Error(`File exceeds the Cloudflare Pages 25 MiB limit: ${filename}`);
      }
      return size;
    }),
  );
  return sizes.flat();
}

const sizes = await inspectDirectory(output);
if (sizes.length > 20_000) throw new Error(`Cloudflare Pages file limit exceeded: ${sizes.length}`);
const totalBytes = sizes.reduce((total, size) => total + size, 0);
console.log(`Cloudflare Pages output verified: ${sizes.length} files, ${totalBytes} bytes.`);
