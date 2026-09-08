import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const touchDesignerDirectory = path.resolve(scriptDirectory, "..");
const sourcePath = path.join(touchDesignerDirectory, "assets/reference-glyph-source.png");
const outputPath = path.join(touchDesignerDirectory, "assets/reference-glyph-atlas.png");

const columns = 39;
const rows = 24;
const atlasColumns = 32;
const atlasRows = 32;
const atlasCellSize = 32;
const paper = [248, 245, 237];
const ink = [54, 43, 34];

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function bilinear(buffer, width, height, x, y) {
  const sampleX = clamp(x, 0, width - 1.001);
  const sampleY = clamp(y, 0, height - 1.001);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fractionX = sampleX - x0;
  const fractionY = sampleY - y0;
  const top = mix(buffer[y0 * width + x0], buffer[y0 * width + x1], fractionX);
  const bottom = mix(buffer[y1 * width + x0], buffer[y1 * width + x1], fractionX);

  return mix(top, bottom, fractionY);
}

const source = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const sourceAlpha = Buffer.alloc(source.info.width * source.info.height);

for (let index = 0; index < sourceAlpha.length; index += 1) {
  const sourceIndex = index * source.info.channels;
  const estimates = [0, 1, 2]
    .map((channel) =>
      clamp(
        (paper[channel] - source.data[sourceIndex + channel]) / (paper[channel] - ink[channel]),
      ),
    )
    .toSorted((a, b) => a - b);
  sourceAlpha[index] = Math.round(255 * Math.pow(clamp((estimates[1] - 0.025) / 0.91), 0.84));
}

const pitchX = source.info.width / columns;
const pitchY = source.info.height / rows;
const cellStatistics = [];

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const values = [];
    const x0 = Math.floor(column * pitchX);
    const x1 = Math.ceil((column + 1) * pitchX);
    const y0 = Math.floor(row * pitchY);
    const y1 = Math.ceil((row + 1) * pitchY);

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        values.push(sourceAlpha[y * source.info.width + x] / 255);
      }
    }

    const sortedValues = values.toSorted((a, b) => a - b);
    const percentile = (amount) => sortedValues[Math.floor((sortedValues.length - 1) * amount)];
    const low = percentile(0.12);
    const high = Math.max(low + 0.24, percentile(0.9));
    cellStatistics.push({ column, high, low, row });
  }
}

function sampleCell(cellIndex, localX, localY) {
  const cell = cellStatistics[cellIndex];
  const sampleX = cell.column * pitchX + clamp(localX) * (pitchX - 0.001);
  const sampleY = cell.row * pitchY + clamp(localY) * (pitchY - 0.001);
  const value =
    bilinear(sourceAlpha, source.info.width, source.info.height, sampleX, sampleY) / 255;

  return Math.pow(clamp((value - cell.low) / (cell.high - cell.low)), 0.78);
}

const atlasWidth = atlasColumns * atlasCellSize;
const atlasHeight = atlasRows * atlasCellSize;
const atlas = Buffer.alloc(atlasWidth * atlasHeight);

for (let cellIndex = 0; cellIndex < cellStatistics.length; cellIndex += 1) {
  const atlasColumn = cellIndex % atlasColumns;
  const atlasRow = Math.floor(cellIndex / atlasColumns);

  for (let y = 0; y < atlasCellSize; y += 1) {
    for (let x = 0; x < atlasCellSize; x += 1) {
      const destinationX = atlasColumn * atlasCellSize + x;
      const destinationY = atlasRow * atlasCellSize + y;
      atlas[destinationY * atlasWidth + destinationX] = Math.round(
        255 * sampleCell(cellIndex, (x + 0.5) / atlasCellSize, (y + 0.5) / atlasCellSize),
      );
    }
  }
}

await sharp(atlas, {
  raw: { channels: 1, height: atlasHeight, width: atlasWidth },
})
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(`Wrote ${cellStatistics.length} fixed glyph cells to ${outputPath}`);
