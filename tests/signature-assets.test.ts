import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { array, number, object, parse, string } from "valibot";

const columns = 7;
const rows = 5;
const frameWidth = 150;
const frameHeight = 180;

type Region = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Compare visible pixels only: an encoder may change colours under zero alpha. */
function visibleRegion(pixels: Buffer, atlasWidth: number, frame: number, region: Region) {
  const result = Buffer.alloc(region.width * region.height * 4);
  const originX = (frame % columns) * frameWidth + region.left;
  const originY = Math.floor(frame / columns) * frameHeight + region.top;

  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const source = ((originY + y) * atlasWidth + originX + x) * 4;
      if (pixels[source + 3] !== 0) {
        pixels.copy(result, (y * region.width + x) * 4, source, source + 4);
      }
    }
  }
  return result;
}

function changedPixels(first: Buffer, second: Buffer) {
  let changed = 0;
  for (let offset = 0; offset < first.length; offset += 4) {
    if (
      first[offset] !== second[offset] ||
      first[offset + 1] !== second[offset + 1] ||
      first[offset + 2] !== second[offset + 2] ||
      first[offset + 3] !== second[offset + 3]
    ) {
      changed += 1;
    }
  }
  return changed;
}

const poses = [
  {
    name: "seated",
    headBottom: 114,
    collarTop: 90,
    collarBottom: 96,
    regions: [{ name: "lower body and ground", left: 0, top: 114, width: 150, height: 66 }],
  },
  {
    name: "lying",
    headBottom: 148,
    collarTop: 128,
    collarBottom: 135,
    regions: [
      { name: "paws and ground", left: 0, top: 148, width: 150, height: 32 },
      { name: "back and hindquarters", left: 115, top: 119, width: 35, height: 61 },
    ],
  },
];

describe("signature dog artwork", () => {
  test("lowered muzzles keep their projection while the rear neck fits the body", () => {
    // Use opposite head silhouettes over identical lower bodies so registration
    // cannot account for any change in the projecting nose. No artwork fixture
    // or knowledge of the collar's fitting formula is needed for this check.
    const measurements = parse(
      array(
        object({
          side: string(),
          muzzleDrift: number(),
          rearInset: number(),
          bodyChanges: number(),
        }),
      ),
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--eval",
            `
import { rigDogFrames } from "./images/source/signature/rig-dog.mjs";
const width = 300;
const height = 360;
function rectangle(pixels, left, top, right, bottom, colour) {
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      pixels.set(colour, (y * width + x) * 4);
    }
  }
}
const result = [
  { side: "left", frame: 29, left: 55, right: 215 },
  { side: "right", frame: 33, left: 85, right: 245 },
].map(({ side, frame, left, right }) => {
  const source = Buffer.alloc(width * height * 4);
  const reference = Buffer.alloc(width * height * 4);
  for (const pixels of [source, reference]) {
    rectangle(pixels, 100, 170, 210, 335, [80, 60, 40, 255]);
  }
  rectangle(source, left, 80, right, 160, [110, 90, 70, 255]);
  rectangle(reference, 105, 80, 195, 160, [110, 90, 70, 255]);
  // An unrelated marking above the registration area must not replace the bib.
  rectangle(source, 130, 185, 150, 205, [220, 170, 40, 255]);
  const output = rigDogFrames(Array(frame + 1).fill(source), reference, width, height, "seated")[frame];
  let muzzleDrift = 0;
  let rearInset = 0;
  for (let y = 125; y <= 145; y++) {
    let first = width;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (output[(y * width + x) * 4 + 3] < 128) continue;
      first = Math.min(first, x);
      last = x;
    }
    muzzleDrift = Math.max(muzzleDrift, Math.abs(side === "left" ? first - left : last - (right - 1)));
    if (y === 145) rearInset = side === "left" ? right - 1 - last : first - left;
  }
  let bodyChanges = 0;
  for (let index = 180 * width * 4; index < output.length; index++) {
    if (output[index] !== reference[index]) bodyChanges++;
  }
  return { side, muzzleDrift, rearInset, bodyChanges };
});
process.stdout.write(JSON.stringify(result));
`,
          ],
          { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" },
        ),
      ),
    );

    for (const measurement of measurements) {
      expect(
        measurement.muzzleDrift,
        `${measurement.side}: the nose was pulled into the face`,
      ).toBeLessThanOrEqual(1);
      expect(
        measurement.rearInset,
        `${measurement.side}: the rear neck stopped fitting`,
      ).toBeGreaterThan(5);
      expect(measurement.bodyChanges, `${measurement.side}: the fixed torso changed`).toBe(0);
    }
  });

  test.each([
    { name: "seated", left: 64, width: 24, upper: 92, lower: 104, bottom: 114 },
    { name: "lying", left: 50, width: 24, upper: 132, lower: 138, bottom: 148 },
  ])("$name uses the same chest markings across head angles", async (pose) => {
    const path = fileURLToPath(
      new URL(`../public/about/signature/dog-${pose.name}.webp`, import.meta.url),
    );
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let frame = 0; frame < columns * rows; frame += 1) {
      const row = Math.floor(frame / columns);
      const column = frame % columns;
      // A lowered forward-facing jaw may cover the top of the bib. The
      // exposed white fur beneath it must still be the very same painting.
      // Sample below the resized edge's filter support, not its feather.
      const jawOverlaps = row >= 3 && column >= 2 && column <= 4;
      const top = jawOverlaps ? pose.lower : pose.upper;
      const region = {
        name: "chest markings",
        left: pose.left,
        top,
        width: pose.width,
        height: pose.bottom - top,
      };
      expect(
        changedPixels(
          visibleRegion(data, info.width, 0, region),
          visibleRegion(data, info.width, frame, region),
        ),
        `${pose.name} frame ${frame}: the exposed chest changed with the head angle`,
      ).toBe(0);
    }
  });

  test("the right-facing seated neck has no extra shoulder bulge", async () => {
    const path = fileURLToPath(
      new URL("../public/about/signature/dog-seated.webp", import.meta.url),
    );
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const edges: number[] = [];
    // Follow the back of the neck from below the ear into the shoulder in
    // the reported level/profile pose. The old join protruded six pixels
    // beyond both endpoints, forming a second hump behind the head.
    for (let y = 65; y <= 94; y += 1) {
      let edge = frameWidth;
      for (let x = 0; x < frameWidth; x += 1) {
        if ((data[((2 * frameHeight + y) * info.width + 6 * frameWidth + x) * 4 + 3] ?? 0) >= 64) {
          edge = x;
          break;
        }
      }
      expect(edge).toBeLessThan(frameWidth);
      edges.push(edge);
    }
    const endpoints = Math.min(edges[0] ?? 0, edges.at(-1) ?? 0);
    expect(endpoints - Math.min(...edges)).toBeLessThanOrEqual(2);
  });

  test.each(poses)("$name collar meets the body without a cut edge", async (pose) => {
    const path = fileURLToPath(
      new URL(`../public/about/signature/dog-${pose.name}.webp`, import.meta.url),
    );
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let frame = 0; frame < columns * rows; frame += 1) {
      let previousLeft = 0;
      let previousRight = 0;
      for (let y = pose.collarTop; y <= pose.collarBottom; y += 1) {
        let left = frameWidth;
        let right = -1;
        for (let x = 0; x < frameWidth; x += 1) {
          const sourceX = (frame % columns) * frameWidth + x;
          const sourceY = Math.floor(frame / columns) * frameHeight + y;
          if ((data[(sourceY * info.width + sourceX) * 4 + 3] ?? 0) < 64) continue;
          left = Math.min(left, x);
          right = x;
        }
        expect(right).toBeGreaterThan(left);
        if (y > pose.collarTop) {
          // The old horizontal mask cut up to 12 pixels off the neck in one
          // row. Allow small fur details while rejecting that shoulder shelf.
          const location = `${pose.name} frame ${frame}, row ${y}`;
          expect(Math.abs(left - previousLeft), `${location}: left edge`).toBeLessThanOrEqual(2);
          if (pose.name === "seated") {
            expect(Math.abs(right - previousRight), `${location}: right edge`).toBeLessThanOrEqual(
              2,
            );
          }
        }
        previousLeft = left;
        previousRight = right;
      }
    }
  });

  test.each(poses)("$name gaze keeps the body anchored across all 35 drawings", async (pose) => {
    const path = fileURLToPath(
      new URL(`../public/about/signature/dog-${pose.name}.webp`, import.meta.url),
    );
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(columns * frameWidth);
    expect(info.height).toBe(rows * frameHeight);
    expect(info.channels).toBe(4);

    // These visible landmarks must not move, resize, fade, or change texture
    // when the cursor crosses a row or column in the head-angle atlas.
    for (const region of pose.regions) {
      const reference = visibleRegion(data, info.width, 0, region);
      for (let frame = 1; frame < columns * rows; frame += 1) {
        const actual = visibleRegion(data, info.width, frame, region);
        expect(
          changedPixels(reference, actual),
          `${pose.name} frame ${frame}: ${region.name} changed while only the head should move`,
        ).toBe(0);
      }
    }

    // A fixed body must still accompany the complete set of distinct head
    // drawings, rather than accidentally repeating a static frame.
    const heads = new Set<string>();
    for (let frame = 0; frame < columns * rows; frame += 1) {
      const head = visibleRegion(data, info.width, frame, {
        name: "head",
        left: 0,
        top: 0,
        width: frameWidth,
        height: pose.headBottom,
      });
      heads.add(createHash("sha256").update(head).digest("hex"));
    }
    expect(heads.size).toBe(35);
  });
});
