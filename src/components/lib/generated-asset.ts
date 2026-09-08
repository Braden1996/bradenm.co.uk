import { createHash } from "node:crypto";
import { extname } from "node:path";

export type GeneratedAsset = {
  fileName: string;
  url: string;
  bytes: Uint8Array;
  contentType: string;
};

/** Build-time assets use the encoded bytes as their cache identity. */
export function generatedAsset(
  name: string,
  bytes: Uint8Array,
  contentType: string,
): GeneratedAsset {
  const extension = extname(name);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const fileName = `${name.slice(0, -extension.length)}.${hash}${extension}`;

  return { bytes, contentType, fileName, url: `/generated/${fileName}` };
}
