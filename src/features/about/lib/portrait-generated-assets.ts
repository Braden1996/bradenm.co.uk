import { generatedAsset } from "../../../components/lib/generated-asset";
import { renderPaintedBlock, type PaintedBlockSpec } from "../../../components/lib/paper-paint";
import { renderPaintedStroke } from "../../../components/lib/paper-stroke";
import { encodeRgbaWebp } from "../../../components/lib/paper-webp";
import { frontAboutStrokes, rearAboutBlocks, type AboutStroke } from "./about-blocks";

function imageAsset(name: string, dataUri: string) {
  return generatedAsset(
    name,
    Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"),
    "image/webp",
  );
}

async function paintedBlock(name: string, spec: PaintedBlockSpec) {
  const image = await encodeRgbaWebp(renderPaintedBlock(spec), {
    alphaQuality: 100,
    downsample: 1,
    key: JSON.stringify(spec),
    quality: 82,
  });
  return imageAsset(name, image);
}

async function paintedStroke(name: string, stroke: AboutStroke) {
  const spec = {
    alpha: stroke.alpha,
    front: stroke.front,
    height: stroke.rect.height,
    load: stroke.load,
    pigments: stroke.pigments,
    scale: 1,
    seed: stroke.seed,
    softness: stroke.softness,
    thickness: stroke.thickness,
    width: stroke.rect.width,
  };
  const image = await encodeRgbaWebp(renderPaintedStroke(spec), {
    alphaQuality: 100,
    downsample: 1,
    key: JSON.stringify(spec),
    quality: 82,
  });
  return imageAsset(name, image);
}

async function buildAssets() {
  const [green, blue, foot] = await Promise.all([
    paintedBlock("portrait-green.webp", rearAboutBlocks.green),
    paintedBlock("portrait-blue.webp", rearAboutBlocks.blue),
    paintedStroke("portrait-foot.webp", frontAboutStrokes.foot),
  ]);
  return { green, blue, foot };
}

let pending: ReturnType<typeof buildAssets> | undefined;

export function getPortraitGeneratedAssets() {
  pending ??= buildAssets();
  return pending;
}
