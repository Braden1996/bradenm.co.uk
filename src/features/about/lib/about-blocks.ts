import { paperWashAccents, paperWashTints } from "../../../components/lib/paper-accents";
import type { PaintedBlockStyle } from "../../../components/lib/paper-paint";

/**
 * The collage paint behind and in front of the portrait — one shared spec so
 * the SSR fallback markup (about-portrait.astro) and the WebGL renderer draw
 * the same rectangles, colours and patina framing.
 *
 * Rects are media-space (1200x800): the same coordinate frame as the packed
 * video, so a rect reads directly against the matte. Staging (Braden's
 * sketch, 2026-08): two full-drop columns the figure interleaves with — one
 * clear of the face, one straight through the head's right side — and, in
 * front of the print, a wide painted wash along the foot that the figure
 * rests in, green under the green column running out to peach at the right,
 * which is where the warm accent lives. Rects may overrun the 800-tall band;
 * the stage vignette owns fading their ends.
 *
 * Both columns take the painter's `wet` look: a real gouache block is not one
 * flat colour — the blues are not all the same blue, the greens not all the
 * same green — so each carries a companion tint a little cooler and greyer
 * than its pigment, which the paint drifts toward in patches, over lighter
 * and darker passes of the brush.
 */
export type AboutBlock = {
  alpha: number;
  color: string;
  /** The tint the wet look drifts toward in places — a near neighbour of `color`. */
  companion?: string;
  /** Seeds the block's unique painted texture — no two bake alike. */
  seed: number;
  rect: { height: number; left: number; top: number; width: number };
  style?: PaintedBlockStyle;
};

export const rearAboutBlocks = {
  green: {
    alpha: 0.78,
    color: paperWashAccents.green,
    // A cooler grey-green: the sage's own shadow, not a second colour.
    companion: "#87a8a8",
    seed: 11,
    style: "wet",
    // Top sits just below the stage vignette's ramp (32 stage px), so the
    // column starts on a crisp printed edge rather than dissolving into fog.
    rect: { height: 854, left: 133, top: 40, width: 177 },
  },
  blue: {
    alpha: 0.76,
    color: paperWashAccents.blue,
    // The wash ramp's slate, so the block's lighter patches agree with the
    // footer wash it shares a palette with.
    companion: paperWashTints.slate,
    seed: 47,
    style: "wet",
    // Ends above the arm-and-cup opening: any lower and it peeks through the
    // gap beside the straw, ghosting under the foot wash in front.
    rect: { height: 430, left: 673, top: 53, width: 282 },
  },
} satisfies Record<string, AboutBlock>;

/**
 * A painted stroke in front of the print. The pigments run head to tail and
 * the stroke is pulled left to right, so the first pigment is the wet head on
 * the left and the last is the drying tail on the right.
 */
export type AboutStroke = {
  alpha: number;
  /** Where along the stroke the pigment front sits (0 head … 1 tail). */
  front: number;
  /** Base density; under 1 is a thinner, waterier wash than the blocks. */
  load: number;
  pigments: readonly [string, string];
  rect: { height: number; left: number; top: number; width: number };
  seed: number;
  /** 0 a crisp gouache stroke, toward 1 a feathered watery wash (paper-stroke). */
  softness: number;
  /** Nominal core thickness, media px. */
  thickness: number;
};

export const frontAboutStrokes = {
  foot: {
    // Watery and translucent: the ink and the paper show through, and the
    // edge bleeds rather than pools — Braden's reference, not the blocks'
    // flat-bodied gouache.
    alpha: 0.85,
    // Mostly peach: the green holds the first third and gives way early.
    front: 0.35,
    load: 1.05,
    pigments: [paperWashTints.mint, paperWashAccents.orange],
    seed: 139,
    softness: 0.6,
    thickness: 110,
    // Spine at media y ≈ 780, core ≈ 725–835: the wash straddles the media
    // band's foot, its upper half over the stage's bottom dissolve (82–100%)
    // so the figure fades INTO it, its lower half hanging under the band on
    // the paper. It overruns the band's width so the soft head and tail fall
    // at the frame's edges and the body runs the full breadth of the drawing.
    // The STAGE leaves this overhang under itself, so a box sized to the stage
    // still ends at the wash's last feathered pixel (`--about-stage-height` in
    // about-portrait.astro reserves 60/800 of its height for exactly this);
    // the foot clip has no vignette, so the wash's own feathered edge is what
    // finishes it. Move this rect's foot and that fraction must move with it. A front layer, so it carries no
    // occlusion mask.
    rect: { height: 160, left: -70, top: 700, width: 1340 },
  },
} satisfies Record<string, AboutStroke>;

/** Media x offset inside the 1440-wide stage (the media band is centred). */
export const MEDIA_TO_STAGE_X = 120;
