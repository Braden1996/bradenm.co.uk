// Bakes the portrait subject's silhouette into data/portrait-silhouette.json
// for the homepage text flow: the UNION of all 48 motion-frame mattes, so the
// moving body never touches a laid-out word, dilated by a margin and reduced
// to per-row body intervals in stage coordinates. Runs at build time only —
// sharp never ships to the browser.
//
//   bun run portrait:silhouette
//
// Deterministic: integer coordinates, stable ordering, sorted keys — a second
// run over the same mattes produces a byte-identical file.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MEDIA_TO_STAGE_X,
  MEDIA_WIDTH,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  loadMatteUnion,
} from "./lib/portrait-mattes.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(projectRoot, "data/portrait-silhouette.json");

// Low on purpose: soft matte edges count as body, erring toward whitespace.
const BODY_THRESHOLD = 32;
// One text line-height of breathing room around the body (stage px).
const MARGIN = 28;
// Output rows sample every 4 stage px; a text line maxes over its band.
const ROW_STEP = 4;
const OUTPUT_ROWS = STAGE_HEIGHT / ROW_STEP;
// Post-dilation cleanup: drop slivers, close unusable gaps.
const MIN_INTERVAL = 6;
const MIN_GAP = 24;

/** Per output row, which media columns contain body anywhere in the row band. */
function reduceToRowColumns(union) {
  const rows = [];

  for (let row = 0; row < OUTPUT_ROWS; row += 1) {
    const columns = new Uint8Array(MEDIA_WIDTH);

    for (let y = row * ROW_STEP; y < (row + 1) * ROW_STEP; y += 1) {
      const offset = y * MEDIA_WIDTH;

      for (let x = 0; x < MEDIA_WIDTH; x += 1) {
        if (union[offset + x] >= BODY_THRESHOLD) {
          columns[x] = 1;
        }
      }
    }

    rows.push(columns);
  }

  return rows;
}

/** Box dilation: OR neighbouring row bands vertically, then widen runs. */
function dilateRows(rows) {
  const verticalRadius = Math.ceil(MARGIN / ROW_STEP);
  const dilated = [];

  for (let row = 0; row < OUTPUT_ROWS; row += 1) {
    const columns = new Uint8Array(MEDIA_WIDTH);
    const first = Math.max(0, row - verticalRadius);
    const last = Math.min(OUTPUT_ROWS - 1, row + verticalRadius);

    for (let neighbour = first; neighbour <= last; neighbour += 1) {
      const source = rows[neighbour];

      for (let x = 0; x < MEDIA_WIDTH; x += 1) {
        if (source[x] === 1) {
          columns[x] = 1;
        }
      }
    }

    dilated.push(columns);
  }

  return dilated;
}

/** Column flags to merged, margin-extended intervals in stage coordinates. */
function rowToIntervals(columns) {
  const raw = [];
  let start = -1;

  for (let x = 0; x <= MEDIA_WIDTH; x += 1) {
    const body = x < MEDIA_WIDTH && columns[x] === 1;

    if (body && start === -1) {
      start = x;
    } else if (!body && start !== -1) {
      if (x - start >= MIN_INTERVAL) {
        raw.push([start - MARGIN, x - 1 + MARGIN]);
      }
      start = -1;
    }
  }

  const merged = [];

  for (const interval of raw) {
    const previous = merged[merged.length - 1];

    if (previous && interval[0] - previous[1] <= MIN_GAP) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }

  return merged.map(([left, right]) => [
    Math.max(0, Math.round(left + MEDIA_TO_STAGE_X)),
    Math.min(STAGE_WIDTH, Math.round(right + MEDIA_TO_STAGE_X)),
  ]);
}

const { frameCount, union } = await loadMatteUnion();
const rowColumns = reduceToRowColumns(union);
const rows = dilateRows(rowColumns).map(rowToIntervals);

let bodyLeft = STAGE_WIDTH;
let bodyRight = 0;

for (const intervals of rows) {
  for (const [left, right] of intervals) {
    bodyLeft = Math.min(bodyLeft, left);
    bodyRight = Math.max(bodyRight, right);
  }
}

const silhouette = {
  margin: MARGIN,
  rowStep: ROW_STEP,
  rows,
  splitX: Math.round((bodyLeft + bodyRight) / 2),
  stage: { height: STAGE_HEIGHT, width: STAGE_WIDTH },
  version: 1,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(silhouette)}\n`);

const size = JSON.stringify(silhouette).length;
console.log(
  `portrait-silhouette: ${frameCount} mattes → ${rows.length} rows, splitX ${silhouette.splitX}, ${(size / 1024).toFixed(1)} KB`,
);
