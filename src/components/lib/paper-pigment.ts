/*
 * Pigment arithmetic for the painters: hex parsing, the Bousseau glaze remap
 * every density effect routes through, and an OKLab mixer for the strokes
 * that carry two or three pigments along their length.
 *
 * Zero dependencies on purpose. The footer wash interpolates in Helmlab's
 * generation space, but Helmlab must never ship to the browser and the block
 * painter runs inside the portrait's WebGL boot — so the client-safe mixer
 * uses Ottosson's OKLab matrices and mirrors the one rule that matters from
 * paper-gradient: hue goes the short way round, never through grey.
 */

/** sRGB, 0..1 per channel. */
export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);

  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** Rec. 709 luma of gamma-encoded sRGB — the painters' "how light is this pigment" gate. */
export function luminance([red, green, blue]: Rgb) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// The glaze band: below 0.8 paint thins toward white (a wash, not gouache);
// above 1.8 the remap folds and mid-tones go darker than the pigment can.
const GLAZE_MIN = 0.8;
const GLAZE_MAX = 1.8;

/**
 * Bousseau's glazing remap, C − (C − C²)(d − 1): dense paint deepens like a
 * second coat of itself — darker AND more saturated in-hue — never toward
 * grey, which is what a plain multiply would do.
 */
export function glaze(channel: number, density: number) {
  const clamped = Math.min(GLAZE_MAX, Math.max(GLAZE_MIN, density));

  return channel - (channel - channel * channel) * (clamped - 1);
}

const toLinear = (channel: number) =>
  channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const toGamma = (channel: number) =>
  channel <= 0.003_130_8 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** OKLab: perceptual lightness plus the two opponent axes. */
export type Lab = readonly [number, number, number];

/** sRGB → OKLab (Ottosson 2020: linear → LMS → cube root → Lab). */
export function toOklab([red, green, blue]: Rgb): Lab {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);

  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
}

/** OKLab → sRGB, clamped to the gamut (a mix of two in-gamut pigments barely leaves it). */
export function fromOklab([lightness, a, b]: Lab): Rgb {
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const clamp = (channel: number) => Math.min(1, Math.max(0, toGamma(channel)));

  return [
    clamp(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    clamp(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    clamp(-0.004_196_086_3 * l - 0.703_418_614_8 * m + 1.707_614_701 * s),
  ];
}

/**
 * Hue takes the short way around the wheel, so a warm pigment reaching a cool
 * one sweeps through the hues between them at full chroma. Interpolating the
 * cartesian a/b axes instead would cut a straight line close to the neutral
 * axis and wash the midpoint out to grey — the same failure paper-gradient's
 * LCh ramp avoids.
 */
function interpolateHue(from: number, to: number, t: number) {
  return from + hueDelta(from, to) * t;
}

/** Signed short-way hue difference, −180..180 degrees. */
function hueDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

// Below this chroma a pigment has no hue worth steering toward: take the
// other pigment's hue so a near-grey mixes without spinning the wheel.
const NEUTRAL_CHROMA = 0.002;

// Two pigments far apart on the wheel (blue and peach, 135° apart) would
// sweep through every hue between them at full chroma — a luminous green
// band that reads as a conic gradient, not as paint. Real gouache muddies:
// the chroma dips toward the midpoint, by 45% at most, only once the hue gap
// passes 90° (neighbouring hues such as green and blue mix cleanly). The
// dip is a 4t(1 − t) hump so the ends stay the exact pigments.
const MUD_DIP = 0.45;
const MUD_GAP_START = 90;
const MUD_GAP_FULL = 150;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const clamped = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));

  return clamped * clamped * (3 - 2 * clamped);
};

/** Mix two sRGB pigments in OKLCh: L and C linearly, hue the short way round. */
export function mixPigments(from: Rgb, to: Rgb, t: number): Rgb {
  if (t <= 0) {
    return from;
  }

  if (t >= 1) {
    return to;
  }

  const [fromL, fromA, fromB] = toOklab(from);
  const [toL, toA, toB] = toOklab(to);
  const fromChroma = Math.hypot(fromA, fromB);
  const toChroma = Math.hypot(toA, toB);
  const fromHue = (Math.atan2(fromB, fromA) * 180) / Math.PI;
  const toHue = (Math.atan2(toB, toA) * 180) / Math.PI;
  const hue =
    fromChroma < NEUTRAL_CHROMA
      ? toHue
      : toChroma < NEUTRAL_CHROMA
        ? fromHue
        : interpolateHue(fromHue, toHue, t);
  const hueGap =
    fromChroma < NEUTRAL_CHROMA || toChroma < NEUTRAL_CHROMA
      ? 0
      : Math.abs(hueDelta(fromHue, toHue));
  const mud = MUD_DIP * smoothstep(MUD_GAP_START, MUD_GAP_FULL, hueGap) * 4 * t * (1 - t);
  const chroma = (fromChroma + (toChroma - fromChroma) * t) * (1 - mud);
  const radians = (hue * Math.PI) / 180;

  return fromOklab([
    fromL + (toL - fromL) * t,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
  ]);
}

/**
 * A lookup across two or three pigments, head to tail. Each end (and, with
 * three, the middle) holds a plateau of pure pigment; the transitions between
 * them are short and smooth. Without the plateaus the whole stroke is a gradient
 * bar — the exact machine look the painted underlines exist to avoid.
 */
export function buildPigmentRamp(pigments: readonly string[], steps: number): Rgb[] {
  const parsed = pigments.map(parseHex);
  const [first, second, third] = parsed;

  if (!first) {
    return Array.from({ length: steps }, (): Rgb => [0, 0, 0]);
  }

  return Array.from({ length: steps }, (_, index) => {
    const m = steps > 1 ? index / (steps - 1) : 0;

    if (third && second) {
      const head = mixPigments(first, second, smoothstep(0.2, 0.45, m));

      return mixPigments(head, third, smoothstep(0.55, 0.8, m));
    }

    if (second) {
      return mixPigments(first, second, smoothstep(0.3, 0.7, m));
    }

    return first;
  });
}
