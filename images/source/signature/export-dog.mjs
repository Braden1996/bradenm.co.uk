import sharp from "sharp";
import { rigDogFrames } from "./rig-dog.mjs";

const width = 300;
const height = 360;
const sourceDirectory = "images/source/signature";
const outputDirectory = "public/about/signature";
const bodyReferences = new Map();

async function cutout(source, region) {
  const [left, top, cropWidth, cropHeight] = region;
  const { data, info } = await sharp(source)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Flood only pale pixels connected to the outer background, preserving
  // the enclosed white chest. The website blends the remaining edge into paper.
  const visited = new Uint8Array(info.width * info.height);
  const queue = [];
  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const pixel = y * info.width + x;
    const offset = pixel * 4;
    const lightest = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const darkest = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    if (visited[pixel] || darkest < 218 || lightest - darkest > 28) return;
    visited[pixel] = 1;
    queue.push(pixel);
  }
  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    data[pixel * 4 + 3] = 0;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  // Some source gutters contain a detached tail or grass from a neighbour.
  // Keep the connected dog before measuring its bounds; otherwise that
  // unrelated fragment changes the size and anchor of the entire drawing.
  const labels = new Int32Array(info.width * info.height);
  let label = 0;
  let largestLabel = 0;
  let largestSize = 0;
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] || !data[pixel * 4 + 3]) continue;
    label += 1;
    const component = [pixel];
    labels[pixel] = label;
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = component[cursor];
      const x = current % info.width;
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x < info.width - 1 ? current + 1 : -1,
        current - info.width,
        current + info.width,
      ];
      for (const neighbour of neighbours) {
        if (
          neighbour < 0 ||
          neighbour >= labels.length ||
          labels[neighbour] ||
          !data[neighbour * 4 + 3]
        )
          continue;
        labels[neighbour] = label;
        component.push(neighbour);
      }
    }
    if (component.length > largestSize) {
      largestSize = component.length;
      largestLabel = label;
    }
  }
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] !== largestLabel) data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).trim({ threshold: 12 }).png().toBuffer();
}

async function exportFrames(sources, regions, columns, rows, pose) {
  const frames = await Promise.all(
    regions.map(async (region, index) => {
      const trimmed = await cutout(sources[Math.floor(index / columns)] ?? sources[0], region);
      const dimensions = await sharp(trimmed).metadata();
      let spriteWidth = pose === "seated" ? 224 : 248;
      let spriteHeight = Math.round((dimensions.height / dimensions.width) * spriteWidth);
      if (pose === "seated") {
        spriteHeight = [282, 276, 270, 262, 253][Math.floor(index / columns)];
      }
      if (pose === "lying") {
        spriteHeight = [197, 189, 180, 173, 166][Math.floor(index / columns)];
      }
      if (pose === "sprites") {
        spriteWidth = Math.round(dimensions.width * 0.82);
        spriteHeight = Math.round(dimensions.height * 0.82);
        // The generator compressed the transition row vertically. Restore
        // intermediate heights between the seated and resting endpoints.
        if (index >= 5 && index <= 9) {
          spriteWidth = [225, 231, 237, 243, 248][index - 5];
          spriteHeight = [258, 233, 210, 185, 170][index - 5];
        }
      }
      const sprite = await sharp(trimmed)
        .resize(spriteWidth, spriteHeight, { fit: "fill" })
        .png()
        .toBuffer();
      return sharp({ create: { width, height, channels: 4, background: "#00000000" } })
        .composite([
          {
            input: sprite,
            left: Math.round((width - spriteWidth) / 2),
            top: 340 - spriteHeight,
          },
        ])
        .raw()
        .toBuffer();
    }),
  );
  if (pose === "sprites") {
    bodyReferences.set("seated", frames[0]);
    bodyReferences.set("lying", frames[10]);
  }
  const aligned =
    pose === "sprites"
      ? frames
      : rigDogFrames(frames, bodyReferences.get(pose), width, height, pose);
  const layers = await Promise.all(
    aligned.map(async (frame, index) => ({
      input: await sharp(frame, { raw: { width, height, channels: 4 } })
        .resize(width / 2, height / 2)
        .png()
        .toBuffer(),
      left: ((index % columns) * width) / 2,
      top: (Math.floor(index / columns) * height) / 2,
    })),
  );
  const atlas = await sharp({
    create: {
      width: (width * columns) / 2,
      height: (height * rows) / 2,
      channels: 4,
      background: "#00000000",
    },
  })
    .composite(pose === "sprites" ? layers.slice(5, 10) : layers)
    .png()
    .toBuffer();
  await sharp(atlas)
    .webp({ lossless: true, effort: 6 })
    .toFile(`${outputDirectory}/dog-${pose}.webp`);
}

function gridRegions(columns, rows) {
  return rows
    .slice(0, -1)
    .flatMap((top, row) =>
      columns
        .slice(0, -1)
        .map((left, column) => [left, top, columns[column + 1] - left, rows[row + 1] - top]),
    );
}

// Read the actual blank gutters; generated image dimensions need not match
// the dimensions requested in the prompt. Runtime sheets use regular cells.
await exportFrames(
  [`${sourceDirectory}/dog-generated.png`],
  [
    [60, 25, 300, 360],
    [387, 25, 270, 360],
    [659, 25, 300, 360],
    [990, 25, 280, 360],
    [1286, 25, 320, 360],
    [30, 402, 315, 280],
    [348, 402, 300, 280],
    [645, 402, 318, 280],
    [975, 402, 315, 280],
    [1290, 402, 317, 280],
    [40, 708, 330, 239],
    [370, 708, 292, 239],
    [675, 708, 310, 239],
    [994, 708, 298, 239],
    [1293, 708, 317, 239],
  ],
  5,
  3,
  "sprites",
);
await exportFrames(
  [`${sourceDirectory}/dog-lying-generated.png`],
  gridRegions([0, 240, 445, 648, 850, 1053, 1255, 1484], [0, 238, 436, 637, 833, 1060]),
  7,
  5,
  "lying",
);
await exportFrames(
  ["up-30", "up-15", "level", "down-15", "down-30"].map(
    (name) => `${sourceDirectory}/dog-seated-rows/${name}.png`,
  ),
  [
    ...gridRegions([0, 313, 621, 931, 1241, 1551, 1862, 2172], [0, 724]),
    ...gridRegions([0, 310, 621, 931, 1241, 1551, 1862, 2172], [0, 724]),
    ...gridRegions([0, 312, 627, 931, 1241, 1551, 1862, 2172], [0, 724]),
    ...gridRegions([0, 259, 508, 760, 1014, 1267, 1521, 1774], [0, 887]),
    ...gridRegions([0, 320, 627, 931, 1241, 1551, 1862, 2172], [0, 724]),
  ],
  7,
  5,
  "seated",
);
