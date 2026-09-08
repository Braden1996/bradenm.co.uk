export type AboutPortraitAssets = {
  /** Responsive static poster candidates, shared with the first-paint preload. */
  posterSrcSet: string;
  posterAvifSrcSet: string;
  paint: { green: string; blue: string; foot: string };
  posterSizes: string;
  /** 32x32 grid of 936 glyph coverage cells, sampled by the WebGL carrier. */
  glyphAtlas: string;
  /** Adjacent-frame correspondences used to interpolate the original printed frames. */
  correspondence: string;
  /** Packed colour|matte loop consumed as a WebGL texture. */
  packedVideo: string;
  /** Packed colour|matte still for static and paused states. */
  packedStill: string;
  /** Fixed matte covering the cup and upright utensils. */
  propSupport: string;
};
