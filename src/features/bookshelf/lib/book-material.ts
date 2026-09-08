type Point = {
  x: number;
  y: number;
};

type RandomSource = () => number;

type WearMark = {
  alpha: number;
  radiusX: number;
  radiusY: number;
  tone: "dark" | "light";
  x: number;
  y: number;
};

type FibreMark = {
  alpha: number;
  radiusX: number;
  radiusY: number;
  tone: "dark" | "light";
  x: number;
  y: number;
};

export type BookMaterialProfile = {
  caseClip: string;
  caseDepth: number;
  cornerRadius: string;
  coverClip: string;
  fibrePattern: string;
  linenOpacity: number;
  linenX: number;
  linenY: number;
  paintClass: string;
  pageDepth: number;
  spineClip: string;
  spineWidth: number;
  warpPitch: number;
  wearOpacity: number;
  wearPattern: string;
  weftPitch: number;
};

const UINT32_RANGE = 4_294_967_296;

function hashText(value: string) {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function createRandom(seed: number): RandomSource {
  let state = seed || 0x9e37_79b9;

  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

function canonicalText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function randomFor(key: string, channel: string) {
  return createRandom(hashText(`${key}\u0001${channel}`));
}

function between(random: RandomSource, minimum: number, maximum: number) {
  return minimum + (maximum - minimum) * random();
}

function rounded(value: number, precision = 2) {
  return Number(value.toFixed(precision));
}

function pointText(point: Point) {
  return `${rounded(point.x)}% ${rounded(point.y)}%`;
}

function polygon(points: Point[]) {
  return `polygon(${points.map(pointText).join(", ")})`;
}

function makeCaseClip(random: RandomSource) {
  const top = [0.58, 13, 31, 52, 73, 90, 99.28].map((x, index) => ({
    x,
    y: between(random, index === 0 ? 0.24 : 0.1, index === 6 ? 0.42 : 0.52),
  }));
  const right = [0.62, 16, 36, 59, 81, 99.15].map((y) => ({
    x: between(random, 99.48, 99.9),
    y,
  }));
  const bottom = [99.05, 84, 65, 44, 24, 8, 0.48].map((x) => ({
    x,
    y: between(random, 99.48, 99.9),
  }));
  const left = [99.18, 83, 63, 41, 20, 0.58].map((y) => ({
    x: between(random, 0.04, 0.62),
    y,
  }));

  return polygon([...top, ...right, ...bottom, ...left]);
}

function makeCornerRadius(random: RandomSource) {
  const horizontal = [
    between(random, 1.5, 2.8),
    between(random, 0.35, 1.15),
    between(random, 0.45, 1.35),
    between(random, 1.2, 2.5),
  ];
  const vertical = [
    between(random, 2.2, 3.8),
    between(random, 0.45, 1.4),
    between(random, 0.75, 1.9),
    between(random, 1.9, 3.5),
  ];
  const values = (radii: number[]) => radii.map((radius) => `${rounded(radius)}px`).join(" ");

  return `${values(horizontal)} / ${values(vertical)}`;
}

function addTopChip(points: Point[], random: RandomSource) {
  const slots = [
    [18, 24],
    [36, 43],
    [55, 63],
    [75, 82],
  ] as const;
  const slot = slots[Math.floor(random() * slots.length)] ?? slots[0];
  const centre = between(random, slot[0], slot[1]);
  const halfWidth = between(random, 0.45, 1.15);
  const edge = between(random, 0.14, 0.48);

  points.push(
    { x: centre - halfWidth, y: edge },
    { x: centre - halfWidth * 0.22, y: edge + between(random, 0.24, 0.62) },
    { x: centre + halfWidth * 0.18, y: edge + between(random, 0.4, 0.86) },
    { x: centre + halfWidth, y: edge },
  );
}

function addRightChip(points: Point[], random: RandomSource) {
  const slots = [
    [23, 33],
    [46, 55],
    [68, 76],
  ] as const;
  const slot = slots[Math.floor(random() * slots.length)] ?? slots[0];
  const centre = between(random, slot[0], slot[1]);
  const halfHeight = between(random, 0.36, 0.9);
  const edge = between(random, 99.52, 99.86);

  points.push(
    { x: edge, y: centre - halfHeight },
    { x: edge - between(random, 0.3, 0.72), y: centre - halfHeight * 0.2 },
    { x: edge - between(random, 0.45, 0.96), y: centre + halfHeight * 0.2 },
    { x: edge, y: centre + halfHeight },
  );
}

function addBottomChip(points: Point[], random: RandomSource, minimumX: number, maximumX: number) {
  const centre = between(random, minimumX, maximumX);
  const halfWidth = between(random, 0.45, 1.25);
  const edge = between(random, 99.5, 99.86);

  points.push(
    { x: centre + halfWidth, y: edge },
    { x: centre + halfWidth * 0.24, y: edge - between(random, 0.26, 0.64) },
    { x: centre - halfWidth * 0.2, y: edge - between(random, 0.38, 0.82) },
    { x: centre - halfWidth, y: edge },
  );
}

function makeCoverClip(random: RandomSource) {
  const top: Point[] = [
    { x: 0.58, y: between(random, 0.22, 0.48) },
    ...[12, 30, 50, 69, 88].map((x) => ({ x, y: between(random, 0.12, 0.55) })),
    { x: 99.18, y: between(random, 0.18, 0.46) },
  ];
  const right: Point[] = [
    { x: between(random, 99.5, 99.86), y: 0.64 },
    ...[18, 39, 61, 82].map((y) => ({ x: between(random, 99.45, 99.88), y })),
    { x: between(random, 99.46, 99.82), y: 99.12 },
  ];
  const bottom: Point[] = [
    { x: 99.08, y: between(random, 99.5, 99.84) },
    ...[84, 65, 45, 25, 8].map((x) => ({ x, y: between(random, 99.46, 99.88) })),
    { x: 0.48, y: between(random, 99.48, 99.82) },
  ];
  const left: Point[] = [
    { x: between(random, 0.06, 0.62), y: 99.12 },
    ...[82, 62, 41, 20].map((y) => ({ x: between(random, 0.04, 0.72), y })),
    { x: between(random, 0.08, 0.64), y: 0.62 },
  ];

  if (random() > 0.28) {
    addTopChip(top, random);
  }

  addRightChip(right, random);
  if (random() > 0.5) {
    addBottomChip(bottom, random, 13, 20);
  } else {
    addBottomChip(bottom, random, 31, 39);
  }

  if (random() > 0.42) {
    addBottomChip(bottom, random, 70, 78);
  }

  top.sort((leftPoint, rightPoint) => leftPoint.x - rightPoint.x);
  right.sort((leftPoint, rightPoint) => leftPoint.y - rightPoint.y);
  bottom.sort((leftPoint, rightPoint) => rightPoint.x - leftPoint.x);

  return polygon([...top, ...right, ...bottom, ...left]);
}

function makeSpineClip(random: RandomSource) {
  const points: Point[] = [
    { x: between(random, 1, 13), y: 0.42 },
    { x: between(random, 90, 99), y: 0.12 },
    ...[14, 31, 50, 69, 86].map((y) => ({ x: between(random, 82, 100), y })),
    { x: between(random, 87, 98), y: 99.55 },
    { x: between(random, 0, 11), y: 99.18 },
    ...[84, 66, 47, 28, 12].map((y) => ({ x: between(random, 0, 18), y })),
  ];

  return polygon(points);
}

function wearGradient(mark: WearMark) {
  const color =
    mark.tone === "light"
      ? `oklch(98% 0.012 84 / ${rounded(mark.alpha, 3)})`
      : `oklch(24% 0.012 72 / ${rounded(mark.alpha, 3)})`;

  return `radial-gradient(ellipse ${rounded(mark.radiusX)}px ${rounded(mark.radiusY)}px at ${rounded(mark.x)}% ${rounded(mark.y)}%, ${color} 0 34%, transparent 78%)`;
}

function makeWearPattern(random: RandomSource) {
  const marks: WearMark[] = [
    {
      alpha: between(random, 0.16, 0.3),
      radiusX: between(random, 0.9, 1.8),
      radiusY: between(random, 0.25, 0.55),
      tone: "light",
      x: between(random, 12, 88),
      y: between(random, 0.4, 1.25),
    },
    {
      alpha: between(random, 0.12, 0.22),
      radiusX: between(random, 0.35, 0.65),
      radiusY: between(random, 0.9, 1.65),
      tone: "dark",
      x: between(random, 98.5, 99.5),
      y: between(random, 12, 88),
    },
    {
      alpha: between(random, 0.18, 0.32),
      radiusX: between(random, 0.8, 1.7),
      radiusY: between(random, 0.25, 0.5),
      tone: "light",
      x: between(random, 12, 52),
      y: between(random, 98.65, 99.45),
    },
    {
      alpha: between(random, 0.12, 0.23),
      radiusX: between(random, 0.7, 1.5),
      radiusY: between(random, 0.28, 0.62),
      tone: random() > 0.4 ? "light" : "dark",
      x: between(random, 57, 92),
      y: between(random, 98.5, 99.45),
    },
    {
      alpha: between(random, 0.08, 0.16),
      radiusX: between(random, 0.25, 0.55),
      radiusY: between(random, 0.8, 1.5),
      tone: random() > 0.52 ? "light" : "dark",
      x: between(random, 0.5, 1.4),
      y: between(random, 9, 91),
    },
  ];

  if (random() > 0.48) {
    marks.push({
      alpha: between(random, 0.08, 0.16),
      radiusX: between(random, 0.45, 1),
      radiusY: between(random, 0.25, 0.55),
      tone: random() > 0.5 ? "light" : "dark",
      x: random() > 0.5 ? between(random, 1, 8) : between(random, 92, 99),
      y: random() > 0.5 ? between(random, 0.4, 1.3) : between(random, 98.6, 99.5),
    });
  }

  return marks.map(wearGradient).join(", ");
}

function fibreGradient(mark: FibreMark) {
  const color =
    mark.tone === "light"
      ? `oklch(100% 0 0 / ${rounded(mark.alpha, 3)})`
      : `oklch(18% 0.01 72 / ${rounded(mark.alpha, 3)})`;

  return `radial-gradient(ellipse ${rounded(mark.radiusX)}px ${rounded(mark.radiusY)}px at ${rounded(mark.x)}% ${rounded(mark.y)}%, ${color} 0 22%, transparent 76%)`;
}

function makeFibrePattern(random: RandomSource) {
  const count = 7 + Math.floor(random() * 5);
  const marks: FibreMark[] = [];

  for (let index = 0; index < count; index += 1) {
    marks.push({
      alpha: between(random, 0.045, 0.095),
      radiusX: between(random, 0.2, 0.38),
      radiusY: between(random, 1.05, 3.15),
      tone: index % 3 === 0 ? "light" : "dark",
      x: between(random, 3, 97),
      y: between(random, 3, 97),
    });
  }

  return marks.map(fibreGradient).join(", ");
}

// The subtle surface marks share sixteen repeatable prints. Individual book
// geometry stays inline; these longer paint declarations are emitted once
// per shelf instead of repeated for every jacket.
const paintVariants = Array.from({ length: 16 }, (_, index) => ({
  className: `book--paint-${index}`,
  fibrePattern: makeFibrePattern(randomFor(`book-paint-${index}`, "cloth-slubs")),
  wearPattern: makeWearPattern(randomFor(`book-paint-${index}`, "edge-wear")),
}));

export const bookPaintStyles = paintVariants
  .map(
    (paint) =>
      `.shelf-run > .book.${paint.className}{--book-fibre-pattern:${paint.fibrePattern};--book-wear-pattern:${paint.wearPattern}}`,
  )
  .join("");

/**
 * Gives each title one restrained, repeatable binding. The key deliberately
 * excludes shelf order and cover assets, so changing a sort or re-exporting an
 * image never makes a familiar book acquire a different physical case.
 */
export function buildBookMaterialProfile(title: string, author: string): BookMaterialProfile {
  const key = `${canonicalText(title)}\u0000${canonicalText(author)}`;
  const depthRandom = randomFor(key, "depth");
  const textileRandom = randomFor(key, "textile");
  const paint = paintVariants[hashText(key) % paintVariants.length];

  if (!paint) {
    throw new Error("Missing book paint variant");
  }

  return {
    caseClip: makeCaseClip(randomFor(key, "case-perimeter")),
    caseDepth: between(depthRandom, 1.65, 2.45),
    cornerRadius: makeCornerRadius(randomFor(key, "case-corners")),
    coverClip: makeCoverClip(randomFor(key, "cloth-perimeter")),
    fibrePattern: paint.fibrePattern,
    linenOpacity: between(textileRandom, 0.36, 0.47),
    linenX: between(textileRandom, -7, 7),
    linenY: between(textileRandom, -7, 7),
    paintClass: paint.className,
    pageDepth: between(depthRandom, 0.72, 1.18),
    spineClip: makeSpineClip(randomFor(key, "spine-contour")),
    spineWidth: between(randomFor(key, "spine-width"), 5.35, 6.45),
    warpPitch: between(textileRandom, 3.2, 4.15),
    wearOpacity: between(randomFor(key, "wear-strength"), 0.64, 0.9),
    wearPattern: paint.wearPattern,
    weftPitch: between(textileRandom, 4.4, 5.8),
  };
}

function pixels(value: number) {
  return `${rounded(value)}px`;
}

function percent(value: number) {
  return `${rounded(value)}%`;
}

/** Serialises the profile once in SSR; there is no client-side RNG or geometry correction. */
export function bookMaterialCss(profile: BookMaterialProfile, coverHue: number) {
  return [
    `--cover-hue:${Math.round(coverHue)}`,
    `--book-case-clip:${profile.caseClip}`,
    `--book-cover-clip:${profile.coverClip}`,
    `--book-spine-clip:${profile.spineClip}`,
    `--book-case-depth:${pixels(profile.caseDepth)}`,
    `--book-corner-radius:${profile.cornerRadius}`,
    `--book-page-depth:${pixels(profile.pageDepth)}`,
    `--book-spine-width:${percent(profile.spineWidth)}`,
    `--book-warp-pitch:${pixels(profile.warpPitch)}`,
    `--book-weft-pitch:${pixels(profile.weftPitch)}`,
    `--book-linen-x:${pixels(profile.linenX)}`,
    `--book-linen-y:${pixels(profile.linenY)}`,
    `--book-linen-opacity:${rounded(profile.linenOpacity, 3)}`,
    `--book-wear-opacity:${rounded(profile.wearOpacity, 3)}`,
  ].join(";");
}
