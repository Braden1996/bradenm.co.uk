import { describe, expect, test } from "bun:test";
import { paperWashAccents } from "../src/components/lib/paper-accents";
import { buildPigmentRamp, mixPigments, parseHex } from "../src/components/lib/paper-pigment";

const toLinear = (channel: number) =>
  channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** Saturation as the spread of the linear channels: zero for any grey. */
function spread(rgb: readonly number[]) {
  const linear = rgb.map(toLinear);

  return Math.max(...linear) - Math.min(...linear);
}

describe("mixPigments", () => {
  test("returns the exact pigments at either end", () => {
    const green = parseHex(paperWashAccents.green);
    const blue = parseHex(paperWashAccents.blue);

    expect(mixPigments(green, blue, 0)).toEqual(green);
    expect(mixPigments(green, blue, 1)).toEqual(blue);
  });

  test("muddies a blue-to-peach mix instead of sweeping through saturated green", () => {
    const blue = parseHex(paperWashAccents.blue);
    const peach = parseHex(paperWashAccents.orange);
    const midpoint = mixPigments(blue, peach, 0.5);
    const [red, green, blueChannel] = midpoint;

    // Not grey: the midpoint still carries pigment...
    expect(spread(midpoint)).toBeGreaterThan(0.05);
    // ...but well under the endpoints' saturation, and not a luminous green.
    expect(spread(midpoint)).toBeLessThan(0.5 * Math.max(spread(blue), spread(peach)));
    expect(green - Math.max(red, blueChannel)).toBeLessThan(0.12);
  });

  test("leaves neighbouring hues (green to blue) at full chroma", () => {
    const green = parseHex(paperWashAccents.green);
    const blue = parseHex(paperWashAccents.blue);
    const midpoint = mixPigments(green, blue, 0.5);

    expect(spread(midpoint)).toBeGreaterThan(0.8 * Math.min(spread(green), spread(blue)));
  });
});

describe("buildPigmentRamp", () => {
  test("starts and ends on the pigments and holds a plateau of each", () => {
    const ramp = buildPigmentRamp([paperWashAccents.green, paperWashAccents.blue], 256);
    const green = parseHex(paperWashAccents.green);
    const blue = parseHex(paperWashAccents.blue);

    expect(ramp[0]).toEqual(green);
    expect(ramp[60]).toEqual(green);
    expect(ramp[200]).toEqual(blue);
    expect(ramp[255]).toEqual(blue);
  });
});
