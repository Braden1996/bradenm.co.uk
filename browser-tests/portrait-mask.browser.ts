// cspell:ignore networkidle
import { expect, test } from "@playwright/test";
import sharp from "sharp";

type Print = {
  data: Buffer;
  width: number;
};

type RegionMeasurements = {
  face: number[];
  shoulder: number[];
};

function colour(print: Print, x: number, y: number) {
  const index = (Math.round(y) * print.width + Math.round(x)) * 3;
  return [print.data[index] ?? 0, print.data[index + 1] ?? 0, print.data[index + 2] ?? 0] as const;
}

function luminance(print: Print, x: number, y: number) {
  const [red, green, blue] = colour(print, x, y);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

// The paint is coloured; portrait ink and paper are warm. Locate the paint's
// colour boundary, interpolating its crossing to avoid whole-pixel rounding.
function paintEdge(
  start: number,
  end: number,
  score: (position: number) => number,
  entering: boolean,
) {
  let previous = score(start);
  for (let position = start + 1; position <= end; position++) {
    const current = score(position);
    if (entering ? previous <= 0 && current > 0 : previous > 0 && current <= 0) {
      return position - 1 + previous / (previous - current);
    }
    previous = current;
  }
  throw new Error("Expected coloured paint boundary is missing");
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

for (const dpr of [1, 2]) {
  test.describe(`portrait mask at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("activation preserves face and shoulder cuts and their painted shadows", async ({
      page,
    }) => {
      // Keyboard activation and an unavailable video isolate the first print
      // from both sequence motion and the kinetic cursor.
      await page.route("**/*.mp4*", (route) => route.abort());
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.mouse.move(5, 900);
      const portrait = page.locator(".about-portrait");
      const rectangle = await portrait.boundingBox();
      const poster = await page.locator(".about-portrait__poster").boundingBox();
      if (!rectangle || !poster) throw new Error("Portrait geometry is unavailable");
      const before = await portrait.screenshot();

      await portrait.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-about-portrait]")).toHaveAttribute(
        "data-motion-ready",
        "true",
      );
      await expect(page.locator(".about-portrait__poster")).toHaveCSS("opacity", "0");
      await expect(page.locator(".about-portrait__canvas")).toHaveCSS("opacity", "1");
      const after = await portrait.screenshot();
      expect(await portrait.boundingBox()).toEqual(rectangle);

      const prints = await Promise.all(
        [before, after].map(async (png): Promise<Print> => {
          const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({
            resolveWithObject: true,
          });
          return { data, width: info.width };
        }),
      );
      const [staticPrint, livePrint] = prints;
      if (!staticPrint || !livePrint) throw new Error("Portrait screenshots are unavailable");
      const scale = (poster.width / 1200) * dpr;
      const xAt = (x: number) => Math.round((poster.x - rectangle.x) * dpr + x * scale);
      const yAt = (y: number) => Math.round((poster.y - rectangle.y) * dpr + y * scale);
      const displacement: RegionMeasurements = { face: [], shoulder: [] };
      const paintTone: RegionMeasurements = { face: [], shoulder: [] };

      // Sample the blue edge alongside the face, away from the block's own
      // outer edges. The previous unframed mask jumped 4–8 CSS pixels here.
      for (let sourceY = 220; sourceY <= 360; sourceY += 8) {
        const y = yAt(sourceY);
        const edges = prints.map((print) =>
          paintEdge(
            xAt(670),
            xAt(950),
            (x) => {
              const [red, green, blue] = colour(print, x, y);
              return Math.min(blue - red - 14, green - red - 7);
            },
            true,
          ),
        );
        const [first, second] = edges;
        if (first === undefined || second === undefined) throw new Error("Missing face edge");
        displacement.face.push(Math.abs(first - second) / dpr);
        for (const distance of [2, 4, 6]) {
          const x = Math.max(first, second) + distance * dpr;
          paintTone.face.push(luminance(livePrint, x, y) - luminance(staticPrint, x, y));
        }
      }

      // Follow the green block's lower cut above the shoulder. Its old
      // static edge moved in the opposite direction from the blue face cut.
      for (let sourceX = 155; sourceX <= 285; sourceX += 10) {
        const x = xAt(sourceX);
        const edges = prints.map((print) =>
          paintEdge(
            yAt(260),
            yAt(540),
            (y) => {
              const [red, green, blue] = colour(print, x, y);
              return Math.min(green - red - 6, blue - red);
            },
            false,
          ),
        );
        const [first, second] = edges;
        if (first === undefined || second === undefined) throw new Error("Missing shoulder edge");
        displacement.shoulder.push(Math.abs(first - second) / dpr);
        for (const distance of [2, 4, 6]) {
          const y = Math.min(first, second) - distance * dpr;
          paintTone.shoulder.push(luminance(livePrint, x, y) - luminance(staticPrint, x, y));
        }
      }

      for (const region of ["face", "shoulder"] as const) {
        // A small sampling allowance covers responsive AVIF edges and the
        // browser's different image/canvas minification, without hiding a snap.
        expect(mean(displacement[region]), `${region} mean edge displacement`).toBeLessThan(1);
        expect(
          Math.max(...displacement[region]),
          `${region} maximum edge displacement`,
        ).toBeLessThan(1.5);
        expect(Math.abs(mean(paintTone[region])), `${region} painted shadow change`).toBeLessThan(
          2,
        );
      }
    });
  });
}
