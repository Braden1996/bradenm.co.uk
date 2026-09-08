import { ATLAS, atlasLayout, type AtlasBook, type AtlasLayout } from "./atlas-layout";

export type AtlasCamera = { zoom: number; x: number; y: number };
type ViewPlacement = AtlasLayout["positions"][number] & { rotation?: number; scale?: number };
export type AtlasView = {
  layout: Omit<AtlasLayout, "positions"> & { positions: ViewPlacement[] };
  unit: number;
  width: number;
  height: number;
  camera: AtlasCamera;
};
export const ATLAS_PADDING = 8;
const ATLAS_MAX_ZOOM = 6;

/** Reading order is left to right, then down; search rank determines the book in each slot. */
export function atlasSearchLayout(books: Pick<AtlasBook, "profile">[]): AtlasView["layout"] {
  const cellWidth = Math.max(2.5, ...books.map((book) => book.profile.width)) + 0.7;
  const cellDepth = Math.max(3.8, ...books.map((book) => book.profile.height)) + 0.65;
  const columns = Math.max(
    1,
    Math.min(
      books.length,
      Math.ceil(Math.sqrt((books.length * 1.65 * cellDepth * Math.sin(ATLAS.pitch)) / cellWidth)),
    ),
  );
  const rows = Math.max(1, Math.ceil(books.length / columns));
  return {
    width: ATLAS.insetX * 2 + columns * cellWidth,
    height: ATLAS.insetY * 2 + rows * cellDepth * Math.sin(ATLAS.pitch),
    positions: books.map((book, index) => ({
      x: ATLAS.insetX + ((index % columns) + 0.5) * cellWidth,
      z: (Math.floor(index / columns) + 0.5) * cellDepth,
      width: book.profile.width,
      length: book.profile.height + book.profile.depth * 0.5,
      rotation: 0,
    })),
  };
}

/** The same spread is printed by Astro and fitted by the browser; resizing never reorders it. */
export function atlasTableLayout(books: Pick<AtlasBook, "profile">[]) {
  const estimate = Math.max(1, Math.round(Math.sqrt(books.length / 1.7)));
  let best = atlasLayout(books, estimate);
  for (let rows = Math.max(1, estimate - 2); rows <= estimate + 3; rows++) {
    const candidate = atlasLayout(books, rows);
    if (
      Math.abs(Math.log(candidate.width / candidate.height / 1.65)) <
      Math.abs(Math.log(best.width / best.height / 1.65))
    )
      best = candidate;
  }
  return best;
}

export function atlasFittedView(
  layout: AtlasLayout,
  width: number,
  height: number,
  camera: AtlasCamera,
): AtlasView {
  const innerWidth = Math.max(1, width - ATLAS_PADDING * 2);
  const innerHeight = Math.max(1, height - ATLAS_PADDING * 2);
  const unit = Math.min(innerWidth / layout.width, innerHeight / layout.height, 92);
  // Expand the gaps along the spare axis, keeping covers proportional and footprints apart.
  const positions = layout.positions.map((position) => ({
    ...position,
    x: (ATLAS_PADDING + (position.x / layout.width) * innerWidth) / unit,
    z:
      ((ATLAS_PADDING +
        ((ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) / layout.height) * innerHeight) /
        unit -
        ATLAS.insetY) /
      Math.sin(ATLAS.pitch),
  }));
  return { layout: { ...layout, positions }, unit, width, height, camera };
}

export function atlasClampCamera(camera: AtlasCamera, width: number, height: number): AtlasCamera {
  const zoom = Math.max(1, Math.min(ATLAS_MAX_ZOOM, camera.zoom));
  return {
    zoom,
    x: Math.max(width * (1 - zoom), Math.min(0, camera.x)),
    y: Math.max(height * (1 - zoom), Math.min(0, camera.y)),
  };
}

export function atlasZoomAt(
  camera: AtlasCamera,
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const target = Math.max(1, Math.min(ATLAS_MAX_ZOOM, zoom));
  const ratio = target / camera.zoom;
  return atlasClampCamera(
    { zoom: target, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio },
    width,
    height,
  );
}

export function atlasTableStyle(layout: AtlasLayout) {
  return `--atlas-padding:${ATLAS_PADDING}px;--atlas-world-width:${layout.width};--atlas-world-height:${layout.height}`;
}
export function atlasBookStyle(layout: AtlasLayout, index: number) {
  const position = layout.positions[index];
  if (!position) return "";
  return `--book-x:${position.x / layout.width};--book-y:${(ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) / layout.height};--book-footprint-width:${position.width};--book-footprint-height:${position.length * Math.sin(ATLAS.pitch)}`;
}
