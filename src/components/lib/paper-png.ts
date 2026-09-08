import { deflateSync } from "node:zlib";

/*
 * A minimal RGBA PNG writer. Build time only — it reaches for `node:zlib` and
 * must never be pulled into a client bundle.
 *
 * Only what a baked frame needs: eight-bit RGBA, no interlacing, a single IDAT.
 * Scanlines are Sub-filtered, which on a gradient leaves near-zero residuals
 * along each row and roughly halves the compressed size against no filter.
 */

const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const bytesPerPixel = 4;
const subFilter = 1;
const bitDepth = 8;
const truecolourWithAlpha = 6;

let crcTable: Uint32Array | undefined;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  crcTable = table;

  return table;
}

function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffff_ffff;

  for (const byte of bytes) {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Length, then type and body, then a CRC taken over the type and body together. */
function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length);

  for (let index = 0; index < 4; index += 1) {
    body[index] = type.charCodeAt(index);
  }

  body.set(data, 4);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));

  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** `pixels` is RGBA, row major, `width * height * 4` long. Returns a data URI. */
export function encodeRgbaPng(pixels: Uint8ClampedArray, width: number, height: number) {
  const stride = width * bytesPerPixel;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rawRow = y * (stride + 1);
    const pixelRow = y * stride;
    raw[rawRow] = subFilter;

    for (let index = 0; index < stride; index += 1) {
      const current = pixels[pixelRow + index] ?? 0;
      const left = index >= bytesPerPixel ? (pixels[pixelRow + index - bytesPerPixel] ?? 0) : 0;
      raw[rawRow + 1 + index] = (current - left) & 0xff;
    }
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = truecolourWithAlpha;
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const png = concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ]);

  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
