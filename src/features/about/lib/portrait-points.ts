// An integer avalanche gives repeatable, independent offsets in both axes.
function random(seed: number) {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

/**
 * Give every printed mark a stable home without visible rows or close pairs.
 * One point starts anywhere inside each logical cell. A few local separation
 * passes loosen the grid while preventing random jitter from making clumps.
 * The logical cell still identifies the particle; the returned positions are
 * stage pixels, shared by the ink and its spring simulation.
 */
export function createPortraitPoints(
  columns: number,
  rows: number,
  pitchX: number,
  pitchY: number,
): Float32Array {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    !Number.isFinite(pitchX) ||
    !Number.isFinite(pitchY) ||
    pitchX <= 0 ||
    pitchY <= 0
  ) {
    throw new RangeError("Portrait points need positive dimensions and pitches");
  }

  const count = columns * rows;
  const points = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    points[index * 2] = (index % columns) + random(index * 2);
    points[index * 2 + 1] = Math.floor(index / columns) + random(index * 2 + 1);
  }

  const separation = 0.74;
  const reach = 0.75;
  // Each pair is visited once. Bounded travel means no point beyond these
  // neighbouring logical cells can enter the separation radius.
  const neighbourX = new Int8Array([1, 2, -2, -1, 0, 1, 2, -2, -1, 0, 1, 2]);
  const neighbourY = new Int8Array([0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);

  for (let pass = 0; pass < 4; pass += 1) {
    // Alternate the sweep so local relaxation has no consistent direction.
    for (let step = 0; step < count; step += 1) {
      const index = pass % 2 === 0 ? step : count - 1 - step;
      const x = index % columns;
      const y = Math.floor(index / columns);
      for (let neighbour = 0; neighbour < neighbourX.length; neighbour += 1) {
        const otherX = x + (neighbourX[neighbour] ?? 0);
        const otherY = y + (neighbourY[neighbour] ?? 0);
        if (otherX < 0 || otherX >= columns || otherY >= rows) continue;
        const other = otherY * columns + otherX;
        const pointX = points[index * 2] ?? 0;
        const pointY = points[index * 2 + 1] ?? 0;
        const otherPointX = points[other * 2] ?? 0;
        const otherPointY = points[other * 2 + 1] ?? 0;
        const dx = otherPointX - pointX;
        const dy = otherPointY - pointY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= separation * separation || distanceSquared < 1e-12) continue;
        const distance = Math.sqrt(distanceSquared);
        const shift = ((separation - distance) / distance) * 0.5;
        const shiftX = dx * shift;
        const shiftY = dy * shift;
        points[index * 2] = Math.max(
          Math.max(0, x + 0.5 - reach),
          Math.min(Math.min(columns, x + 0.5 + reach), pointX - shiftX),
        );
        points[index * 2 + 1] = Math.max(
          Math.max(0, y + 0.5 - reach),
          Math.min(Math.min(rows, y + 0.5 + reach), pointY - shiftY),
        );
        points[other * 2] = Math.max(
          Math.max(0, otherX + 0.5 - reach),
          Math.min(Math.min(columns, otherX + 0.5 + reach), otherPointX + shiftX),
        );
        points[other * 2 + 1] = Math.max(
          Math.max(0, otherY + 0.5 - reach),
          Math.min(Math.min(rows, otherY + 0.5 + reach), otherPointY + shiftY),
        );
      }
    }
  }

  for (let index = 0; index < count; index += 1) {
    points[index * 2] = (points[index * 2] ?? 0) * pitchX;
    points[index * 2 + 1] = (points[index * 2 + 1] ?? 0) * pitchY;
  }
  return points;
}
