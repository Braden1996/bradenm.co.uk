const defaultPersistence = 0.5;
const lacunarity = 2;

function hash2(x: number, y: number, seed: number) {
  let hash = Math.imul(x, 0x27d4_eb2d) ^ Math.imul(y, 0x1656_67b1) ^ Math.imul(seed, 0x9e37_79b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85eb_ca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2_ae35);

  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffff_ffff;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function wrap(value: number, period: number) {
  return ((value % period) + period) % period;
}

function valueNoise2(x: number, y: number, seed: number) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = smoothstep(x - cellX);
  const fractionY = smoothstep(y - cellY);
  const topLeft = hash2(cellX, cellY, seed);
  const topRight = hash2(cellX + 1, cellY, seed);
  const bottomLeft = hash2(cellX, cellY + 1, seed);
  const bottomRight = hash2(cellX + 1, cellY + 1, seed);
  const top = topLeft + (topRight - topLeft) * fractionX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fractionX;

  return top + (bottom - top) * fractionY;
}

export function fbm2(x: number, y: number, octaves: number, seed: number, persistence?: number) {
  const falloff = persistence ?? defaultPersistence;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(x * frequency, y * frequency, seed + octave) * amplitude;
    weight += amplitude;
    amplitude *= falloff;
    frequency *= lacunarity;
  }

  return total / weight;
}

/**
 * Value noise whose lattice wraps every `periodX` by `periodY` cells, so a tile
 * sampled over exactly one period butts against itself without a seam. The two
 * axes are independent so a weave can be stretched along one of them.
 */
function periodicValueNoise2(x: number, y: number, periodX: number, periodY: number, seed: number) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = smoothstep(x - cellX);
  const fractionY = smoothstep(y - cellY);
  const leftX = wrap(cellX, periodX);
  const rightX = wrap(cellX + 1, periodX);
  const topY = wrap(cellY, periodY);
  const bottomY = wrap(cellY + 1, periodY);
  const topLeft = hash2(leftX, topY, seed);
  const topRight = hash2(rightX, topY, seed);
  const bottomLeft = hash2(leftX, bottomY, seed);
  const bottomRight = hash2(rightX, bottomY, seed);
  const top = topLeft + (topRight - topLeft) * fractionX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fractionX;

  return top + (bottom - top) * fractionY;
}

export function periodicFbm2(
  x: number,
  y: number,
  octaves: number,
  periodX: number,
  periodY: number,
  seed: number,
  persistence?: number,
) {
  const falloff = persistence ?? defaultPersistence;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      periodicValueNoise2(
        x * frequency,
        y * frequency,
        periodX * frequency,
        periodY * frequency,
        seed + octave,
      ) * amplitude;
    weight += amplitude;
    amplitude *= falloff;
    frequency *= lacunarity;
  }

  return total / weight;
}

/**
 * Distance to the nearest feature point on a wrapping lattice. Cold-pressed
 * paper reads as irregular cells rather than uniform grain, which is what this
 * supplies to the height field.
 */
export function periodicWorley2(x: number, y: number, period: number, seed: number) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  let nearest = Number.POSITIVE_INFINITY;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighbourX = cellX + offsetX;
      const neighbourY = cellY + offsetY;
      const wrappedX = wrap(neighbourX, period);
      const wrappedY = wrap(neighbourY, period);
      const featureX = neighbourX + hash2(wrappedX, wrappedY, seed);
      const featureY = neighbourY + hash2(wrappedX, wrappedY, seed + 977);
      const deltaX = featureX - x;
      const deltaY = featureY - y;
      const distance = deltaX * deltaX + deltaY * deltaY;

      if (distance < nearest) {
        nearest = distance;
      }
    }
  }

  return Math.min(Math.sqrt(nearest), 1);
}
