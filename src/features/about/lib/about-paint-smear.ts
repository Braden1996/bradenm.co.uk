import { frontAboutStrokes, MEDIA_TO_STAGE_X, rearAboutBlocks } from "./about-blocks";
import type { BrushPoint } from "./about-brush-path";

const WIDTH = 1440;
const HEIGHT = 800;
const PICKUP_SPACING = 2;
const SMEAR_REACH = 45;
const MAX_MOVE = Math.hypot(WIDTH, HEIGHT) * 2;
const MAX_ALPHA = 0.18;
const CONTACT_ALPHA = 0.13;
// Match the framing and gap in typogravure-renderer / typogravure-shaders.
const FRAMING = [1.03, -0.008, 0] as const;
const GAP_RADIUS = 12;

type Pigment = readonly [number, number, number];
type SmearContact = { pigment: Pigment; alpha: number };
type SmearMark = { from: BrushPoint; to: BrushPoint; pigment: Pigment; load: number };
type PixelSurface = { width: number; height: number; data: Uint8ClampedArray };

/** A little material caught on a dry brush; only travelled distance spends it. */
export function createSmearTrail(
  sample: (point: BrushPoint) => SmearContact | undefined,
  deposit: (mark: SmearMark) => void,
) {
  let pigment: Pigment | undefined;
  let remaining = 0;

  function lift() {
    pigment = undefined;
    remaining = 0;
  }

  function move(from: BrushPoint, to: BrushPoint) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance > MAX_MOVE) {
      lift();
      return;
    }
    if (distance === 0) return;

    const count = Math.ceil(distance / PICKUP_SPACING);
    const step = distance / count;
    for (let index = 0; index < count; index += 1) {
      const start = index / count;
      const middle = (index + 0.5) / count;
      const contact = sample([from[0] + dx * middle, from[1] + dy * middle]);
      if (contact && contact.alpha >= CONTACT_ALPHA) {
        pigment = contact.pigment;
        remaining = SMEAR_REACH;
      }
      if (!pigment || remaining <= 0) continue;

      const travelled = Math.min(step, remaining);
      const end = start + travelled / distance;
      deposit({
        from: [from[0] + dx * start, from[1] + dy * start],
        to: [from[0] + dx * end, from[1] + dy * end],
        pigment,
        load: (remaining - travelled * 0.5) / SMEAR_REACH,
      });
      remaining -= travelled;
    }
  }

  return { move, lift };
}

function smoothstep(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function hash(x: number, y: number) {
  let value = Math.imul(x, 0x27d4_eb2d) ^ Math.imul(y, 0x1656_67b1);
  value = Math.imul(value ^ (value >>> 15), 0x85eb_ca6b);
  return ((value ^ (value >>> 13)) >>> 0) / 0xffff_ffff;
}

function makeCanvas(width: number, height: number, read = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: read });
  if (!context) throw new Error("Portrait paint needs a canvas context");
  return { canvas, context };
}

function readImage(image: HTMLImageElement): PixelSurface {
  const { canvas, context } = makeCanvas(image.naturalWidth, image.naturalHeight, true);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Bilinear samples agree with the original GPU texture, including its holes.
function channelAt(surface: PixelSurface, u: number, v: number, channel: number) {
  const x = Math.max(0, Math.min(surface.width - 1, u * surface.width - 0.5));
  const y = Math.max(0, Math.min(surface.height - 1, v * surface.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(surface.width - 1, x0 + 1);
  const y1 = Math.min(surface.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top =
    (surface.data[(y0 * surface.width + x0) * 4 + channel] ?? 0) * (1 - tx) +
    (surface.data[(y0 * surface.width + x1) * 4 + channel] ?? 0) * tx;
  const bottom =
    (surface.data[(y1 * surface.width + x0) * 4 + channel] ?? 0) * (1 - tx) +
    (surface.data[(y1 * surface.width + x1) * 4 + channel] ?? 0) * tx;
  return top * (1 - ty) + bottom * ty;
}

function ramp(value: number, stops: readonly (readonly [number, number])[]) {
  for (let index = 1; index < stops.length; index += 1) {
    const before = stops[index - 1];
    const after = stops[index];
    if (before && after && value <= after[0]) {
      const t = Math.max(0, (value - before[0]) / (after[0] - before[0]));
      return before[1] + (after[1] - before[1]) * t;
    }
  }
  return 0;
}

// These are the CSS masks on the media clip; the footer has its own unmasked clip.
const VERTICAL_MASK = [
  [0, 0],
  [0.015, 0.55],
  [0.04, 1],
  [0.82, 1],
  [0.87, 0.85],
  [0.91, 0.55],
  [0.945, 0.25],
  [0.97, 0.08],
  [1, 0],
] as const;
const HORIZONTAL_MASK = [
  [0, 0],
  [0.015, 0.55],
  [0.045, 1],
  [0.955, 1],
  [0.985, 0.55],
  [1, 0],
] as const;

/** Persistent, low-opacity dry smears, composited behind the moving dark ink. */
export function createPortraitPaintSmear(images: {
  green: HTMLImageElement;
  blue: HTMLImageElement;
  foot: HTMLImageElement;
  propSupport: HTMLImageElement;
}) {
  const { canvas, context } = makeCanvas(WIDTH, HEIGHT);
  const pixels = context.createImageData(WIDTH, HEIGHT);
  const grain = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) grain[y * WIDTH + x] = hash(x, y) * 255;
  }
  const palette = [
    { rect: frontAboutStrokes.foot.rect, surface: readImage(images.foot), rear: false },
    { rect: rearAboutBlocks.blue.rect, surface: readImage(images.blue), rear: true },
    { rect: rearAboutBlocks.green.rect, surface: readImage(images.green), rear: true },
  ];
  const support = readImage(images.propSupport);
  const matteCanvas = makeCanvas(1200, 800, true);
  let source: CanvasImageSource | undefined;
  let matte: PixelSurface | undefined;
  let matteDirty = false;
  let dirtyLeft = WIDTH;
  let dirtyTop = HEIGHT;
  let dirtyRight = 0;
  let dirtyBottom = 0;

  function ensureMatte() {
    if (!matteDirty || !source) return;
    // Only read the packed matte after a real paint-texture contact. Ordinary
    // dot motion and idle video scrubbing never copy these pixels to the CPU.
    matteCanvas.context.clearRect(0, 0, 1200, 800);
    matteCanvas.context.drawImage(source, -1200, 0, 2400, 800);
    matte = matteCanvas.context.getImageData(0, 0, 1200, 800);
    matteDirty = false;
  }

  function matteAt(x: number, y: number) {
    const u = Math.max(
      0.001,
      Math.min(0.999, ((x - MEDIA_TO_STAGE_X) / 1200 - 0.5) / FRAMING[0] + 0.5 + FRAMING[1]),
    );
    const v = Math.max(0.001, Math.min(0.999, (y / HEIGHT - 0.5) / FRAMING[0] + 0.5 + FRAMING[2]));
    return smoothstep(
      0.04,
      0.92,
      Math.max(matte ? channelAt(matte, u, v, 0) / 255 : 1, channelAt(support, u, v, 0) / 255),
    );
  }

  function visibilityAt(x: number, y: number) {
    ensureMatte();
    let mask = matteAt(x, y);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI) / 4;
      mask = Math.max(
        mask,
        matteAt(x + Math.cos(angle) * GAP_RADIUS, y + Math.sin(angle) * GAP_RADIUS),
      );
    }
    return (
      (1 - smoothstep(0.05, 0.55, mask)) *
      ramp(x / WIDTH, HORIZONTAL_MASK) *
      ramp(y / HEIGHT, VERTICAL_MASK)
    );
  }

  function sample([x, y]: BrushPoint): SmearContact | undefined {
    for (const { rect, surface, rear } of palette) {
      const u = (x - MEDIA_TO_STAGE_X - rect.left) / rect.width;
      const v = (y - rect.top) / rect.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      let alpha = channelAt(surface, u, v, 3) / 255;
      if (alpha < CONTACT_ALPHA) continue;
      if (rear) alpha *= visibilityAt(x, y);
      if (alpha < CONTACT_ALPHA) continue;
      return {
        pigment: [
          channelAt(surface, u, v, 0),
          channelAt(surface, u, v, 1),
          channelAt(surface, u, v, 2),
        ],
        alpha,
      };
    }
    return undefined;
  }

  function deposit({ from, to, pigment, load }: SmearMark) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const tx = dx / distance;
    const ty = dy / distance;
    const radius = 10 * (0.3 + 0.7 * load);
    const left = Math.max(0, Math.floor(Math.min(from[0], to[0]) - radius));
    const top = Math.max(0, Math.floor(Math.min(from[1], to[1]) - radius));
    const right = Math.min(WIDTH, Math.ceil(Math.max(from[0], to[0]) + radius));
    const bottom = Math.min(HEIGHT, Math.ceil(Math.max(from[1], to[1]) + radius));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const along = (x + 0.5 - from[0]) * tx + (y + 0.5 - from[1]) * ty;
        if (along < 0 || along > distance + 0.5) continue;
        const across = -(x + 0.5 - from[0]) * ty + (y + 0.5 - from[1]) * tx;
        if (Math.abs(across) > radius) continue;
        const paper = (grain[y * WIDTH + x] ?? 0) / 255;
        if (paper < 0.25 + (1 - load) * 0.48) continue;
        const bristle = hash(Math.floor(across / 2.4), Math.floor((x * tx + y * ty) / 18));
        if (bristle < 0.2) continue;
        const edge = 1 - (Math.abs(across) / radius) ** 3;
        const amount = Math.min(MAX_ALPHA, 0.17 * load ** 1.2 * edge * (0.7 + 0.3 * paper));
        const offset = (y * WIDTH + x) * 4;
        const oldAlpha = (pixels.data[offset + 3] ?? 0) / 255;
        // A rubbed patch can mix colour, but repeated scrubbing cannot make a
        // solid stripe. Paper and the original collage always show through.
        const alpha = Math.max(oldAlpha, amount);
        const mix = amount / Math.max(oldAlpha + amount, 0.001);
        for (let channel = 0; channel < 3; channel += 1) {
          const old = pixels.data[offset + channel] ?? 0;
          pixels.data[offset + channel] = old + ((pigment[channel] ?? 0) - old) * mix;
        }
        pixels.data[offset + 3] = Math.round(alpha * 255);
        dirtyLeft = Math.min(dirtyLeft, x);
        dirtyTop = Math.min(dirtyTop, y);
        dirtyRight = Math.max(dirtyRight, x + 1);
        dirtyBottom = Math.max(dirtyBottom, y + 1);
      }
    }
  }

  const trail = createSmearTrail(sample, deposit);
  return {
    canvas,
    updateSource(nextSource: CanvasImageSource) {
      source = nextSource;
      matteDirty = true;
    },
    move(from: BrushPoint, to: BrushPoint) {
      dirtyLeft = WIDTH;
      dirtyTop = HEIGHT;
      dirtyRight = 0;
      dirtyBottom = 0;
      trail.move(from, to);
      if (dirtyRight <= dirtyLeft || dirtyBottom <= dirtyTop) return false;
      context.putImageData(
        pixels,
        0,
        0,
        dirtyLeft,
        dirtyTop,
        dirtyRight - dirtyLeft,
        dirtyBottom - dirtyTop,
      );
      return true;
    },
    lift: trail.lift,
    reset() {
      trail.lift();
      pixels.data.fill(0);
      context.clearRect(0, 0, WIDTH, HEIGHT);
    },
  };
}
