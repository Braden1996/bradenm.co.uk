import { ATLAS, type AtlasBook } from "./atlas-layout";
import type { AtlasView } from "./atlas-camera";

/** Capture screen positions so a new query can redirect an unfinished move without a jump. */
export function atlasTransition(
  from: AtlasView,
  before: AtlasBook[],
  to: AtlasView,
  after: AtlasBook[],
) {
  const projection = Math.sin(ATLAS.pitch);
  const fromUnit = from.unit * from.camera.zoom;
  const origins = new Map(
    before.map((book, index) => {
      const position = from.layout.positions[index];
      return [
        book.id,
        position
          ? {
              ...position,
              x: position.x * fromUnit + from.camera.x,
              y: (ATLAS.insetY + position.z * projection) * fromUnit + from.camera.y,
              rotation: position.rotation ?? book.profile.rotation,
              scale: position.scale ?? 1,
            }
          : null,
      ];
    }),
  );
  return (progress: number): AtlasView => {
    if (progress >= 1) return to;
    const t = progress * progress * (3 - 2 * progress);
    const mix = (a: number, b: number) => a + (b - a) * t;
    const unit = mix(fromUnit, to.unit);
    return {
      ...to,
      camera: { zoom: 1, x: 0, y: 0 },
      unit,
      layout: {
        ...to.layout,
        positions: to.layout.positions.map((position, index) => {
          const book = after[index];
          const origin = book ? origins.get(book.id) : null;
          const x = position.x * to.unit;
          const y = (ATLAS.insetY + position.z * projection) * to.unit;
          const rotation = position.rotation ?? book?.profile.rotation ?? 0;
          return {
            ...position,
            x: mix(origin?.x ?? x, x) / unit,
            z: (mix(origin?.y ?? y, y) / unit - ATLAS.insetY) / projection,
            width: mix(origin?.width ?? position.width, position.width),
            length: mix(origin?.length ?? position.length, position.length),
            rotation: mix(origin?.rotation ?? rotation, rotation),
            scale: mix(origin?.scale ?? 0, 1),
          };
        }),
      },
    };
  };
}
