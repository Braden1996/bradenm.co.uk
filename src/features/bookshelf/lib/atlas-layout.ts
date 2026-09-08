import { bookCoverAspect } from "./book-cover";

export type AtlasCover = {
  src: string;
  width: number;
  height: number;
  candidates: { src: string; width: number; height: number }[];
};

type AtlasProfile = {
  width: number;
  height: number;
  depth: number;
  rotation: number;
  offsetX: number;
  offsetZ: number;
  hardback: boolean;
  coated: boolean;
  seed: number;
};

export type AtlasBook = {
  id: string;
  atlasIndex: number;
  title: string;
  author: string;
  formats: string[];
  cover: AtlasCover;
  profile: AtlasProfile;
};

// World units shared by the native scroll surface, its printed books and the camera.
export const ATLAS = {
  pitch: (50 * Math.PI) / 180,
  column: 3.32,
  row: 5.0,
  insetX: 0.5,
  insetY: 0.5,
  sprite: 6.2,
  pickupDuration: 600,
};

export function atlasProfile(title: string, author: string, width: number, height: number) {
  let seed = 2_166_136_261;
  for (const letter of `${title.toLowerCase()}::${author.toLowerCase()}`) {
    seed = Math.imul(seed ^ letter.charCodeAt(0), 16_777_619) >>> 0;
  }
  const unit = (offset: number) => ((seed >>> offset) & 255) / 255;
  const bookHeight = 2.95 + unit(0) * 0.85;
  return {
    width: bookHeight * bookCoverAspect(width, height),
    height: bookHeight,
    depth: 0.22 + unit(8) * 0.24,
    rotation: (unit(16) - 0.5) * 0.66,
    offsetX: (unit(8) - 0.5) * 0.32,
    offsetZ: (unit(0) - 0.5) * 0.3,
    hardback: seed % 4 === 0,
    coated: seed % 3 === 0,
    seed,
  } satisfies AtlasProfile;
}

type AtlasPlacement = { x: number; z: number; width: number; length: number };
export type AtlasLayout = { positions: AtlasPlacement[]; width: number; height: number };

/** A conservative footprint leaves the real, rotated covers and their hit targets apart. */
function atlasFootprint(profile: AtlasProfile) {
  const cosine = Math.abs(Math.cos(profile.rotation));
  const sine = Math.abs(Math.sin(profile.rotation));
  return {
    width: profile.width * cosine + profile.height * sine,
    length: profile.height * cosine + profile.width * sine + profile.depth * 0.5,
  };
}

/** Pack a continuous table, without lanes. Order and placement are stable for a given search. */
export function atlasLayout(books: Pick<AtlasBook, "profile">[], rows: number): AtlasLayout {
  const length = rows * ATLAS.row;
  const positions: AtlasPlacement[] = [];
  let edge = ATLAS.insetX;
  for (const book of books) {
    const { width, length: footprint } = atlasFootprint(book.profile);
    let seed = book.profile.seed;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 4_294_967_296;
    };
    const obstacles = positions.toSorted((a, b) => a.x - a.width / 2 - (b.x - b.width / 2));
    let best = { x: Infinity, z: 0, width, length: footprint };
    let bestScore = Infinity;
    // Different candidate depths and gaps break both the horizontal and vertical alignments.
    for (let attempt = 0; attempt < 28; attempt++) {
      const z = footprint / 2 + 0.15 + random() * (length - footprint - 0.3);
      const gap = 0.18 + random() * 0.38;
      let x = Math.max(positions.at(-1)?.x ?? 0, ATLAS.insetX + width / 2 + random() * 0.65);
      for (const other of obstacles) {
        if (Math.abs(z - other.z) >= (footprint + other.length) / 2 + gap) continue;
        if (x + width / 2 + gap <= other.x - other.width / 2) continue;
        x = Math.max(x, other.x + (width + other.width) / 2 + gap);
      }
      const score = x + random() * 0.7;
      if (score < bestScore) {
        best = { x, z, width, length: footprint };
        bestScore = score;
      }
    }
    positions.push(best);
    edge = Math.max(edge, best.x + width / 2);
  }
  return {
    positions,
    width: edge + ATLAS.insetX + 0.35,
    height: atlasHeight(rows),
  };
}

function atlasHeight(rows: number) {
  return ATLAS.insetY * 2 + rows * ATLAS.row * Math.sin(ATLAS.pitch);
}

export function atlasCoverSource(cover: AtlasCover, targetWidth: number) {
  return cover.candidates.find((candidate) => candidate.width >= targetWidth)?.src ?? cover.src;
}
