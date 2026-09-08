import { bakeStrokeImage } from "../lib/paper-stroke-image";
import { generatedAsset } from "../lib/generated-asset";

let asset: ReturnType<typeof build> | undefined;
async function build() {
  const image = await bakeStrokeImage(
    {
      width: 1024,
      height: 40,
      thickness: 13,
      scale: 2,
      seed: 817,
      alpha: 0.4,
      load: 1.1,
      softness: 0.35,
      pigments: ["#667c87", "#9baa98", "#c8c4ac"],
    },
    2,
  );
  return generatedAsset(
    "popover-divider.webp",
    Buffer.from(image.split(",")[1] ?? "", "base64"),
    "image/webp",
  );
}
export function getPopoverAsset() {
  return (asset ??= build());
}
