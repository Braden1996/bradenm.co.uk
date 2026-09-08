import { generatedAsset } from "../../../components/lib/generated-asset";
import { clamp } from "../../../components/lib/math";
import { periodicFbm2 } from "../../../components/lib/paper-noise";
import { encodeRgbaPng } from "../../../components/lib/paper-png";
import { bakeStrokeImage } from "../../../components/lib/paper-stroke-image";
import {
  aboutUnderlines,
  estimateLabelEm,
  UNDERLINE_TEXELS_PER_EM,
  underlineTiers,
  type AboutUnderline,
  type AboutUnderlineKey,
} from "./about-underlines";
import { careerCards } from "./career-card-index";
import { CAREER_RULE_HEIGHT, CAREER_RULE_WIDTH } from "./career-rule";

function imageAsset(name: string, dataUri: string, contentType = "image/webp") {
  return generatedAsset(
    name,
    Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"),
    contentType,
  );
}

// Preserve the original stroke bakes byte for byte. Their layout remains in
// the server markup; the hashed paint can be cached across room visits.
const UNDERLINE_SUPERSAMPLE = 2;
const UNDERLINE_HEIGHT_EM = 0.34;

async function underline(key: AboutUnderlineKey, label: string) {
  const entry: AboutUnderline = aboutUnderlines[key];
  const { alphaNudge = 0, lengthEm, pigments, seed, tier } = entry;
  const { alpha, load, softness, thicknessEm } = underlineTiers[tier];
  const image = await bakeStrokeImage(
    {
      alpha: alpha + alphaNudge,
      height: Math.round(UNDERLINE_HEIGHT_EM * UNDERLINE_TEXELS_PER_EM),
      load,
      pigments,
      scale: 2.2,
      seed,
      softness,
      thickness: thicknessEm * UNDERLINE_TEXELS_PER_EM,
      width: Math.round((lengthEm ?? estimateLabelEm(label)) * UNDERLINE_TEXELS_PER_EM),
    },
    UNDERLINE_SUPERSAMPLE,
  );
  // These tiny paints are only 1–3 KiB each. Keeping them with the letter
  // avoids nine extra image requests on its first-render critical path.
  return image;
}

function signatureTooth() {
  const tile = 160;
  const scale = 0.45;
  const pixels = new Uint8ClampedArray(tile * tile * 4);
  for (let y = 0; y < tile; y += 1) {
    for (let x = 0; x < tile; x += 1) {
      const tooth = periodicFbm2(x * scale, y * scale, 3, tile * scale, tile * scale, 977);
      const level = Math.round(clamp(0.86 + 0.6 * (tooth - 0.5), 0.46, 1) * 6) / 6;
      pixels[(y * tile + x) * 4 + 3] = Math.round(level * 255);
    }
  }
  return imageAsset("letter-signature-tooth.png", encodeRgbaPng(pixels, tile, tile), "image/png");
}

async function careerRule() {
  const supersample = 2;
  const image = await bakeStrokeImage(
    {
      alpha: 0.72,
      height: CAREER_RULE_HEIGHT * supersample,
      load: 1.4,
      pigments: ["#5a5349", "#847c6f"],
      scale: supersample,
      seed: 271,
      softness: 0.1,
      thickness: 1.2 * supersample,
      width: CAREER_RULE_WIDTH * supersample,
    },
    supersample,
  );
  return imageAsset("letter-career-rule.webp", image);
}

async function buildAssets() {
  const paintedCards = await Promise.all(
    careerCards.map(async (card) => {
      const paint: AboutUnderline = aboutUnderlines[card.underline];
      const { alpha, load, softness } = underlineTiers[paint.tier];
      const image = await bakeStrokeImage(
        {
          alpha: alpha + (paint.alphaNudge ?? 0),
          height: 28,
          load,
          pigments: paint.pigments,
          scale: 2.2,
          seed: paint.seed,
          softness,
          thickness: 16,
          width: 272,
        },
        2,
      );
      return {
        card,
        noteStroke: imageAsset(`letter-card-${card.slug}.webp`, image),
        paint,
      };
    }),
  );
  const strokes = {
    attio: await underline("attio", "Attio"),
    cardiff: await underline("cardiff", "Cardiff University"),
    cleo: await underline("cleo", "Cleo"),
    contentsquare: await underline("contentsquare", "Contentsquare"),
    garrysMod: await underline("garrysMod", "Garry’s Mod"),
    isembard: await underline("isembard", "Isembard"),
    minecraft: await underline("minecraft", "Minecraft"),
    theodo: await underline("theodo", "Theodo"),
    thoughtMachine: await underline("thoughtMachine", "Thought Machine"),
  };
  return {
    careerRule: await careerRule(),
    signatureTooth: signatureTooth(),
    paintedCards,
    strokes,
  };
}

let pending: ReturnType<typeof buildAssets> | undefined;

/** Build once for both the room markup and Astro's static asset endpoint. */
export function getLetterGeneratedAssets() {
  pending ??= buildAssets();
  return pending;
}
