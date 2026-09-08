import type { APIRoute, GetStaticPaths } from "astro";
import { getPaperAssets } from "../../components/lib/paper-assets";
import { getFontAssets } from "../../components/lib/site-fonts";
import { getLetterGeneratedAssets } from "../../features/about/lib/letter-generated-assets";
import { getPortraitGeneratedAssets } from "../../features/about/lib/portrait-generated-assets";
import { getSignatureAssets } from "../../features/about/lib/signature-assets";
import { getDrainAssets } from "../../features/about/lib/about-drain-tiles";
import { getPopoverAsset } from "../../components/popover-kit/popover-assets";

async function assets() {
  const [paper, fonts, portrait, signature, letter] = await Promise.all([
    getPaperAssets(),
    getFontAssets(),
    getPortraitGeneratedAssets(),
    getSignatureAssets(),
    getLetterGeneratedAssets(),
  ]);
  const drain = getDrainAssets();
  return [
    await getPopoverAsset(),
    drain.coarse,
    drain.mid,
    drain.fine,
    ...Object.values(paper),
    ...Object.values(fonts),
    ...Object.values(portrait),
    ...Object.values(signature),
    letter.careerRule,
    letter.signatureTooth,
    ...letter.paintedCards.map(({ noteStroke }) => noteStroke),
  ];
}

export const getStaticPaths: GetStaticPaths = async () =>
  (await assets()).map((asset) => ({ params: { asset: asset.fileName } }));

export const GET: APIRoute = async ({ params }) => {
  const asset = (await assets()).find((candidate) => candidate.fileName === params.asset);
  if (!asset) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: { "Content-Type": asset.contentType },
  });
};
