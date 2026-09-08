const restingWashHeight = 45;
const referenceCanvasHeight = 212;
const curvedWashHeight = 53;

function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value));

  return t * t * (3 - 2 * t);
}

/** Strengthen the About graphic's existing pigments without introducing new hues. */
function createPullWash(source: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  const dense = document.createElement("canvas");
  dense.width = canvas.width;
  dense.height = canvas.height;
  const denseContext = dense.getContext("2d");
  if (!context || !denseContext) return undefined;

  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  // The resting wash is thinned to 65% coverage; a full pull reaches 90%.
  // Keep its RGB and soft edges intact so green, blue and orange all deepen
  // along the same colour path as the painted portrait.
  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    pixels.data[offset] = Math.round((pixels.data[offset] ?? 0) * (0.9 / 0.65));
  }

  denseContext.putImageData(pixels, 0, 0);

  return { canvas, context, dense };
}

/** Each column starts at the same foot and only grows upward during a pull. */
export function paperOverscrollColumnHeight(u: number, pull: number, canvasHeight: number) {
  const extension = Math.min(1, Math.max(0, pull));
  const rise = 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
  const maximumHeight = Math.max(
    restingWashHeight,
    (curvedWashHeight * (1 + rise * 2.5) * canvasHeight) / referenceCanvasHeight,
  );

  return restingWashHeight + extension * (maximumHeight - restingWashHeight);
}

/** Stretch one wash upward while progressively strengthening its shared pigments. */
export function createPaperOverscrollRenderer(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement,
  occlusion: HTMLCanvasElement,
) {
  const rawContext = canvas.getContext("2d");
  const rawOcclusionContext = occlusion.getContext("2d");
  const rawPalette = createPullWash(source);

  if (!rawContext || !rawOcclusionContext || !rawPalette) return undefined;

  const context = rawContext;
  const occlusionContext = rawOcclusionContext;
  const palette = rawPalette;
  const width = source.naturalWidth;
  const paperColor = getComputedStyle(occlusion).color;
  let cssHeight = referenceCanvasHeight;
  let pixelRatio = 1;
  let paintedPull = 0;

  function paint(pull: number) {
    paintedPull = Math.min(1, Math.max(0, pull));
    context.clearRect(0, 0, width, canvas.height);
    occlusionContext.clearRect(0, 0, width, occlusion.height);
    const strength = smoothstep(paintedPull);
    let image: CanvasImageSource = source;

    if (strength > 0) {
      // Add weighted premultiplied pixels before stretching. A source-over
      // crossfade would briefly reduce the translucent wash's colour strength.
      palette.context.globalCompositeOperation = "copy";
      palette.context.globalAlpha = 1 - strength;
      palette.context.drawImage(source, 0, 0);
      palette.context.globalCompositeOperation = "lighter";
      palette.context.globalAlpha = strength;
      palette.context.drawImage(palette.dense, 0, 0);
      image = palette.canvas;
    }

    // Integer columns tile the raster without overlaps or transparent seams.
    // The browser scales their shared low-frequency field to the viewport.
    for (let x = 0; x < width; x += 1) {
      const u = width > 1 ? x / (width - 1) : 0.5;
      const height = paperOverscrollColumnHeight(u, paintedPull, cssHeight) * pixelRatio;

      // Match the resting footer's 12px feather above the paint. The backing
      // is fully opaque throughout the wash, independent of pigment strength.
      const top = canvas.height - height;
      const feather = 12 * pixelRatio;
      const backing = occlusionContext.createLinearGradient(0, top - feather, 0, top);
      backing.addColorStop(0, "transparent");
      backing.addColorStop(1, "#000");
      occlusionContext.fillStyle = backing;
      occlusionContext.fillRect(x, top - feather, 1, height + feather);

      context.drawImage(image, x, 0, 1, source.naturalHeight, x, canvas.height - height, 1, height);
    }

    // Colour the alpha mask separately: interpolating from transparent black
    // to paper directly in Canvas2D would leave a dark rim along the feather.
    occlusionContext.globalCompositeOperation = "source-in";
    occlusionContext.fillStyle = paperColor;
    occlusionContext.fillRect(0, 0, width, occlusion.height);
    occlusionContext.globalCompositeOperation = "source-over";
  }

  function resize() {
    cssHeight = canvas.clientHeight || referenceCanvasHeight;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio));
    const height = Math.round(cssHeight * density);

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (occlusion.width !== width) occlusion.width = width;
    if (occlusion.height !== height) occlusion.height = height;
    // Use the rounded raster's actual scale so its resting band is 45 CSS px.
    pixelRatio = height / cssHeight;
    paint(paintedPull);
  }

  resize();

  return { paint, resize };
}
