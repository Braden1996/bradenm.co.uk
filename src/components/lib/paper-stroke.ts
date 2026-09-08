import {
  buildCoarseField,
  buildWobble,
  createRandom,
  type PaintedBitmap,
  sampleLookup,
  smoothstep,
  WORLEY_PERIOD,
} from "./paper-brush";
import { fbm2, periodicWorley2 } from "./paper-noise";
import { buildPigmentRamp, glaze, luminance } from "./paper-pigment";

/*
 * One hand-pulled gouache stroke per call — a unique, non-tiled bake. The
 * same Curtis/Bousseau recipe as the blocks (paper-paint), re-staged for a
 * single drag of a loaded brush: a wet, rounded, pooling head; a body that
 * breathes with the hand's pressure; a tail that thins, dries and sputters
 * as the brush lifts; and two or three pigments that were on different
 * bristles, so their front across the stroke is a ragged mix, never a line.
 *
 * As with the blocks, the bake carries ONLY pigment and coverage — no weave,
 * no relief — and every effect that darkens or lightens routes through one
 * scalar density and the glaze remap, so denser paint gains saturation
 * in-hue. The underlines and the portrait's foot wash are baked from this at
 * build; nothing here may reach for a platform API.
 */

export type PaintedStrokeSpec = {
  alpha: number;
  /** Bake box in texels; the stroke runs along `width`. */
  width: number;
  /**
   * Bake box height in texels — at least 1.4x `thickness`; 1.6x and up lets
   * the bow, wobble and head swell breathe at their full size instead of
   * being scaled down to fit.
   */
  height: number;
  /** Nominal core thickness, texels. */
  thickness: number;
  /** Base density: 1 = the blocks' gouache; thin strokes carry more (1.3). */
  load: number;
  /** Head to tail. */
  pigments: readonly [string, string] | readonly [string, string, string];
  /** Texels per paper px: divides tooth, erosion and sputter frequencies. */
  scale: number;
  seed: number;
  /** Head on the right — the brush was dragged leftward. */
  reverse?: boolean;
  /**
   * 0 (default) is a loaded gouache stroke with a crisp, pooled rim; toward 1
   * the edge feathers wider and the rim fades — a wetter, thinner wash whose
   * pigment has bled into the paper rather than sat on it.
   */
  softness?: number;
  /**
   * Where along the stroke (0 head … 1 tail) the front between the first and
   * last pigments sits; 0.5 (default) shares the length evenly. A three-pigment
   * stroke shifts its whole ramp by the same amount.
   */
  front?: number;
};

// Four harmonics: a pulled line holds 3-5 visible direction changes; more
// and the spine reads as a scribble, fewer and it reads as a ruled bow.
const WOBBLE_HARMONICS = 4;
// The pigment lookup's resolution. The mix fraction varies slowly along a
// wide wash, so a coarse ramp (64 steps) posterises the pigment front into
// visible contour bands; 256 steps cost nothing and leave none.
const RAMP_STEPS = 256;
// The wet head swells this much, and the hand's pressure swings this much,
// before the vertical budget (below) scales both down to fit the box.
const HEAD_SWELL = 0.22;
const PRESSURE_SWING = 0.18;
// Vertical excursions are fractions of the room above the core's half-
// thickness once the erosion's outward reach is taken off: bow + wobble
// (×1.42, the 1/k² series' peak) + tremor + swell + cap bulge = 0.84 of it,
// so the stroke can never clip flat against the bake edge (a straight cut is
// a machine tell).
const BOW_BUDGET = 0.18;
const WOBBLE_BUDGET = 0.18;
const SWELL_BUDGET = 0.2;
const TREMOR_BUDGET = 0.04;
const CAP_BUDGET = 0.16;
// The cap's outline bulges up to a tenth of its radius: enough to lump the
// round end, not enough to grow a second blob. Three octaves of value noise
// rarely stray more than ±0.15 from their mean, so the lump is stretched
// threefold (and clamped) to use the bulge it is budgeted.
const CAP_BULGE = 0.1;
const CAP_LUMP_CONTRAST = 3;
// Erosion depth in texels at full scale — a bite of 2.6 texels inward (1.2px
// at the underlines' 2.2x) survives the downsample as a feathered edge; the
// shallower 0.9 read as a soft straight band at 1x. Outward it reaches 0.8 of
// the depth: paint that failed to deposit, not fuzz added outward.
const EROSION_DEPTH = 1.4;
const EROSION_INWARD = 2.2;
const EROSION_OUTWARD = 0.8;
// A pixel this far outside the unruffled stroke is past every inward effect.
const SKIP_DISTANCE = 4;

type Bristles = {
  /** Density before anything pixel-local: load, pooling, pressure, depletion, drift. */
  base: Float32Array;
  /** How much the rim is boosted in the wet head, per column. */
  headBoost: Float32Array;
  /** Pigment mix fraction on the spine (v = 0), for the bare texels' colour. */
  mix: Float32Array;
  /** Rim unevenness along the stroke. */
  rimVariation: Float32Array;
  /** Tail factor s in 0..1: where the brush is lifting. */
  s: Float32Array;
  /** Position along the span, 0..1 (clamped past the caps). */
  t: Float32Array;
  /** Half-width at each column. */
  w: Float32Array;
  /** Spine height at each column. */
  yc: Float32Array;
};

const cache = new Map<string, PaintedBitmap>();

// Every field keys the cache; two specs that differ only in `reverse` or
// `load` would otherwise hand one another stale bakes.
const cacheKey = (spec: PaintedStrokeSpec) =>
  [
    spec.seed,
    spec.width,
    spec.height,
    spec.thickness,
    spec.load,
    spec.alpha,
    spec.scale,
    spec.reverse ? 1 : 0,
    spec.softness ?? 0,
    spec.front ?? 0.5,
    spec.pigments.join(","),
  ].join(":");

/** Bake one painted stroke; cached by spec so every route reuses the same paint. */
export function renderPaintedStroke(spec: PaintedStrokeSpec): PaintedBitmap {
  const key = cacheKey(spec);
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const width = Math.round(spec.width);
  const height = Math.round(spec.height);
  const thickness = spec.thickness;
  const seed = spec.seed;
  const scale = spec.scale;
  const random = createRandom(seed * 2_654_435_761);

  // Thin strokes are eroded proportionally less, or the tooth eats them.
  const erosionScale = Math.min(1, thickness / 12);
  const erosionReach = EROSION_DEPTH * EROSION_OUTWARD * erosionScale;

  // The spine runs from padX to width − padX; the caps, the head's swell, the
  // cap bulge and the erosion's outward reach all fit inside padX with a
  // texel to spare for the last column (0.5T + 0.2T + 0.07T + 1.12 + 1 ≤
  // 0.8T + 2), so neither end ever touches the bake's side.
  const padX = Math.round(0.8 * thickness + 2.5);
  const span = Math.max(1, width - 2 * padX);
  // The spine sits on the texel grid's centre line, (height − 1) / 2, so the
  // first and last rows are the same distance from it; the room above the
  // core's half-thickness is what the vertical budgets divide.
  const yCentre = (height - 1) / 2;
  const room = Math.max(0.5, (height - 1 - thickness) / 2 - erosionReach);

  // The spine: one gentle bow, the shared 1/k² wobble and a tremor floor,
  // each budgeted against the room (see the budget constants).
  const bow = Math.min(BOW_BUDGET * room, 0.006 * span) * (random() < 0.5 ? -1 : 1);
  const primary = Math.min(WOBBLE_BUDGET * room, 0.15 * thickness);
  const tremor = Math.min(TREMOR_BUDGET * room, 0.04 * thickness);
  const wobble = buildWobble(span, primary, WOBBLE_HARMONICS, tremor, random, seed + 101);

  // The hand's pressure: a 3-term 1/k sine series at 0.6-1.2 cycles over the
  // span — one to three undulations, never more (more reads as a zigzag).
  const pressureCycles = 0.6 + random() * 0.6;
  const pressurePhases = [random(), random(), random()].map((roll) => roll * Math.PI * 2);
  const pressure = (t: number) => {
    let value = 0;

    for (let k = 1; k <= 3; k += 1) {
      value +=
        (1 / k) * Math.sin(2 * Math.PI * k * pressureCycles * t + (pressurePhases[k - 1] ?? 0));
    }

    // Normalised so |u| ≤ 1 whatever the phases.
    return value / (1 + 1 / 2 + 1 / 3);
  };

  // The swell (head × pressure) is scaled to the smaller of the vertical
  // budget and the horizontal room, so a fat stroke in a tight box swells
  // less rather than clipping.
  const nominalSwell = (1 + HEAD_SWELL) * (1 + PRESSURE_SWING) - 1;
  const swellRoom = Math.min(SWELL_BUDGET * room, 0.2 * thickness);
  const swellScale = Math.min(1, swellRoom / (0.5 * thickness * nominalSwell));
  const headSwell = HEAD_SWELL * swellScale;
  const pressureSwing = PRESSURE_SWING * swellScale;
  // The cap bulge has its own slice of the room, on top of the swollen head.
  const capBulge = Math.min(CAP_BULGE * (0.5 * thickness + swellRoom), CAP_BUDGET * room);

  // Head and tail extents along the span. The head is short and round; the
  // tail's dry run is longer on a thin stroke (the brush empties sooner) and
  // never shorter than a quarter of the span — a shorter lift reads as a
  // fade, not a brush running out.
  const headLength = Math.min(1.5 * thickness, 0.2 * span) / span;
  const tailLength = Math.min(0.45, Math.max(0.26, (4 * thickness) / span));

  // One long edge trailed the brush: it pools a heavier rim and its opposite
  // sheds its rim instead — the same asymmetry the blocks carry.
  const topTrailing = random() < 0.5;
  const rimBiasAbove = topTrailing ? 1.25 : 0.8;
  const rimBiasBelow = topTrailing ? 0.8 : 1.25;

  // The pigment front slides along the stroke by moving the mix fraction
  // against t: a front at 0.35 means a third of the length in the first
  // pigment and the rest in the last.
  const frontShift = 0.5 - Math.min(1, Math.max(0, spec.front ?? 0.5));

  const columns = buildBristles(width, {
    bow,
    frontShift,
    headLength,
    headSwell,
    load: spec.load,
    padX,
    pressure,
    pressureSwing,
    seed,
    span,
    tailLength,
    thickness,
    wobble,
    yCentre,
  });

  // Low-frequency fields on a coarse lattice; per-pixel bilinear reads.
  const step = 4;
  const applyNoise = buildCoarseField(width, height, step, (x, y) =>
    fbm2((x * 0.03) / scale, (y * 0.03) / scale, 3, seed + 41),
  );
  const poolScale = 1.5 / Math.max(width, height);
  const pool = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * poolScale, y * poolScale, 3, seed + 53),
  );

  // The pigment lookup, head pigment to tail pigment, plus each entry's
  // luminance for the granulation gate (conspicuous in light colours only).
  const ramp = buildPigmentRamp(spec.pigments, RAMP_STEPS);
  const rampLuminance = ramp.map((rgb) => luminance(rgb));

  // Bristle rows across the thickness: a thin stroke carries a few, a fat
  // wash more, capped so the streaks never read as a fine grain.
  const rows = Math.min(16, Math.max(4, thickness / 6));
  // Bristle gaps — streaks thin enough to let paper through — belong to thin
  // strokes; on a wide wash the same gaps are pale corduroy, so the depth
  // falls off above 14 texels of thickness.
  const bristleGapDepth = 0.3 * Math.min(1, 14 / thickness);
  // The rim hugs the boundary: at 15% of the thickness it reads as pooled
  // pigment, not as a stroke outline — but never under 2.5 texels, or the
  // underlines' 2.2x downsample averages it away entirely.
  const rimWidth = Math.max(2.5, 0.15 * thickness);
  // Softness widens the feather (up to a third of the thickness, past which
  // the stroke has no body left) and sheds the rim (never all of it, or the
  // edge loses the faint darkening that says the paint dried on paper).
  const softness = Math.min(1, Math.max(0, spec.softness ?? 0));
  const edgeSoftness = Math.max(1, (0.08 + 0.27 * softness) * thickness);
  const rimStrength = 0.45 * (1 - 0.8 * softness);
  const dryWindow = Math.min(16, Math.max(1.5, 0.25 * thickness));
  // The drag tooth's row pitch across the stroke: a thin stroke splits into
  // two or three bristle tracks as it dries (one cell and there is nothing
  // to split into), a wide wash keeps 5 paper px cells.
  const toothRows = Math.min(5 * scale, Math.max(2, thickness / 3));

  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let x = 0; x < width; x += 1) {
    // Everything — geometry, tooth, streaks, sputter — is computed in stroke
    // space (sx along the drag, v across it following the bow) and mirrored
    // on write when the brush was dragged the other way.
    const sx = spec.reverse ? width - 1 - x : x;
    const t = columns.t[sx] ?? 0;
    const s = columns.s[sx] ?? 0;
    const w = columns.w[sx] ?? 0;
    const yc = columns.yc[sx] ?? 0;
    const densityBase = columns.base[sx] ?? 0;
    const headBoost = columns.headBoost[sx] ?? 1;
    const rimVariation = columns.rimVariation[sx] ?? 0.5;
    const columnMix = columns.mix[sx] ?? 0;
    const bareIndex = Math.round(columnMix * (RAMP_STEPS - 1));
    const [bareR, bareG, bareB] = ramp[bareIndex] ?? [0, 0, 0];
    const dx = sx - padX;

    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      // Bare texels carry the pigment that would have landed there under
      // their zero alpha: a lossy encoder interpolates colour across the
      // ragged edge, and black there rings as a dark fringe once composited.
      pixels[offset] = Math.round(bareR * 255);
      pixels[offset + 1] = Math.round(bareG * 255);
      pixels[offset + 2] = Math.round(bareB * 255);
      pixels[offset + 3] = 0;

      // Signed inward distance to the unruffled stroke: a round cap past
      // either end, the band between. A mathematically round cap reads as
      // border-radius, so the cap's radius is lumped by angle — measured
      // outward from the cap's centre so the angle never wraps on the spine,
      // and faded by its cosine so the lump meets the long edges seamlessly.
      const dy = y - yc;
      let rawDistance = w - Math.abs(dy);

      if (dx < 0 || dx > span) {
        const capX = dx < 0 ? -dx : dx - span;
        const capAngle = Math.atan2(dy, capX);
        const lump = Math.min(
          1,
          Math.max(
            -1,
            CAP_LUMP_CONTRAST * (fbm2(capAngle * 2.5 + seed, dx < 0 ? 0 : 5, 3, seed + 67) - 0.5),
          ),
        );
        rawDistance = w + capBulge * Math.cos(capAngle) * lump - Math.hypot(capX, dy);
      }

      if (rawDistance < -SKIP_DISTANCE) {
        continue;
      }

      // Micro erosion at tooth pitch, biased inward: paint that failed to
      // deposit, not fuzz added outward. Anisotropic (stretched along the
      // drag) and three octaves deep, so the bites read as bristle drag and
      // not as the even beads of a value-noise lattice.
      const erosion = 2 * fbm2((sx * 0.22) / scale, (y * 0.5) / scale, 3, seed + 61, 0.6) - 1;
      const sd =
        rawDistance +
        EROSION_DEPTH *
          erosionScale *
          (erosion < 0 ? EROSION_INWARD * erosion : EROSION_OUTWARD * erosion);
      const alphaEdge = smoothstep(0, edgeSoftness, sd);

      if (alphaEdge <= 0) {
        continue;
      }

      const v = dy / thickness;

      // Pigment density: every darkening and lightening effect lands here.
      let density = densityBase;

      // Bristle streaks: long along the stroke, a handful of rows across,
      // plus a finer band at twice the row count — the brush's hairs, not a
      // texture laid over the paint. The glaze's slope is at most 0.25, so
      // ±0.15 of density is the least that still reads as a streak on a
      // light pigment.
      const bristle = fbm2(sx / (1.6 * thickness), v * rows + 7.1, 3, seed + 31);
      density += 0.3 * (bristle - 0.5);
      density += 0.1 * (fbm2(sx / (0.6 * thickness), v * 2 * rows, 2, seed + 37) - 0.5);
      // The sparsest streaks also thin the coverage, once the wet head is
      // past: at thin sizes it is coverage, not tone, that reads as paint.
      const bristleGap =
        1 - bristleGapDepth * smoothstep(0, 2 * headLength, t) * smoothstep(0.42, 0.25, bristle);

      // Edge-darkening rim — uneven along the edge, heavier on the trailing
      // long edge and in the wet head, fading as the brush dries — with the
      // interior faintly lightened (that pigment went to the rim).
      const rim = Math.exp(-((sd / rimWidth) * (sd / rimWidth)));
      const rimBias = dy < 0 ? rimBiasAbove : rimBiasBelow;
      density += rimStrength * rimVariation * rimBias * headBoost * (1 - 0.6 * s) * rim;
      density -= 0.03 * (1 - rim);

      // Granulation: flocculated pigment settling into the tooth valleys of
      // patchy once-wet areas — conspicuous in light colours only.
      const tooth = fbm2((sx * 0.18) / scale, (y * 0.18) / scale, 3, seed + 71);
      const poolGate = smoothstep(0.35, 0.75, pool(sx, y));

      // Pigment mix: the front between pigments is noisy along the stroke
      // AND bristle-wise (two pigments on different bristles), never a line.
      // Across the thickness v spans only ±0.5, so the noise is sampled at
      // 3v and 5v to give each bristle row its own offset; ±0.15 along the
      // stroke is near half the ramp's transition, which makes the front
      // ragged rather than a soft fade.
      const mix = Math.min(
        1,
        Math.max(
          0,
          t +
            frontShift +
            0.3 * (fbm2(4 * t + seed, 3 * v, 2, seed + 57) - 0.5) +
            0.18 * (fbm2(sx / (1.2 * thickness), 5 * v, 2, seed + 59) - 0.5),
        ),
      );
      const rampIndex = Math.round(mix * (RAMP_STEPS - 1));
      const [red, green, blue] = ramp[rampIndex] ?? [0, 0, 0];
      const grain =
        1 - periodicWorley2((sx * 0.25) / scale, (y * 0.25) / scale, WORLEY_PERIOD, seed + 127);
      density +=
        0.07 *
        (1 + 2.5 * (rampLuminance[rampIndex] ?? 0)) *
        poolGate *
        (0.6 * (0.5 - tooth) * 2 + 0.4 * (grain - 0.5) * 2);

      // Dry brush: near the boundary, and increasingly toward the tail, only
      // tooth peaks keep paint — the brush ran out, it did not fade. At the
      // tip the reach falls to 0.2, below the tooth's usual relief, so the
      // tail breaks into tracks instead of tapering whole.
      const reach =
        1.15 - (0.45 + 0.25 * applyNoise(sx, y)) * Math.exp(-sd / dryWindow) - 0.95 * s ** 1.5;
      const dragTooth = 0.5 + 0.5 * fbm2((sx * 0.06) / scale, y / toothRows, 3, seed + 103);
      const toothRelief = (dragTooth - 0.5) * 1.5 + 0.5;
      let alphaDry = smoothstep(1 - reach - 0.1, 1 - reach + 0.1, toothRelief);

      // Worley sputter: the lifting brush's streaks hug the long edges once
      // the head is past and thicken toward the tail; none in the wet head,
      // where a loaded brush leaves solid paint. The hug decays within one
      // dry window — wider and the streaks snow across the body of a wash.
      const edgeHug = Math.exp(-Math.max(0, sd) / dryWindow);
      const sputterWeight =
        edgeHug * (0.2 * smoothstep(0, 1.5 * headLength, t) + 0.8 * smoothstep(0.55, 0.9, t));

      if (sputterWeight > 0.01) {
        const streak = smoothstep(
          0.72,
          0.85,
          1 - periodicWorley2((sx * 0.08) / scale, (y * 0.25) / scale, WORLEY_PERIOD, seed + 113),
        );
        alphaDry *= 1 - 0.55 * streak * sputterWeight;
      }

      const alpha = alphaEdge * alphaDry * bristleGap * spec.alpha;
      pixels[offset] = Math.round(glaze(red, density) * 255);
      pixels[offset + 1] = Math.round(glaze(green, density) * 255);
      pixels[offset + 2] = Math.round(glaze(blue, density) * 255);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  const bitmap: PaintedBitmap = { height, pixels, width };
  cache.set(key, bitmap);

  return bitmap;
}

type BristleInputs = {
  bow: number;
  /** How far the pigment front slides against t (0.5 − spec.front). */
  frontShift: number;
  headLength: number;
  headSwell: number;
  load: number;
  padX: number;
  pressure: (t: number) => number;
  pressureSwing: number;
  seed: number;
  span: number;
  tailLength: number;
  thickness: number;
  wobble: Float32Array;
  yCentre: number;
};

/**
 * Everything that varies only along the stroke, sampled once per column so
 * the per-pixel loop reads lookups: the spine, the half-width, the tail
 * factor, the column's share of density and pigment mix.
 */
function buildBristles(width: number, inputs: BristleInputs): Bristles {
  const make = () => new Float32Array(width);
  const bristles: Bristles = {
    base: make(),
    headBoost: make(),
    mix: make(),
    rimVariation: make(),
    s: make(),
    t: make(),
    w: make(),
    yc: make(),
  };
  const { headLength, seed, span, tailLength, thickness } = inputs;

  for (let x = 0; x < width; x += 1) {
    const t = Math.min(1, Math.max(0, (x - inputs.padX) / span));
    // The dry tail: s rises over the last tailLength of the span.
    const s = smoothstep(1 - tailLength, 1, t);
    const head = 1 - smoothstep(0, headLength, t);
    const u = inputs.pressure(t);

    bristles.t[x] = t;
    bristles.s[x] = s;
    bristles.yc[x] =
      inputs.yCentre + inputs.bow * Math.sin(Math.PI * t) + sampleLookup(inputs.wobble, t);
    // Pressure / half-width: wet rounded head, dry thinning tail (1 − 0.6 s³)
    // and the hand's undulation.
    bristles.w[x] =
      0.5 *
      thickness *
      (1 + inputs.headSwell * head) *
      (1 - 0.6 * s * s * s) *
      (1 + inputs.pressureSwing * u);
    // Density: the load, pooling in the head, more under pressure, depletion
    // toward the tail, and a slow drift in how much the brush held. The
    // glaze compresses density to at most a quarter of it in channel, so the
    // head pools a full 0.32 — less and a light pigment's head is as pale as
    // its body — and the drift and pressure swing ±0.15 / ±0.18 to be seen.
    bristles.base[x] =
      inputs.load +
      0.32 * (1 - smoothstep(0, 2 * headLength, t)) +
      0.18 * u -
      0.25 * s * s +
      0.3 * (fbm2(3 * t + seed, seed * 0.37, 2, seed + 43) - 0.5);
    // The wet head's rim is twice the body's: pigment pooled where the brush
    // first touched down.
    bristles.headBoost[x] = 1 + 1 * (1 - smoothstep(0, 1.5 * headLength, t));
    // The rim's unevenness wanders every couple of thicknesses along the
    // edge — slower and it reads as a gradient, faster as a stitch.
    bristles.rimVariation[x] = 0.5 + 0.5 * fbm2(x / (2 * thickness), seed * 9.1, 2, seed + 91);
    // The spine's share of the pigment front (the same along-stroke term the
    // per-pixel mix carries at v = 0), for the bare texels' colour.
    bristles.mix[x] = Math.min(
      1,
      Math.max(0, t + inputs.frontShift + 0.3 * (fbm2(4 * t + seed, 0, 2, seed + 57) - 0.5)),
    );
  }

  return bristles;
}
