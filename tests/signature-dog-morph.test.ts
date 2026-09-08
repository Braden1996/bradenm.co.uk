import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { array, number, object, parse, record, string } from "valibot";
import { signatureDogFrame, type DogGaze } from "../src/features/about/lib/signature-dog";
import {
  createSignatureDogVertices,
  decodeSignatureDogMotion,
  signatureDogVertices,
} from "../src/features/about/lib/signature-dog-morph";

const assetDirectory = new URL("../public/about/signature/", import.meta.url);
const metadata = parse(
  object({
    byteLength: number(),
    sha256: string(),
    sources: record(string(), string()),
    ownership: object({ source: string(), sha256: string() }),
  }),
  JSON.parse(await readFile(new URL("dog-motion.json", assetDirectory), "utf8")),
);
const pixels = await sharp(fileURLToPath(new URL("dog-motion.png", assetDirectory)))
  .ensureAlpha()
  .raw()
  .toBuffer();
const decodedMotion = decodeSignatureDogMotion(new Uint8ClampedArray(pixels));
if (!decodedMotion) throw new Error("The checked-in motion image could not be decoded");
const motion = decodedMotion;
// A fixed torso pixel belongs to a mesh cell. All four corners must stay fixed
// so interpolation cannot drag the pixel even when its own position is static.
const fixedVertices = parse(
  array(array(array(number()))),
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--eval",
        `
import { headWeight } from "./images/source/signature/rig-dog.mjs";
const result = ["seated", "lying"].map((pose) =>
  Array.from({ length: 35 }, (_, frame) => {
    const fixed = new Set();
    for (let y = 0; y < 180; y++) {
      for (let x = 0; x < 150; x++) {
        if (headWeight(x * 2, y * 2, pose, frame)) continue;
        const left = Math.floor(x / 10);
        const top = Math.floor(y / 10);
        for (const row of [top, top + 1]) {
          for (const column of [left, left + 1]) fixed.add(row * 16 + column);
        }
      }
    }
    return [...fixed];
  }),
);
process.stdout.write(JSON.stringify(result));
`,
      ],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" },
    ),
  ),
);

const columns = 16;
const rows = 19;
const width = 150;
const height = 180;
const offsets = [-0.62, -0.38, 0, 0.38, 0.62];
const identity = Float32Array.from(
  Array.from({ length: rows }, (_rowValue, row) =>
    Array.from({ length: columns }, (_columnValue, column) => [
      (column * 10) / width,
      (row * 10) / height,
    ]),
  ).flat(2),
);

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function vertices(pose: number, sourcePose: number, gaze: DogGaze, sourceGaze = gaze) {
  const positions = createSignatureDogVertices();
  signatureDogVertices(positions, motion, pose, sourcePose, gaze, sourceGaze);
  return positions;
}

function point(positions: Float32Array, column: number, row: number) {
  const index = (row * columns + column) * 2;
  return [(positions[index] ?? NaN) * width, (positions[index + 1] ?? NaN) * height] as const;
}

function triangleArea(
  first: readonly [number, number],
  second: readonly [number, number],
  third: readonly [number, number],
) {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
  );
}

function meshDeformation(positions: Float32Array) {
  let minimumArea = Infinity;
  let minimumScale = Infinity;
  let maximumScale = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const topLeft = point(positions, column, row);
      const topRight = point(positions, column + 1, row);
      const bottomLeft = point(positions, column, row + 1);
      const bottomRight = point(positions, column + 1, row + 1);
      for (const [first, second, third] of [
        [topLeft, topRight, bottomLeft],
        [bottomRight, bottomLeft, topRight],
      ] as const) {
        const area = triangleArea(first, second, third);
        minimumArea = Math.min(minimumArea, area);
        // The singular values of the triangle's 2D mapping measure its most
        // compressed and stretched directions, including shear. Positive area
        // alone allowed a visible neck triangle to shrink to 35% of its width.
        const squaredTrace =
          ((second[0] - first[0]) ** 2 +
            (second[1] - first[1]) ** 2 +
            (third[0] - first[0]) ** 2 +
            (third[1] - first[1]) ** 2) /
          100;
        const discriminant = Math.sqrt(Math.max(0, squaredTrace ** 2 - 4 * (area / 100) ** 2));
        minimumScale = Math.min(minimumScale, Math.sqrt((squaredTrace - discriminant) / 2));
        maximumScale = Math.max(maximumScale, Math.sqrt((squaredTrace + discriminant) / 2));
      }
    }
  }
  return { minimumArea, minimumScale, maximumScale };
}

function fixedRegionDrift(positions: Float32Array, fixed: (x: number, y: number) => boolean) {
  let maximum = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!fixed(column * 10, row * 10)) continue;
      const offset = (row * columns + column) * 2;
      maximum = Math.max(
        maximum,
        Math.abs((positions[offset] ?? NaN) - (identity[offset] ?? NaN)),
        Math.abs((positions[offset + 1] ?? NaN) - (identity[offset + 1] ?? NaN)),
      );
    }
  }
  return maximum;
}

describe("signature dog motion data", () => {
  test("opaque PNG channels decode to the generated signed motion payload", () => {
    const encoded = Buffer.alloc(motion.byteLength);
    motion.forEach((value, index) => encoded.writeInt16LE(value, index * 2));
    expect(encoded.byteLength).toBe(metadata.byteLength);
    expect(hash(encoded)).toBe(metadata.sha256);
    expect(motion.some((value) => value < 0)).toBe(true);
    expect(motion.some((value) => value > 0)).toBe(true);
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 255) throw new Error("Numeric image channels must be fully opaque");
    }
    expect(decodeSignatureDogMotion(new Uint8ClampedArray(4))).toBeUndefined();
  });

  test("measurements match all three current artwork atlases", async () => {
    expect(Object.keys(metadata.sources).toSorted()).toEqual([
      "dog-lying.webp",
      "dog-seated.webp",
      "dog-sprites.webp",
    ]);
    await Promise.all(
      Object.entries(metadata.sources).map(async ([name, expectedHash]) => {
        expect(hash(await readFile(new URL(name, assetDirectory))), name).toBe(expectedHash);
      }),
    );
    expect(hash(await readFile(new URL(`../${metadata.ownership.source}`, import.meta.url)))).toBe(
      metadata.ownership.sha256,
    );
  });

  test("gaze measurements cannot move canonical chest pixels in either drawing", () => {
    const directions = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ] as const;
    for (let pose = 0; pose < 2; pose++) {
      for (let frame = 0; frame < 35; frame++) {
        const row = Math.floor(frame / 7);
        const column = frame % 7;
        for (const [direction, [dx, dy]] of directions.entries()) {
          const targetColumn = column + dx;
          const targetRow = row + dy;
          const target =
            targetColumn < 0 || targetColumn > 6 || targetRow < 0 || targetRow > 4
              ? frame
              : targetRow * 7 + targetColumn;
          const fixed = new Set([
            ...(fixedVertices[pose]?.[frame] ?? []),
            ...(fixedVertices[pose]?.[target] ?? []),
          ]);
          expect(fixed.size).toBeGreaterThan(100);
          let maximum = 0;
          for (const vertex of fixed) {
            const offset = (((pose * 35 + frame) * 8 + direction) * 304 + vertex) * 2;
            maximum = Math.max(
              maximum,
              Math.abs(motion[offset] ?? NaN),
              Math.abs(motion[offset + 1] ?? NaN),
            );
          }
          expect(maximum, `pose ${pose}, frame ${frame}, direction ${direction}`).toBe(0);
        }
      }
    }
  });
});

describe("signature dog mesh motion", () => {
  test("every exact drawing retains the original regular grid", () => {
    for (const pose of [0, 6]) {
      for (let row = 0; row < 5; row++) {
        for (let column = 0; column < 7; column++) {
          expect(vertices(pose, pose, { column, row })).toEqual(identity);
        }
      }
    }
    for (let pose = 1; pose < 6; pose++) {
      expect(vertices(pose, pose, { column: 1, row: 2 })).toEqual(identity);
    }
  });

  test.each([
    { name: "seated", pose: 0, fixed: (_x: number, y: number) => y >= 90 },
    { name: "lying", pose: 6, fixed: (x: number, y: number) => y >= 130 || x >= 110 },
  ])("$name head motion preserves its fixed body through diagonal turns", ({ pose, fixed }) => {
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 7; column++) {
        for (const horizontal of offsets) {
          for (const vertical of offsets) {
            const gaze = {
              column: Math.max(0, Math.min(6, column + horizontal)),
              row: Math.max(0, Math.min(4, row + vertical)),
            };
            // Use the actual retained texture, including the far side of the
            // half-frame boundary where the previous drawing remains selected.
            const source = signatureDogFrame(gaze, { column, row });
            const positions = vertices(pose, pose, gaze, source);
            const deformation = meshDeformation(positions);
            expect(fixedRegionDrift(positions, fixed)).toBe(0);
            expect(deformation.minimumArea).toBeGreaterThan(0);
            expect(deformation.minimumScale).toBeGreaterThanOrEqual(0.65 - 0.00001);
            expect(deformation.maximumScale).toBeLessThanOrEqual(1.35 + 0.00001);
          }
        }
      }
    }
  });

  test("nearby angles move facial geometry while keeping the same sharp texture", () => {
    const source = { column: 3, row: 2 };
    const firstGaze = { column: 3.16, row: 2 };
    const secondGaze = { column: 3.28, row: 2 };
    expect(signatureDogFrame(firstGaze, source)).toEqual(source);
    expect(signatureDogFrame(secondGaze, source)).toEqual(source);
    const first = vertices(0, 0, firstGaze, source);
    const second = vertices(0, 0, secondGaze, source);
    // The mesh point beside the frontal muzzle advances before a sprite swap.
    expect(point(second, 7, 6)[0] - point(first, 7, 6)[0]).toBeGreaterThan(0.5);
    expect(point(second, 7, 13)).toEqual(point(first, 7, 13));
  });

  test("body movement and reversals keep the baseline fixed without folding", () => {
    const gaze = { column: 1, row: 2 };
    let movingSamples = 0;
    for (let lower = 0; lower < 6; lower++) {
      for (const fraction of [0.1, 0.38, 0.5, 0.62]) {
        for (const [pose, sourcePose] of [
          [lower + fraction, lower],
          [lower + 1 - fraction, lower + 1],
        ] as const) {
          const positions = vertices(pose, sourcePose, gaze);
          const deformation = meshDeformation(positions);
          expect(fixedRegionDrift(positions, (_x, y) => y >= 170)).toBe(0);
          expect(deformation.minimumArea).toBeGreaterThan(0);
          expect(deformation.minimumScale).toBeGreaterThanOrEqual(0.65 - 0.00001);
          expect(deformation.maximumScale).toBeLessThanOrEqual(1.35 + 0.00001);
          if (positions.some((value, index) => value !== identity[index])) movingSamples++;
        }
      }
    }
    expect(movingSamples).toBe(48);
  });
});
