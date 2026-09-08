// Register the generated frames at the torso, then reuse a single body.
// Coordinates are in the 300 x 360 working canvas, before the final resize.
function brightness(pixels, index) {
  const alpha = pixels[index + 3] / 255;
  return ((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3) * alpha + 255 * (1 - alpha);
}

function bodyShift(frame, reference, width, height, pose) {
  const left = pose === "seated" ? 65 : 150;
  const right = pose === "seated" ? 250 : 275;
  const top = pose === "seated" ? 215 : 280;
  const bottom = 326;
  let best = Infinity;
  let shiftX = 0;
  let shiftY = 0;
  for (let dy = -24; dy <= 24; dy += 2) {
    for (let dx = -24; dx <= 24; dx += 2) {
      let error = 0;
      for (let y = top; y < bottom; y += 5) {
        for (let x = left; x < right; x += 5) {
          const sourceX = x - dx;
          const sourceY = y - dy;
          const target = (y * width + x) * 4;
          const source = (sourceY * width + sourceX) * 4;
          if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
          const delta = brightness(reference, target) - brightness(frame, source);
          error += delta * delta;
        }
      }
      // Prefer the smallest correction when fur texture offers several fits.
      error += (dx * dx + dy * dy) * 8;
      if (error < best) {
        best = error;
        shiftX = dx;
        shiftY = dy;
      }
    }
  }
  return [shiftX, shiftY];
}

// The head owns the jaw and collar, while the bib belongs to the fixed torso.
// A small curved overlap lets a lowered chin cover that same chest naturally.
// The motion-data build also reads this mask so it cannot warp the fixed fur.
export function headWeight(x, y, pose, frame) {
  const seated = pose === "seated";
  const row = Math.floor(frame / 7);
  const column = frame % 7;
  const centre = (seated ? 150 : 129) + (column - 3) * (seated ? 18 : 14);
  const jaw =
    Math.max(0, row - 2) *
    Math.max(0, 1 - Math.abs(column - 3) / 2) *
    (seated ? 12 : 6) *
    Math.max(0, Math.min(1, (44 - Math.abs(x - centre)) / 20));

  // Preserve the exposed upper bib when looking up. Keep the lying mask
  // inside the torso until below the reference jaw, avoiding a second muzzle.
  const left = seated ? 100 : 100 - Math.max(0, Math.min(30, (y - 240) * 2));
  const right = seated ? 204 : 174;
  const chest =
    Math.max(0, Math.min(1, (x - left) / 20)) * Math.max(0, Math.min(1, (right - x) / 20));
  const cutoff = (seated ? [144, 156, 168, 176, 176][row] : 256) + jaw;
  const chestWeight = 1 - chest * (1 - Math.max(0, Math.min(1, (cutoff - y) / 16)));
  if (seated) {
    return Math.min(chestWeight, Math.max(0, Math.min(1, (176 + jaw - y) / 16)));
  }

  const vertical = Math.max(0, Math.min(1, (276 + jaw - y) / 16));
  const back = 220 - Math.max(0, y - 225) * 0.76;
  const horizontal = Math.max(0, Math.min(1, (back - x) / 20));
  return Math.min(chestWeight, vertical * horizontal);
}

function rowContours(pixels, width, height) {
  const rows = Array.from({ length: height }, (_, y) => {
    let left = width;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x);
      right = x;
    }
    return [left, right];
  });
  // Individual wisps of fur should not stretch a whole horizontal strip.
  return rows.map((_, y) => {
    const neighbours = rows
      .slice(Math.max(0, y - 2), Math.min(height, y + 3))
      .filter(([left, right]) => right > left);
    if (!neighbours.length) return null;
    return [0, 1].map(
      (edge) => neighbours.reduce((total, row) => total + row[edge], 0) / neighbours.length,
    );
  });
}

function collarTransform(source, reference, y, dx, pose, frame) {
  // Fit the back of the seated neck from just below the eye line; waiting
  // until the lower collar leaves a second shoulder bulge behind the ear.
  const progress = Math.max(0, Math.min(1, pose === "seated" ? (y - 115) / 69 : (y - 225) / 35));
  if (!source || !reference || !progress) return [1, -dx];
  const amount = progress * progress * (3 - 2 * progress);
  const sourceLeft = source[0] + dx;
  // The resting dog's back belongs to its fixed body. Only bring the left
  // neck contour in toward the shoulder, keeping the chest at x=170 pinned.
  const sourceRight = pose === "seated" ? source[1] + dx : 170;
  // The forward contour still belongs to the muzzle at that height. Keep
  // its projection until below the jaw, which sits lower as the head bows.
  // Fitting both sides from the eye line squeezes a lowered nose inward.
  const row = Math.floor(frame / 7);
  const column = frame % 7;
  const muzzleStart = [115, 115, 125, 140, 155][row];
  const muzzleProgress = Math.max(0, Math.min(1, (y - muzzleStart) / (184 - muzzleStart)));
  const muzzleAmount = muzzleProgress * muzzleProgress * (3 - 2 * muzzleProgress);
  const leftAmount = pose === "seated" && column <= 3 ? muzzleAmount : amount;
  const rightAmount = pose === "seated" && column >= 3 ? muzzleAmount : amount;
  const targetLeft = sourceLeft + (reference[0] - sourceLeft) * leftAmount;
  const targetRight =
    pose === "seated" ? sourceRight + (reference[1] - sourceRight) * rightAmount : 170;
  if (targetRight <= targetLeft || sourceRight <= sourceLeft) return [1, -dx];
  const scale = (sourceRight - sourceLeft) / (targetRight - targetLeft);
  return [scale, source[0] - targetLeft * scale];
}

export function rigDogFrames(frames, reference, width, height, pose) {
  const referenceContours = rowContours(reference, width, height);
  return frames.map((frame, index) => {
    const [dx, dy] = bodyShift(frame, reference, width, height, pose);
    const sourceContours = rowContours(frame, width, height);
    const result = Buffer.from(reference);
    for (let y = 0; y < height; y += 1) {
      const sourceY = y - dy;
      const [scale, offset] = collarTransform(
        sourceContours[sourceY],
        referenceContours[y],
        y,
        dx,
        pose,
        index,
      );
      for (let x = 0; x < width; x += 1) {
        const weight = headWeight(x, y, pose, index);
        if (!weight) continue;
        const target = (y * width + x) * 4;
        const sourceX = pose === "lying" && x >= 170 ? x - dx : x * scale + offset;
        const left = Math.floor(sourceX);
        const fraction = sourceX - left;
        const first = (sourceY * width + left) * 4;
        const second = first + 4;
        const insideY = sourceY >= 0 && sourceY < height;
        const firstAlpha =
          insideY && left >= 0 && left < width ? frame[first + 3] * (1 - fraction) : 0;
        const secondAlpha =
          insideY && left + 1 >= 0 && left + 1 < width ? frame[second + 3] * fraction : 0;
        const incomingAlpha = (firstAlpha + secondAlpha) * weight;
        const baseAlpha = reference[target + 3] * (1 - weight);
        const alpha = incomingAlpha + baseAlpha;
        for (let channel = 0; channel < 3; channel += 1) {
          const incoming =
            (firstAlpha ? frame[first + channel] * firstAlpha : 0) +
            (secondAlpha ? frame[second + channel] * secondAlpha : 0);
          result[target + channel] = alpha
            ? Math.round((incoming * weight + reference[target + channel] * baseAlpha) / alpha)
            : 0;
        }
        // Match the collar's geometry before feathering both colour and
        // alpha. Switching straight to the body's alpha cuts a horizontal
        // notch into wider necks; feathering unmatched contours leaves ghosts.
        result[target + 3] = Math.round(alpha);
      }
    }
    return result;
  });
}
