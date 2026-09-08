// The career cards the about page carries, in appendix order (most recent
// first). One list names the entry's slug, the content entry it shows and the
// heading it wears, so the letter, the appendix and the popover all agree.
import type { AboutUnderlineKey } from "./about-underlines";

export type CareerCardSpec = {
  /** The content entry (src/content/career/<entry>.md). */
  entry: string;
  /** The heading on the card — may differ from the entry's organisation. */
  organisation: string;
  /** The entry's stable name: the suffix of its card's element id. */
  slug: string;
  /** The palette shared by this note and its inline link. */
  underline: AboutUnderlineKey;
};

export const careerCards: readonly CareerCardSpec[] = [
  { entry: "isembard", organisation: "Isembard", slug: "isembard", underline: "isembard" },
  { entry: "minecraft", organisation: "Minecraft", slug: "minecraft", underline: "minecraft" },
  { entry: "garrys-mod", organisation: "Garry’s Mod", slug: "garrys-mod", underline: "garrysMod" },
  {
    entry: "cardiff-bsc",
    organisation: "Cardiff University",
    slug: "cardiff-university",
    underline: "cardiff",
  },
  { entry: "theodo-uk", organisation: "Theodo UK", slug: "theodo-uk", underline: "theodo" },
  {
    entry: "contentsquare",
    organisation: "Contentsquare",
    slug: "contentsquare",
    underline: "contentsquare",
  },
  { entry: "cleo", organisation: "Cleo", slug: "cleo", underline: "cleo" },
  {
    entry: "thought-machine",
    organisation: "Thought Machine",
    slug: "thought-machine",
    underline: "thoughtMachine",
  },
  { entry: "attio", organisation: "Attio", slug: "attio", underline: "attio" },
];

const CARD_ID_PREFIX = "career-card-";

/** Element id of the entry card for a slug; also the inline chip's hash target. */
export function careerCardId(slug: string) {
  return `${CARD_ID_PREFIX}${slug}`;
}
