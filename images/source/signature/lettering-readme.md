# Signature lettering and landscape

<!-- cspell:ignore checkerboard -->

The original signature is `images/source/signature.webp` (2000 × 667). The handwriting spells
**Braden Marshall**. It is preserved from that source image, including the original brush texture.

The website layers share a 1000 × 334 transparent canvas:

- `public/about/signature/lettering.webp`: original ink, separated with narrow stroke masks. The
  dark, nearly neutral ink is separated from the landscape where the capital B overlaps it.
- `public/about/signature/landscape.webp`: the coastal illustration without lettering, occupying
  x = 7–282, y = 151–284. White connected to the outside of the generated source is removed
  mechanically; enclosed white details remain opaque.
- `src/features/about/lib/signature-strokes.ts`: ordered pen movements in the same coordinates.
  Each entry provides SVG path data, a reveal brush width, and a duration in milliseconds.

The static drawing sits underneath a sequence of animated SVG mask paths, retaining the original
signature instead of replacing it with a font. The paths cover more than 99.8% of the original dark
ink outside the overlapping illustrations. The stroke order follows the initial capital, each
connected letter, the surname, and finally the long underline from right to left.

Run `bun images/source/signature/export-layers.mjs` from the repository to export the two website
assets again. The script also writes two temporary previews for visual inspection. Both website
layers are lossless WebP with an alpha channel.

## Landscape generation

`landscape-generated.png` was created using the built-in ChatGPT image generation tool, using the
original signature as an edit target. This reconstructs the scenery beneath the original black
lettering. The output was generated on plain white, then isolated and placed at the original size
using Sharp. A first attempt at generated transparency returned a painted checkerboard and was
discarded.

Final prompt:

> Use case: precise-object-edit. Asset type: isolated original landscape for website signature.
> Edit the supplied reference. Return ONLY the small painted coastal cottage landscape from the
> bottom left, with ALL black handwriting, underline, and dog removed. Restore the coastal
> sea/hills beneath the removed capital B. Match the original cottage, gate, path, foxgloves,
> stone walls, cliffs, fields, and palette as closely as possible. Use a perfectly flat pure white
> (#ffffff) background, absolutely no checkerboard or grey grid or noise. Crop tightly around the
> small landscape, leaving a slim white margin. Preserve original landscape proportions (roughly
> 2.1:1 wide), with natural irregular vignette edges fading cleanly to pure white. This is a
> production asset to be keyed from white. Do not include any text, ink strokes, dog, drop shadow,
> borders, or checkerboard. The only painted subject is the original coastal cottage landscape.
