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
import {
  fromOklab,
  glaze,
  luminance,
  mixPigments,
  parseHex,
  type Rgb,
  toOklab,
} from "./paper-pigment";

/*
 * One hand-painted gouache rectangle per call — a unique, non-tiled bake.
 * The recipe follows the computer-watercolor literature (Curtis et al.'s
 * edge darkening and granulation, Bousseau's density-to-colour remap) and
 * measured hand-drawn-line spectra, tuned to the flat-bodied gouache end of
 * every range so the blocks stay quiet accents rather than wet washes.
 *
 * The bake carries ONLY pigment and coverage. No weave, no relief, no
 * lighting: wherever coverage thins the alpha opens and the page's own sheet
 * shows through, which is what makes the block read as painted ON the site's
 * ground instead of wearing a texture of its own. Every effect that darkens
 * or lightens routes through one scalar density field and a C - (C - C²)(d-1)
 * remap, so denser paint gains saturation in-hue — pigment, not shadow.
 *
 * Two looks share the one recipe. `flat` is the original quiet slab. `wet`
 * is the same block painted with a fuller brush: every existing field runs a
 * little louder, plus three the flat look carries at zero — a mid-frequency
 * tide of wetter and drier patches, an fbm bristle banding, and a drift of
 * the pigment itself toward a companion tint in places — so the blues are not
 * all one blue and the greens not all one green, the way a real wash dries.
 * The look is chosen once per bake; the per-pixel loop only reads numbers.
 *
 * Pure maths on purpose: the Astro build bakes the front block to a PNG and
 * the portrait's WebGL renderer bakes the rear blocks at boot from the same
 * code, so every surface agrees on what the paint looks like.
 */

export type PaintedBlockStyle = "flat" | "wet";

/** One pigment laid at one place on the bake, with its own drift companion. */
type PaintedPatch = {
  color: string;
  companion?: string;
  x: number;
  y: number;
};

/**
 * A patchwork: pigment set by POSITION rather than one colour for the whole
 * bake — a wall someone has painted in patches, instead of a slab of one
 * paint. Each patch's reach is a gaussian in `pitch`s, so the colours meet in
 * broad soft fronts the way two washes meet on the same sheet, and every
 * effect above them (the pooling, the bands, the rim) runs across the lot
 * unbroken. Nothing here is a gradient: the fronts wander, because the fields
 * that carry them wander.
 */
type PaintedPatchwork = {
  /**
   * How far one patch's pigment reaches, in pitches. Below ~0.25 the colours
   * meet in a hard front; much past ~0.5 every pigment is diluted by its
   * neighbours and the bake silts up to one average tint — a mesh gradient.
   */
  falloff: number;
  patches: readonly PaintedPatch[];
  /** The spacing the patches were laid on — the unit `falloff` counts in. */
  pitch: { height: number; width: number };
  /**
   * How far the fronts between patches wander, in bake px. A gaussian's own
   * contours are smooth ellipses, which is the mesh-gradient tell; displacing
   * the lookup by a slow noise before the weights are taken pushes the
   * meeting line about the way the edge of a real wash goes. Wants to be a
   * good fraction of the pitch — a front that wanders less than it is wide
   * still reads as geometry.
   */
  wander: number;
};

export type PaintedBlockSpec = {
  alpha: number;
  color: string;
  /**
   * A second pigment the `wet` look drifts toward in patches (hex). Ignored
   * by `flat`. Keep it a neighbour of `color` — a grey, or anything that
   * drops more than a fifth of the base's chroma, mixes to mud.
   */
  companion?: string;
  /**
   * Pigment by position. `color` and `companion` stay the bake's nominal
   * pair — the cache key and the fallback — but every pixel takes its
   * pigment from the patchwork instead.
   */
  patchwork?: PaintedPatchwork;
  rect: { height: number; width: number };
  seed: number;
  /** `flat` (the default) is the quiet slab; `wet` varies like a real wash. */
  style?: PaintedBlockStyle;
};

export type PaintedBlock = PaintedBitmap;

/**
 * The dials one look turns relative to the other. Every amplitude here is a
 * density term, so it lands in the same glaze remap as everything else; the
 * caps in the comments are where each one stops reading as paint.
 */
type Look = {
  /** Slow bloom field. Past 0.4 it merges with the wash pole into a vignette. */
  bloom: number;
  /** Along-stroke drift of pigment load. */
  drift: number;
  /** Per-pass load jitter. Louder passes need wider, wandering borders or they read as corduroy. */
  bandLoad: number;
  /** Band width clamps: `across / divisor`, no narrower than `min`, no wider than `max`. */
  bandMin: number;
  bandMax: number;
  bandDivisor: number;
  /** Wander of each pass border, in band widths — regular borders are the corduroy tell. */
  bandWander: number;
  /**
   * How fast the wander decorrelates across the stroke, cycles per px. At 0
   * every border sways in unison — parallel wavy lines, wood grain — so the
   * wet look sets it to a cycle per two or three bands. Much faster and the
   * swayed borders fold back on themselves, dropping islands of one pass
   * inside the next.
   */
  bandSway: number;
  /** Mid-frequency tide of wetter and drier patches. Zero in flat. */
  tide: number;
  /** Ceiling on the companion mix. Past 0.5 the two pigments read as mud, not drift. */
  companion: number;
  /** fbm bristle banding across the stroke. Past 0.08 the bands line up into corduroy. */
  bristle: number;
  /** Granulation amplitude and the pool-field window it is gated to. */
  granulation: number;
  poolGate: readonly [number, number];
  /** Edge-darkening rim. */
  rim: number;
};

const LOOKS = {
  flat: {
    bandDivisor: 3,
    bandLoad: 0.08,
    bandMax: 48,
    bandMin: 16,
    bandSway: 0,
    bandWander: 0.3,
    bloom: 0.22,
    bristle: 0,
    companion: 0,
    drift: 0.15,
    granulation: 0.03,
    poolGate: [0.35, 0.75],
    rim: 0.28,
    tide: 0,
  },
  wet: {
    bandDivisor: 4,
    bandLoad: 0.12,
    bandMax: 40,
    bandMin: 14,
    bandSway: 0.01,
    bandWander: 0.45,
    bloom: 0.34,
    bristle: 0.07,
    companion: 0.45,
    drift: 0.24,
    granulation: 0.045,
    poolGate: [0.3, 0.7],
    rim: 0.34,
    tide: 0.18,
  },
} satisfies Record<PaintedBlockStyle, Look>;

// The companion mix is a lookup, not a per-pixel OKLab round trip: 32 steps
// across a ≤45% mix is under 1.5% of mix per step, finer than the glaze
// remap resolves.
const COMPANION_STEPS = 32;

/**
 * See `fieldSpan` below: the long side of the about portrait's collage blocks,
 * which is the scale their bloom and drift are read at and the scale a
 * patchwork borrows so its paint carries the same mottle.
 */
const PATCHWORK_FIELD_SPAN = 700;

// The painted quad insets from the bake bounds by this much, and every
// geometric deviation below is budgeted against it, so wobble can never
// clip flat against the texture edge (a straight cut is a machine tell).
const EDGE_PAD = 6;
const WOBBLE_HARMONICS = 6;

type Edge = {
  /** Deflection from the straight rect side at each sample, in px (+ = inward). */
  offsets: Float32Array;
  /** Rim emphasis: trailing edges pool pigment, their opposites shed it. */
  rimBias: number;
  /** Extra dry-brush breakup along this edge (trailing edges only). */
  sputter: number;
};

/**
 * A hand-laid edge: one gentle bow over the shared 1/k² harmonic wobble and
 * sub-pixel tremor floor (paper-brush). Sampled to a lookup so the per-pixel
 * loop stays cheap.
 */
function buildEdge(length: number, random: () => number, seed: number): Edge {
  const budget = EDGE_PAD * 0.8;
  const bow = Math.min(0.002 * length, budget * 0.25) * (random() < 0.5 ? -1 : 1);
  const primary = Math.min(Math.max(0.005 * length, 0.8), budget * 0.3);
  const tremor = Math.min(0.0015 * length, 0.4);
  const offsets = buildWobble(length, primary, WOBBLE_HARMONICS, tremor, random, seed);

  for (let index = 0; index < offsets.length; index += 1) {
    const t = index / (offsets.length - 1);
    offsets[index] = (offsets[index] ?? 0) + bow * Math.sin(Math.PI * t);
  }

  return { offsets, rimBias: 1, sputter: 0 };
}

function edgeOffsetAt(edge: Edge, t: number) {
  return sampleLookup(edge.offsets, t);
}

type Corner = [number, number];

type Skeleton = {
  edges: [Edge, Edge, Edge, Edge]; // top, right, bottom, left
  corners: [Corner, Corner, Corner, Corner]; // TL, TR, BR, BL
};

/**
 * The painted quad: rotated a fraction of a degree off the axes, corners
 * displaced independently (slightly trapezoidal — no two edges parallel),
 * each edge wobbled with its own seed so opposite sides never correlate.
 */
function buildSkeleton(
  width: number,
  height: number,
  random: () => number,
  seed: number,
  cornerSlack: number,
): Skeleton {
  const theta =
    (0.12 + random() * 0.2) *
    (Math.PI / 180) *
    (random() < 0.5 ? -1 : 1) *
    (250 / Math.max(width, height, 250));
  const cx = width / 2;
  const cy = height / 2;
  const cornerRadius = Math.min(0.005 * Math.min(width, height), EDGE_PAD * 0.15) + cornerSlack;
  const displace = ([x, y]: Corner): Corner => {
    const rotatedX = cx + (x - cx) * Math.cos(theta) - (y - cy) * Math.sin(theta);
    const rotatedY = cy + (x - cx) * Math.sin(theta) + (y - cy) * Math.cos(theta);

    return [
      rotatedX + (random() * 2 - 1) * cornerRadius,
      rotatedY + (random() * 2 - 1) * cornerRadius,
    ];
  };

  return {
    corners: [
      displace([EDGE_PAD, EDGE_PAD]),
      displace([width - EDGE_PAD, EDGE_PAD]),
      displace([width - EDGE_PAD, height - EDGE_PAD]),
      displace([EDGE_PAD, height - EDGE_PAD]),
    ],
    edges: [
      buildEdge(width, random, seed + 101),
      buildEdge(height, random, seed + 211),
      buildEdge(width, random, seed + 307),
      buildEdge(height, random, seed + 401),
    ],
  };
}

/**
 * Signed inward distance to the wobbled quad. The quad stays within a degree
 * of axis-aligned, so each side reads as a displaced line along its axis and
 * the quad distance is the min of the four — cheap and exact enough.
 */
function skeletonDistance(skeleton: Skeleton, x: number, y: number) {
  const [tl, tr, br, bl] = skeleton.corners;
  const [top, right, bottom, left] = skeleton.edges;

  const tTop = (x - tl[0]) / Math.max(1, tr[0] - tl[0]);
  const topLine = tl[1] + (tr[1] - tl[1]) * tTop + edgeOffsetAt(top, tTop);
  const tBottom = (x - bl[0]) / Math.max(1, br[0] - bl[0]);
  const bottomLine = bl[1] + (br[1] - bl[1]) * tBottom - edgeOffsetAt(bottom, tBottom);
  const tLeft = (y - tl[1]) / Math.max(1, bl[1] - tl[1]);
  const leftLine = tl[0] + (bl[0] - tl[0]) * tLeft + edgeOffsetAt(left, tLeft);
  const tRight = (y - tr[1]) / Math.max(1, br[1] - tr[1]);
  const rightLine = tr[0] + (br[0] - tr[0]) * tRight - edgeOffsetAt(right, tRight);

  return Math.min(y - topLine, bottomLine - y, x - leftLine, rightLine - x);
}

/** Which edge is nearest, and how far along it — for rim bias and sputter. */
function nearestEdge(skeleton: Skeleton, x: number, y: number, width: number, height: number) {
  const [tl, tr, br, bl] = skeleton.corners;
  const distances = [y - tl[1], tr[0] - x, br[1] - y, x - bl[0]];
  let nearest = 0;

  for (let index = 1; index < 4; index += 1) {
    if ((distances[index] ?? 0) < (distances[nearest] ?? 0)) {
      nearest = index;
    }
  }

  const along = nearest === 0 || nearest === 2 ? x / width : y / height;

  return { along, index: nearest };
}

type Imperfection = {
  kind: "pool" | "sag" | "dry";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

const cache = new Map<string, PaintedBlock>();

// Every field of the spec keys the cache. Seed alone (the original key) let a
// resized or recoloured block hand back a stale bake of the old geometry, and
// the look and companion would otherwise hand a wet spec the flat bake.
const cacheKey = (spec: PaintedBlockSpec) =>
  `${spec.seed}:${spec.rect.width}x${spec.rect.height}:${spec.color}:${spec.alpha}:${
    spec.style ?? "flat"
  }:${spec.companion ?? ""}:${spec.patchwork ? JSON.stringify(spec.patchwork) : ""}`;

/**
 * The pigment pair every pixel is painted from, as three coarse lattices each
 * (paper-brush's fields, read with a bilinear blend). Sampling in OKLab keeps the fronts
 * between two patches off the neutral axis — the same rule as mixPigments —
 * while the per-pixel read stays a plain interpolation of two nearly equal
 * sRGB triples, which is all a lattice this dense ever spans.
 */
function buildPatchworkPigments(
  patchwork: PaintedPatchwork,
  width: number,
  height: number,
  step: number,
  seed: number,
) {
  const patches = patchwork.patches.map((patch) => ({
    base: toOklab(parseHex(patch.color)),
    companion: toOklab(parseHex(patch.companion ?? patch.color)),
    x: patch.x,
    y: patch.y,
  }));
  const spread = Math.max(0.05, patchwork.falloff);
  // Slow enough to carry a whole front, not to fray it: about one swing per
  // pitch, whose octaves then bow it again at a half and a quarter of that —
  // so the meeting line reads as a hand's edge at every distance rather than
  // dissolving into a stipple of two colours.
  const wanderScale = 0.95 / Math.max(1, (patchwork.pitch.width + patchwork.pitch.height) / 2);

  const blend = (atX: number, atY: number) => {
    const x =
      atX +
      patchwork.wander *
        (2 * fbm2(atX * wanderScale + seed * 1.7, atY * wanderScale, 3, seed + 191) - 1);
    const y =
      atY +
      patchwork.wander *
        (2 * fbm2(atX * wanderScale, atY * wanderScale + seed * 2.9, 3, seed + 197) - 1);
    let total = 0;
    let baseL = 0;
    let baseA = 0;
    let baseB = 0;
    let companionL = 0;
    let companionA = 0;
    let companionB = 0;

    for (const patch of patches) {
      const dx = (x - patch.x) / patchwork.pitch.width / spread;
      const dy = (y - patch.y) / patchwork.pitch.height / spread;
      const weight = Math.exp(-(dx * dx + dy * dy));

      total += weight;
      baseL += patch.base[0] * weight;
      baseA += patch.base[1] * weight;
      baseB += patch.base[2] * weight;
      companionL += patch.companion[0] * weight;
      companionA += patch.companion[1] * weight;
      companionB += patch.companion[2] * weight;
    }

    // Every gaussian has fallen away to nothing: no patch is near enough to
    // have an opinion, so take the nearest one whole rather than dividing by zero.
    if (total <= Number.MIN_VALUE) {
      const nearest = patches.reduce((best, patch) =>
        Math.hypot(x - patch.x, y - patch.y) < Math.hypot(x - best.x, y - best.y) ? patch : best,
      );

      return { base: fromOklab(nearest.base), companion: fromOklab(nearest.companion) };
    }

    return {
      base: fromOklab([baseL / total, baseA / total, baseB / total]),
      companion: fromOklab([companionL / total, companionA / total, companionB / total]),
    };
  };

  // One blend per lattice point, not one per channel: the six fields below
  // walk the same lattice, and the gaussians are the expensive part.
  const blended = new Map<string, { base: Rgb; companion: Rgb }>();
  const at = (x: number, y: number) => {
    const key = `${x},${y}`;
    let value = blended.get(key);

    if (!value) {
      value = blend(x, y);
      blended.set(key, value);
    }

    return value;
  };
  const channels = (which: "base" | "companion") => {
    const field = (index: 0 | 1 | 2) =>
      buildCoarseField(width, height, step, (x, y) => at(x, y)[which][index]);

    return { blue: field(2), green: field(1), red: field(0) };
  };

  return { base: channels("base"), companion: channels("companion") };
}

/** Bake one painted block; cached by spec so re-inits reuse the same paint. */
export function renderPaintedBlock(spec: PaintedBlockSpec): PaintedBlock {
  const key = cacheKey(spec);
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const width = Math.round(spec.rect.width);
  const height = Math.round(spec.rect.height);
  const seed = spec.seed;
  const random = createRandom(seed * 2_654_435_761);
  const vertical = height >= width;
  const look = LOOKS[spec.style ?? "flat"];
  const base = parseHex(spec.color);
  const [baseR, baseG, baseB] = base;
  const baseLuminance = luminance(base);

  // The pigment the glaze acts on, per pixel: base at entry 0, drifting
  // toward the companion along the lookup. A look without a companion (and
  // every flat bake) reads entry 0 only, which mixPigments hands back as the
  // untouched base tuple — so the flat bake is the same bytes it always was.
  const companion = spec.companion && look.companion > 0 ? parseHex(spec.companion) : null;
  const pigments: readonly Rgb[] = companion
    ? Array.from({ length: COMPANION_STEPS }, (_, index) =>
        mixPigments(base, companion, index / (COMPANION_STEPS - 1)),
      )
    : [base];
  const lastPigment = pigments.length - 1;

  // The primary quad and its faint restatement — the second pass of the
  // brush, offset a couple of px, whose overlap gently restates the edges.
  const skeleton = buildSkeleton(width, height, random, seed, 0);
  const restated = buildSkeleton(width, height, random, seed + 977, 2);

  // Trailing edges: one or two sides where the brush lifted — heavier rim,
  // heavier dry-brush breakup; the opposite side sheds its rim instead.
  const trailing = Math.floor(random() * 4);
  const secondTrailing = random() < 0.4 ? (trailing + 1) % 4 : -1;

  for (let index = 0; index < 4; index += 1) {
    const edge = skeleton.edges[index];

    if (!edge) {
      continue;
    }

    if (index === trailing || index === secondTrailing) {
      edge.rimBias = 1.3;
      edge.sputter = 1;
    } else if (index === (trailing + 2) % 4) {
      edge.rimBias = 0.7;
    }
  }

  // The wash pole: the one darker region every real flat wash dries around,
  // kept off both symmetry axes so it records history instead of vignetting.
  const poleAngle = random() * Math.PI * 2;
  const poleDistance = (0.25 + random() * 0.2) * Math.hypot(width, height) * 0.5;
  const poleX = width / 2 + Math.cos(poleAngle) * poleDistance;
  const poleY = height / 2 + Math.sin(poleAngle) * poleDistance;
  const diagonal = Math.hypot(width, height);

  // Two to four causal accidents, corner-biased, never mirrored.
  const imperfections: Imperfection[] = [];
  const featureCount = 2 + Math.floor(random() * 3);

  for (let index = 0; index < featureCount; index += 1) {
    const roll = random();
    const kind: Imperfection["kind"] = roll < 0.45 ? "pool" : roll < 0.7 ? "sag" : "dry";
    const scale = [1, 0.55, 0.3][Math.min(index, 2)] ?? 0.3;
    const size = (0.1 + random() * 0.1) * Math.min(width, height) * scale;
    const nearCorner = random() < 0.6;
    const x = nearCorner
      ? random() < 0.5
        ? EDGE_PAD + size
        : width - EDGE_PAD - size
      : EDGE_PAD + random() * (width - EDGE_PAD * 2);
    const y = nearCorner
      ? random() < 0.5
        ? EDGE_PAD + size
        : height - EDGE_PAD - size
      : EDGE_PAD + random() * (height - EDGE_PAD * 2);
    const tooClose = imperfections.some(
      (other) => Math.hypot(other.x - x, other.y - y) < 0.25 * diagonal,
    );

    if (tooClose) {
      continue;
    }

    imperfections.push({
      kind,
      radiusX: kind === "dry" ? size * (vertical ? 1 : 2.5) : size,
      radiusY: kind === "dry" ? size * (vertical ? 2.5 : 1) : size,
      x,
      y,
    });
  }

  // Low-frequency fields on a coarse lattice; per-pixel bilinear reads.
  const step = 4;
  const warpX = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * 0.025 + seed * 3.1, y * 0.025, 3, seed + 11),
  );
  const warpY = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * 0.025, y * 0.025 + seed * 7.7, 3, seed + 17),
  );
  /*
   * The span the slow fields are measured against. A slab is one object seen
   * whole, so its own long side is the honest answer: the bloom crosses it
   * about twice however big it is.
   *
   * A patchwork is not one object — it is a wall, metres long, seen a pitch at
   * a time — and stretching the fields with it flattens every view of it to a
   * ramp. Neither may they be scaled to the pitch: that runs them at twice the
   * rate the collage blocks do and the paint churns like cloud. So a patchwork
   * measures against a fixed painterly length, taken from the blocks in the
   * about portrait (430-854px on their long side): the bloom lands at about
   * one swing per 470px and the drift at one per 90px, which is the mottle
   * those blocks carry, whatever size the wall happens to be.
   */
  const fieldSpan = spec.patchwork ? PATCHWORK_FIELD_SPAN : Math.max(width, height);
  const bloomScale = 1.5 / fieldSpan;
  const bloom = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * bloomScale, y * bloomScale, 3, seed + 23),
  );
  const driftScale = 8 / fieldSpan;
  const drift = buildCoarseField(width, height, step, (x, y) => {
    const u = (vertical ? y : x) * driftScale;
    const v = (vertical ? x : y) * driftScale * 2.5;

    return fbm2(u, v, 4, seed + 31);
  });
  const applyNoise = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * 0.03, y * 0.03, 3, seed + 41),
  );
  const pool = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * bloomScale, y * bloomScale, 3, seed + 53),
  );
  // The wet look's own fields. Tide sits between bloom and tooth in scale:
  // hand-sized patches where the brush was wetter or drier. The companion
  // field is slower still, so the hue drifts in a few broad places rather
  // than mottling. Both are built for every look — coarse lattices are cheap
  // and a zero-amplitude term is a byte-exact no-op — so the loop below has
  // no per-look branch to take.
  const tide = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * 2.2 * bloomScale, y * 2.2 * bloomScale, 3, seed + 151),
  );
  const companionField = buildCoarseField(width, height, step, (x, y) =>
    fbm2(x * 0.6 * driftScale, y * 0.6 * driftScale, 3, seed + 163),
  );
  // Bristle banding runs at tooth pitch across the stroke, too fine for the
  // lattice, so it is the one wet term sampled per pixel — swapped for a
  // constant when the look carries none rather than charging every flat bake
  // three octaves it would multiply by zero.
  const bristle =
    look.bristle > 0
      ? (along: number, acrossAt: number) =>
          look.bristle * (fbm2(along / 14, acrossAt / 3.5, 3, seed + 173) - 0.5)
      : () => 0;

  // Where the pigment comes from. A slab reads the fixed base-to-companion
  // lookup above; a patchwork reads its own pigment pair off the lattices and
  // drifts between them in sRGB, which is honest for two colours as close as
  // a patch and its companion (the lookup mixes in OKLab because its pair may
  // not be). One scratch triple, filled in place: a bake this size would
  // otherwise allocate a tuple per texel.
  const patchwork = spec.patchwork
    ? buildPatchworkPigments(spec.patchwork, width, height, step, seed)
    : undefined;
  const scratch: [number, number, number] = [0, 0, 0];
  const pigmentAt = patchwork
    ? (x: number, y: number, mix: number): Rgb => {
        const red = patchwork.base.red(x, y);
        const green = patchwork.base.green(x, y);
        const blue = patchwork.base.blue(x, y);

        scratch[0] = red + (patchwork.companion.red(x, y) - red) * mix;
        scratch[1] = green + (patchwork.companion.green(x, y) - green) * mix;
        scratch[2] = blue + (patchwork.companion.blue(x, y) - blue) * mix;

        return scratch;
      }
    : (_x: number, _y: number, mix: number): Rgb => pigments[Math.round(mix * lastPigment)] ?? base;

  // Banded fill: a handful of parallel passes of the brush across the
  // stroke axis — few and wide, or the boundaries read as corduroy.
  const across = vertical ? width : height;
  const bandWidth = Math.min(look.bandMax, Math.max(look.bandMin, across / look.bandDivisor));
  const bandLoads = Array.from({ length: Math.ceil(across / bandWidth) + 2 }, () => random() - 0.5);
  // Only some pass boundaries left a visible wet-overlap seam.
  const bandSeams = bandLoads.map(() => random() < 0.45);

  const pixels = new Uint8ClampedArray(width * height * 4);
  const dryWindow = Math.min(8, Math.max(3, 0.05 * Math.min(width, height)));
  const rimWidth = Math.min(4, Math.max(1.5, 0.02 * Math.min(width, height)));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      // One warped frame for everything edge-relative, so rim, erosion and
      // sputter all cohere on the same wavy boundary.
      const wx = x + 2 * (warpX(x, y) - 0.5) * 1.2;
      const wy = y + 2 * (warpY(x, y) - 0.5) * 1.2;
      const rawDistance = skeletonDistance(skeleton, wx, wy);

      if (rawDistance < -4) {
        continue;
      }

      // Micro erosion at tooth pitch, biased inward: paint that failed to
      // deposit, not fuzz added outward.
      const erosion = 2 * fbm2(wx * 0.4, wy * 0.4, 2, seed + 61) - 1;
      const sd = rawDistance + 0.9 * (erosion < 0 ? 2.2 * erosion : 0.8 * erosion);
      const alphaEdge = smoothstep(0, 1.2, sd);

      if (alphaEdge <= 0) {
        continue;
      }

      const edgeInfo = nearestEdge(skeleton, x, y, width, height);
      const edge = skeleton.edges[edgeInfo.index];

      // Pigment density: every darkening and lightening effect lands here.
      let density = 1;
      density += 0.12 * smoothstep(1, 0, Math.hypot(x - poleX, y - poleY) / (0.9 * diagonal));
      density += look.bloom * (bloom(x, y) - 0.5);
      density += look.drift * (drift(x, y) - 0.5);
      density += look.tide * (tide(x, y) - 0.5);

      const tooth = fbm2(x * 0.18, y * 0.18, 3, seed + 71);
      density += 0.08 * (tooth - 0.5);

      // Brush passes: per-band load jitter with wandering borders, plus a
      // faint wet-overlap strip where neighbouring passes met.
      const alongAxis = vertical ? y : x;
      const acrossAxis = vertical ? x : y;
      const bandPosition =
        acrossAxis / bandWidth +
        look.bandWander *
          (2 * fbm2(alongAxis * 0.01, acrossAxis * look.bandSway + seed * 5.3, 2, seed + 83) - 1);
      const band = Math.max(0, Math.floor(bandPosition));
      density += (bandLoads[band % bandLoads.length] ?? 0) * look.bandLoad;
      const bandFraction = bandPosition - Math.floor(bandPosition);
      // Within a pass, the bristles themselves: an fbm ripple across the
      // stroke, long along it — never a sine, which would line up into ribs.
      density += bristle(alongAxis, acrossAxis);

      if (bandSeams[band % bandSeams.length]) {
        density += 0.03 * (1 - smoothstep(0, 0.2, Math.min(bandFraction, 1 - bandFraction)));
      }

      // The restated second pass: overlap darkens, the single-covered
      // sliver at the boundary reads lighter.
      const restatedCoverage = smoothstep(0, 2, skeletonDistance(restated, wx, wy));
      density += 0.12 * restatedCoverage - 0.06;

      // The bake's few deliberate accidents, accumulated first: a pool
      // deepens density, a sag amplifies the rim, and a dry patch extends
      // the dry-brush system's reach instead of fading alpha smoothly — the
      // brush ran out HERE, so the same tooth-skipping breakup appears, not
      // a translucent glow.
      let featureReach = 0;
      let featureDensity = 0;
      let featureRim = 0;

      for (const feature of imperfections) {
        const falloff =
          1 -
          smoothstep(
            0.4,
            1,
            Math.hypot((x - feature.x) / feature.radiusX, (y - feature.y) / feature.radiusY),
          );

        if (falloff <= 0) {
          continue;
        }

        if (feature.kind === "pool") {
          featureDensity += 0.2 * falloff;
        } else if (feature.kind === "sag") {
          featureRim += 0.5 * falloff;
        } else {
          featureReach += 0.55 * falloff;
          featureDensity -= 0.1 * falloff;
        }
      }

      // Edge-darkening rim — uneven along the edge, biased to the trailing
      // side, with the interior faintly lightened (that pigment went to the
      // rim). Routed through the density remap: darker AND more saturated.
      const rim = Math.exp(-((sd / rimWidth) * (sd / rimWidth)));
      const rimVariation = 0.5 + 0.5 * fbm2(edgeInfo.along * 1.5, seed * 9.1, 2, seed + 91);
      density += look.rim * (rimVariation + featureRim) * (edge?.rimBias ?? 1) * rim;
      density -= 0.028 * (1 - rim);

      // Dry-brush sputter: near the boundary (and inside dry patches) only
      // tooth peaks keep paint, so the page breathes through exactly where
      // a loaded brush lifts.
      const dragU = vertical ? y : x;
      const dragV = vertical ? x : y;
      const dragTooth = 0.5 + 0.5 * fbm2(dragU * 0.06, dragV * 0.2, 3, seed + 103);
      const reach =
        1.15 - (0.45 + 0.25 * applyNoise(x, y)) * Math.exp(-sd / dryWindow) - featureReach;
      const toothRelief = (dragTooth - 0.5) * 1.5 + 0.5;
      let alphaDry = smoothstep(1 - reach - 0.1, 1 - reach + 0.1, toothRelief);

      if (edge && edge.sputter > 0 && edgeInfo.along > 0.5) {
        const streak = smoothstep(
          0.72,
          0.85,
          1 - periodicWorley2(dragU * 0.08, dragV * 0.25, WORLEY_PERIOD, seed + 113),
        );
        // The streaks belong to the lifting brush: they hug the boundary
        // rather than snowing across the body of the block.
        const edgeHug = Math.exp(-Math.max(0, sd) / (dryWindow * 2));
        alphaDry *= 1 - 0.55 * streak * smoothstep(0.5, 0.8, edgeInfo.along) * edgeHug;
      }

      // Which pigment this pixel carries: the base, or — where the companion
      // field runs high — a step toward the companion. Gated so most of the
      // block stays the named colour and the drift reads as the brush
      // picking up a neighbour, not as a second colour laid over the first.
      const mix = look.companion * smoothstep(0.35, 0.8, companionField(x, y));
      const [pigmentR, pigmentG, pigmentB] = pigmentAt(x, y, mix);

      // Granulation: flocculated pigment settling into the tooth valleys of
      // patchy once-wet areas — conspicuous in light colours only. On a
      // patchwork "light" is asked of the pigment under THIS texel; a slab
      // has one answer for the whole bake.
      const poolGate = smoothstep(look.poolGate[0], look.poolGate[1], pool(x, y));
      const grain = 1 - periodicWorley2(x * 0.25, y * 0.25, WORLEY_PERIOD, seed + 127);
      density +=
        look.granulation *
        (1 + 2.5 * (patchwork ? luminance([pigmentR, pigmentG, pigmentB]) : baseLuminance)) *
        poolGate *
        (0.6 * (0.5 - tooth) * 2 + 0.4 * (grain - 0.5) * 2);

      density += featureDensity;

      // Bousseau glazing remap, clamped to the gouache band: dense paint
      // deepens like a second coat of itself, never toward grey.
      const alpha = alphaEdge * alphaDry * 0.99 * spec.alpha;
      pixels[offset] = Math.round(glaze(pigmentR, density) * 255);
      pixels[offset + 1] = Math.round(glaze(pigmentG, density) * 255);
      pixels[offset + 2] = Math.round(glaze(pigmentB, density) * 255);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  // Bare texels carry the base pigment under their zero alpha: a lossy
  // encoder interpolates colour across the ragged edge, and black there
  // rings as a dark fringe once the page composites the bake. On a patchwork
  // the pigment under a bare texel is whichever patch that corner belongs to.
  if (patchwork) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;

        if (pixels[offset + 3] === 0) {
          pixels[offset] = Math.round(patchwork.base.red(x, y) * 255);
          pixels[offset + 1] = Math.round(patchwork.base.green(x, y) * 255);
          pixels[offset + 2] = Math.round(patchwork.base.blue(x, y) * 255);
        }
      }
    }
  } else {
    const bareR = Math.round(baseR * 255);
    const bareG = Math.round(baseG * 255);
    const bareB = Math.round(baseB * 255);

    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) {
        pixels[offset] = bareR;
        pixels[offset + 1] = bareG;
        pixels[offset + 2] = bareB;
      }
    }
  }

  const block: PaintedBlock = { height, pixels, width };
  cache.set(key, block);

  return block;
}
