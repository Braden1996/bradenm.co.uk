import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const output = path.join(root, "assets", "glyph-atlas.png");
const font = path.join(root, "assets", "fira-code-nerd-font-mono-regular.ttf");

const cells = 8;
const cellSize = 128;
const atlasSize = cells * cellSize;

// Ordered from the lightest/narrowest marks to the heaviest. Every tonal row
// keeps recognisable type in the mix so the reduced website render reads as a
// field of characters rather than generic stipple. Row four remains structural
// because the shader uses it for stable, source-directed contour marks.
const rows = [
  ["1", "i", "l", "I", "t", "f", "r", "j"],
  ["2", "3", "4", "5", "6", "7", "s", "c"],
  ["a", "e", "o", "n", "u", "x", "z", "v"],
  ["+", "×", "=", "<", ">", "[", "]", "◇"],
  ["0", "6", "8", "9", "B", "D", "P", "R"],
  ["A", "E", "H", "N", "K", "M", "W", "X"],
  ["8", "B", "R", "M", "W", "@", "#", "%"],
  ["@", "#", "8", "B", "R", "M", "W", "X"],
];

const escapeXml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const glyphs = [];
for (let row = 0; row < cells; row++) {
  for (let column = 0; column < cells; column++) {
    const x = column * cellSize + cellSize / 2;
    const y = row * cellSize + cellSize * 0.54;
    glyphs.push(
      `<text x="${x}" y="${y}" font-size="96" text-anchor="middle" dominant-baseline="central">${escapeXml(rows[row][column])}</text>`,
    );
  }
}

const svg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${atlasSize}" height="${atlasSize}">
    <style>
      @font-face {
        font-family: "Portrait Mono";
        src: url("file://${font}");
      }
      text {
        fill: white;
        font-family: "Portrait Mono", monospace;
        font-weight: 500;
      }
    </style>
    <rect width="100%" height="100%" fill="black" />
    ${glyphs.join("\n")}
  </svg>
`);

await sharp(svg, { density: 192 })
  .resize(atlasSize, atlasSize, { kernel: sharp.kernel.lanczos3 })
  .greyscale()
  .png({ compressionLevel: 9 })
  .toFile(output);

console.log(output);
