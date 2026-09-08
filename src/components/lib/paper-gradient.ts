import { Helmlab } from "helmlab";
import { paperWashAccents, paperWashTints } from "./paper-accents";
import { encodeRgbaPng } from "./paper-png";
import { createPaperWashRenderer } from "./paper-wash";

type GradientStop = {
  hex: string;
  position: number;
};

const paperGradientResolution = 256;

/**
 * The gradient's anchor colours, top of the sheet to base. The first deliberately
 * matches the canvas ivory so the gradient has no visible starting edge — it
 * simply emerges out of the paper.
 */
const gradientStops: GradientStop[] = [
  { hex: paperWashTints.ivory, position: 0 },
  { hex: paperWashTints.shell, position: 0.17 },
  { hex: paperWashAccents.orange, position: 0.34 },
  { hex: paperWashTints.clay, position: 0.48 },
  { hex: paperWashTints.dust, position: 0.58 },
  // The blue bridge stays on the cyan side of the hue wheel. That keeps the
  // warm-to-cool handoff clear of magenta without neutralising the blue into
  // slate once the translucent wash is composited over the ivory paper.
  { hex: paperWashTints.slate, position: 0.68 },
  { hex: paperWashAccents.blue, position: 0.8 },
  { hex: paperWashTints.sky, position: 0.9 },
  { hex: paperWashAccents.green, position: 1 },
];

/**
 * Hue takes the short way around the wheel, so a warm anchor reaching a cool one
 * sweeps through the hues between them at full chroma. Interpolating the
 * cartesian a/b axes instead would cut a straight line close to the neutral axis
 * and wash the midpoint out to grey, which is the failure mode this avoids.
 */
function interpolateHue(from: number, to: number, t: number) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;

  return from + delta * t;
}

function parseHex(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff] as const;
}

/**
 * Interpolation happens in Helmlab's generation space rather than sRGB or
 * Oklab: it is tuned so equal numeric steps read as equal perceptual steps, and
 * it holds saturation better through a transition, which is what keeps this
 * gradient's warm-to-cool crossing from going muddy.
 */
function buildRampBytes() {
  const gen = new Helmlab().gen;
  const anchors = gradientStops.map((stop) => {
    const [lightness = 0, chroma = 0, hue = 0] = Array.from(gen.toLch(gen.fromHex(stop.hex)));

    return { chroma, hue, lightness, position: stop.position };
  });

  const bytes = new Uint8Array(paperGradientResolution * 3);
  const first = anchors[0];

  if (!first) {
    return bytes;
  }

  for (let index = 0; index < paperGradientResolution; index += 1) {
    const position = index / (paperGradientResolution - 1);
    let lower = first;
    let upper = first;

    for (const anchor of anchors) {
      if (anchor.position <= position) {
        lower = anchor;
      } else {
        upper = anchor;
        break;
      }
    }

    if (upper.position <= lower.position) {
      upper = lower;
    }

    const span = upper.position - lower.position;
    const t = span === 0 ? 0 : (position - lower.position) / span;
    const lightness = lower.lightness + (upper.lightness - lower.lightness) * t;
    const chroma = lower.chroma + (upper.chroma - lower.chroma) * t;
    const hue = interpolateHue(lower.hue, upper.hue, t);
    const [red, green, blue] = parseHex(
      gen.toHex(gen.gamutMap(gen.fromLch([lightness, chroma, hue]))),
    );
    const offset = index * 3;

    bytes[offset] = red;
    bytes[offset + 1] = green;
    bytes[offset + 2] = blue;
  }

  return bytes;
}

let cachedRamp: Uint8Array | undefined;

function getRamp() {
  cachedRamp ??= buildRampBytes();

  return cachedRamp;
}

/*
 * The baked frame's own resolution. The wash is a deliberately low-frequency
 * field that gets scaled up either way — the live canvas is capped at 340 across
 * — so this samples it well above anything it actually contains, and the cost
 * of going finer is paid in bytes for detail that is not there.
 */
const washImageWidth = 240;
const washImageHeight = 135;

function renderPaperWashPixels() {
  const renderer = createPaperWashRenderer(washImageWidth, washImageHeight, getRamp(), {
    dither: false,
  });
  const pixels = new Uint8ClampedArray(washImageWidth * washImageHeight * 4);

  renderer.render({ data: pixels }, { time: 0 });

  return pixels;
}

/**
 * The wash's opening frame, rendered through the same code the canvas runs and
 * baked into the markup so it is on screen with the first paint. Because the
 * renderer works entirely in normalized space, this one image is the field at
 * any viewport size, and the canvas taking over on top of it lands on the frame
 * already showing rather than cutting to a different one.
 *
 * Alpha is kept rather than folded into an opaque colour, so it composites over
 * the sheet exactly as the canvas does. `opacity` scales that alpha at bake
 * time: the wash is painted as a CSS background layer, which has no opacity
 * of its own, so the strength has to live in the pixels.
 */
export function createPaperWashImage({ opacity = 1 }: { opacity?: number } = {}) {
  const pixels = renderPaperWashPixels();

  if (opacity < 1) {
    for (let offset = 3; offset < pixels.length; offset += 4) {
      pixels[offset] = Math.round((pixels[offset] ?? 0) * opacity);
    }
  }

  return encodeRgbaPng(pixels, washImageWidth, washImageHeight);
}
