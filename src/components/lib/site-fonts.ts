import { readFile } from "node:fs/promises";
import { generatedAsset } from "./generated-asset";

async function buildAssets() {
  const names = [
    "recoleta-semibold",
    "source-sans-3-variable",
    "newsreader-regular",
    "newsreader-italic",
  ];
  const files = await Promise.all(
    names.map(async (name) =>
      generatedAsset(
        `${name}.woff2`,
        await readFile(`public/fonts/${name}.subset.woff2`),
        "font/woff2",
      ),
    ),
  );
  const [recoleta, sourceSans, newsreader, newsreaderItalic] = files;
  if (!recoleta || !sourceSans || !newsreader || !newsreaderItalic) {
    throw new Error("Missing site font");
  }
  return { recoleta, sourceSans, newsreader, newsreaderItalic };
}

let pending: ReturnType<typeof buildAssets> | undefined;

export function getFontAssets() {
  pending ??= buildAssets();
  return pending;
}

/** Keep faces discoverable in the document head, with cacheable font bytes. */
export async function getFontStyles() {
  const fonts = await getFontAssets();
  return `
@font-face{font-family:"Recoleta";src:url("${fonts.recoleta.url}") format("woff2");font-weight:600;font-style:normal;font-display:swap;ascent-override:103.5%;descent-override:32.5%;line-gap-override:0%}
@font-face{font-family:"Source Sans 3";src:url("${fonts.sourceSans.url}") format("woff2");font-weight:200 900;font-style:normal;font-display:swap;unicode-range:U+0020-007F,U+00A0-00FF,U+2018-201D,U+2026;ascent-override:99.3%;descent-override:33.3%;line-gap-override:0%}
@font-face{font-family:"Newsreader";src:url("${fonts.newsreader.url}") format("woff2");font-weight:400;font-style:normal;font-display:swap;unicode-range:U+0020-007F,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026;ascent-override:83.5%;descent-override:16.5%;line-gap-override:0%}
@font-face{font-family:"Newsreader";src:url("${fonts.newsreaderItalic.url}") format("woff2");font-weight:400;font-style:italic;font-display:swap;unicode-range:U+0020-007F,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026;ascent-override:83.5%;descent-override:16.5%;line-gap-override:0%}
@font-face{font-family:"Source Sans Fallback";src:local("Arial"),local("Liberation Sans");font-weight:400;font-style:normal;size-adjust:90.124%;ascent-override:110.182%;descent-override:36.949%;line-gap-override:0%}
@font-face{font-family:"Newsreader Fallback";src:local("Georgia");font-weight:400;font-style:normal;size-adjust:91.637%;ascent-override:91.12%;descent-override:18.006%;line-gap-override:0%}
@font-face{font-family:"Newsreader Fallback";src:local("Georgia Italic");font-weight:400;font-style:italic;size-adjust:82.976%;ascent-override:100.632%;descent-override:19.885%;line-gap-override:0%}
@font-face{font-family:"Newsreader System Fallback";src:local("Times New Roman"),local("Liberation Serif");font-weight:400;font-style:normal;size-adjust:100.66%;ascent-override:82.952%;descent-override:16.392%;line-gap-override:0%}
@font-face{font-family:"Newsreader System Fallback";src:local("Times New Roman Italic"),local("Liberation Serif Italic");font-weight:400;font-style:italic;size-adjust:92.275%;ascent-override:90.49%;descent-override:17.881%;line-gap-override:0%}
@font-face{font-family:"Recoleta Fallback";src:local("Georgia Bold");font-weight:600;font-style:normal;size-adjust:88.164%;ascent-override:117.395%;descent-override:36.863%;line-gap-override:0%}
`;
}
