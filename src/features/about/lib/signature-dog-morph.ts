import type { DogGaze } from "./signature-dog";

const GRID_COLUMNS = 16;
const GRID_ROWS = 19;
const POINTS = GRID_COLUMNS * GRID_ROWS;
const VECTOR_SIZE = POINTS * 2;
const GAZE_VALUES = 2 * 35 * 8 * VECTOR_SIZE;
const MOTION_VALUES = GAZE_VALUES + 7 * 2 * VECTOR_SIZE;
const DIRECTIONS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** Numeric motion is packed in opaque RGB pixels so it loads under img-src. */
export function decodeSignatureDogMotion(pixels: Uint8ClampedArray) {
  if (pixels.length !== 512 * 455 * 4) return undefined;
  const motion = new Int16Array(MOTION_VALUES);
  for (let value = 0; value < motion.length; value++) {
    const byte = value * 2;
    const low = pixels[Math.floor(byte / 3) * 4 + (byte % 3)] ?? 0;
    const next = byte + 1;
    const high = pixels[Math.floor(next / 3) * 4 + (next % 3)] ?? 0;
    motion[value] = low | (high << 8);
  }
  return motion;
}

export function createSignatureDogVertices() {
  return new Float32Array(VECTOR_SIZE);
}

/** Warp one complete drawing toward the surrounding angular poses. */
export function signatureDogVertices(
  positions: Float32Array,
  motion: Int16Array,
  pose: number,
  sourcePose: number,
  gaze: DogGaze,
  sourceGaze: DogGaze,
) {
  const offsets: number[] = [];
  const weights: number[] = [];
  if (pose > 0 && pose < 6) {
    const direction = pose < sourcePose ? 0 : 1;
    offsets.push(GAZE_VALUES + (sourcePose * 2 + direction) * VECTOR_SIZE);
    weights.push(Math.abs(pose - sourcePose));
  } else {
    const column = Math.max(0, Math.min(6, gaze.column));
    const row = Math.max(0, Math.min(4, gaze.row));
    const left = Math.floor(column);
    const top = Math.floor(row);
    const across = column - left;
    const down = row - top;
    const source = sourceGaze.row * 7 + sourceGaze.column;
    for (let y = 0; y <= 1; y++) {
      for (let x = 0; x <= 1; x++) {
        const targetColumn = Math.min(6, left + x);
        const targetRow = Math.min(4, top + y);
        const direction = DIRECTIONS.findIndex(
          ([dx, dy]) =>
            dx === targetColumn - sourceGaze.column && dy === targetRow - sourceGaze.row,
        );
        const weight = (x ? across : 1 - across) * (y ? down : 1 - down);
        if (direction < 0 || !weight) continue;
        offsets.push(((pose === 0 ? 0 : 35) + source) * 8 * VECTOR_SIZE + direction * VECTOR_SIZE);
        weights.push(weight);
      }
    }
  }

  for (let point = 0; point < POINTS; point++) {
    let dx = 0;
    let dy = 0;
    for (let index = 0; index < offsets.length; index++) {
      const offset = (offsets[index] ?? 0) + point * 2;
      const weight = weights[index] ?? 0;
      dx += (motion[offset] ?? 0) * weight;
      dy += (motion[offset + 1] ?? 0) * weight;
    }
    positions[point * 2] = ((point % GRID_COLUMNS) * 10 + dx / 16) / 150;
    positions[point * 2 + 1] = (Math.floor(point / GRID_COLUMNS) * 10 + dy / 16) / 180;
  }
}
