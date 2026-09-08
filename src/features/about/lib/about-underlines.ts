import { paperWashAccents, paperWashTints } from "../../../components/lib/paper-accents";

/*
 * The painted underlines of the letter: what each name is stroked with, how
 * heavily, and the seed that makes its stroke unlike any other.
 *
 * The row is the career names: where to find Braden elsewhere is the
 * letterhead menu's business now, not the letter's.
 *
 * It carries a priority order, and it carries it the way the eye can actually
 * read one. Hue cannot rank a row of names — it is the weakest channel there
 * is for ordered data, and only a handful of colours are separable at a
 * glance — so hue here is IDENTITY (each name keeps its own colour, the
 * sheet's own inks and the wash ramp's in-between tints) and rank rides on
 * CONTRAST: how dark the stroke sits against the paper, how thick it is
 * pulled, how much paint it carries. At 0.15em a stroke's hue is barely
 * resolved and its darkness reads instantly, which is why the split works —
 * and why the order survives colour blindness, greyscale print and the
 * forced-colors fallback.
 *
 * Listed most to least prominent, so the ladder reads down the table.
 */

type UnderlinePigments = readonly [string, string] | readonly [string, string, string];

/*
 * Four weights of hand. `story` is the letter's own stroke — the weight every
 * underline used to carry — so the sheet's texture is unchanged and the tiers
 * above and below it are a spread around what was already there.
 *
 * Only ONE name may sit in `anchor`. A lone treatment is what makes it pop
 * out of the row; a second at the same weight cancels both. `reach` sits empty
 * since the letter stopped carrying the links to elsewhere — the weight is
 * kept because it is a rung of the ladder, not because anything is on it.
 */
export const underlineTiers = {
  anchor: { alpha: 0.86, load: 1.28, softness: 0, thicknessEm: 0.175 },
  reach: { alpha: 0.78, load: 1.2, softness: 0.08, thicknessEm: 0.16 },
  story: { alpha: 0.68, load: 1.12, softness: 0.18, thicknessEm: 0.148 },
  footnote: { alpha: 0.56, load: 1.04, softness: 0.35, thicknessEm: 0.135 },
} as const;

type UnderlineTier = keyof typeof underlineTiers;

export type AboutUnderline = {
  /**
   * Orders names WITHIN a tier, by a step too small to see on its own. Nobody
   * can rank these consciously — that is the point: they keep the row's
   * aggregate weight ordered without turning the letter into a colour key.
   */
  alphaNudge?: number;
  /** Bake length in em of the letter, when the label's character count misjudges it. */
  lengthEm?: number;
  /**
   * Head to tail. The dark pigment leads: the renderer's head is the wet,
   * pooled end where the brush touched down, and its tail is where the paint
   * dries and sputters out, so dark-to-pale is the way a loaded brush empties.
   */
  pigments: UnderlinePigments;
  seed: number;
  tier: UnderlineTier;
};

const { blue, green: sage, orange: peach } = paperWashAccents;
const { clay, dust, mint, shell, slate } = paperWashTints;

export const aboutUnderlines = {
  // The one anchor.
  attio: { pigments: [blue, slate], seed: 223, tier: "anchor" },

  minecraft: { alphaNudge: 0.04, pigments: [sage, sage], seed: 251, tier: "story" },
  cleo: { alphaNudge: 0.04, pigments: [dust, clay], seed: 229, tier: "story" },
  garrysMod: { alphaNudge: -0.01, pigments: [dust, peach], seed: 257, tier: "story" },
  thoughtMachine: { alphaNudge: -0.06, pigments: [slate, mint], seed: 227, tier: "story" },
  cardiff: { alphaNudge: -0.07, pigments: [sage, clay], seed: 241, tier: "story" },
  isembard: { alphaNudge: -0.08, pigments: [dust, mint], seed: 211, tier: "story" },

  contentsquare: { alphaNudge: -0.02, pigments: [sage, mint], seed: 233, tier: "footnote" },
  theodo: { alphaNudge: -0.03, pigments: [dust, shell], seed: 239, tier: "footnote" },
} satisfies Record<string, AboutUnderline>;

export type AboutUnderlineKey = keyof typeof aboutUnderlines;

/*
 * Bake resolution: the letter tops out at 20.16px, shown at 2 device px per CSS
 * px, and the stroke is rendered at 2× that and downsampled so a 2–3px-tall
 * stroke still carries real edge detail — 80 texels per em of the letter.
 */
export const UNDERLINE_TEXELS_PER_EM = 80;

/** A label's set width in em of the letter, from its character count alone. */
export function estimateLabelEm(label: string, emPerChar = 0.5) {
  return Math.max(1, label.length * emPerChar);
}
