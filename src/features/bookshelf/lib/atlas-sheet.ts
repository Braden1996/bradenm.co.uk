import type { AtlasBook } from "./atlas-layout";
export const ATLAS_SHEET = { columns: 16, coverWidth: 104, coverHeight: 152, previewSize: 160 };
export function atlasCoverRegion(book: AtlasBook, count: number) {
  const scale = Math.min(
    (ATLAS_SHEET.coverWidth - 4) / book.cover.width,
    (ATLAS_SHEET.coverHeight - 4) / book.cover.height,
    1,
  );
  const width = Math.max(1, Math.round(book.cover.width * scale));
  const height = Math.max(1, Math.round(book.cover.height * scale));
  const x = (book.atlasIndex % ATLAS_SHEET.columns) * ATLAS_SHEET.coverWidth + 2;
  const y = Math.floor(book.atlasIndex / ATLAS_SHEET.columns) * ATLAS_SHEET.coverHeight + 2;
  const sheetWidth = ATLAS_SHEET.columns * ATLAS_SHEET.coverWidth;
  const sheetHeight = Math.ceil(count / ATLAS_SHEET.columns) * ATLAS_SHEET.coverHeight;
  return {
    x,
    y,
    width,
    height,
    u: (x + 0.5) / sheetWidth,
    v: 1 - (y + height - 0.5) / sheetHeight,
    du: (width - 1) / sheetWidth,
    dv: (height - 1) / sheetHeight,
  };
}
