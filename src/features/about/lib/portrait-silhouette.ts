import portraitSilhouette from "../../../../data/portrait-silhouette.json";

/**
 * The baked subject silhouette (scripts/sync-portrait-silhouette.mjs): per
 * rowStep-px row band, the [left, right] body intervals in stage px that text
 * must stay outside. The type mirrors the JSON's own shape, so no assertion
 * is needed — the bake script is the single owner of the contract.
 */
export type PortraitSilhouette = {
  margin: number;
  rowStep: number;
  rows: number[][][];
  splitX: number;
  stage: { height: number; width: number };
  version: number;
};

export const PORTRAIT_SILHOUETTE: PortraitSilhouette = portraitSilhouette;
