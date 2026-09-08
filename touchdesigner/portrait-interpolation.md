# Portrait interpolation bake

<!-- cspell:ignore venv numpy contrib bunx -->

The CPU bake reads the original packed portrait video and `prop-support.png`. It
computes optical flow between adjacent frames and matches dots to unique target
cells. The source frames retain their original content and order.

Use Python 3.12 with the pinned authoring dependencies, then publish the generated
atlas and metadata to their separate source locations:

```sh
python3.12 -m venv /tmp/portrait-authoring
/tmp/portrait-authoring/bin/python -m pip install numpy==1.26.4 opencv-contrib-python==4.11.0.86
/tmp/portrait-authoring/bin/python touchdesigner/scripts/bake-portrait-correspondence.py
cp artifacts/portrait-correspondence/correspondence.png images/source/about-motion/packed/portrait-correspondence.png
cp artifacts/portrait-correspondence/correspondence.json artifacts/portrait-correspondence/interpolation-confidence.json images/source/about-motion/interpolation/
bun x prettier --write images/source/about-motion/interpolation/*.json
```

The default source is `images/source/about-motion/packed/portrait-packed.mp4`;
`--source`, `--out`, and `--support` override the inputs and output directory. Bake
outputs live under `artifacts/portrait-correspondence`. Keep the runtime PNG only
in `packed/`, with its metadata in `interpolation/`.

The bake records source hashes, dependency versions, flow settings, matching counts,
and confidence metrics. It verifies unique targets and decodes the written PNG to
check every target ID, incoming flag, and opaque alpha value. Repeated runs with
the pinned dependencies on the same platform produce an identical atlas.

Transport requires at least 90% visible matching, 70% matching in moving regions,
and a forward/backward flow error at the 95th percentile of at most 12 source
pixels. The current source preserves sharp playback for pairs 20→21, 23→24,
24→25, and 25→26. Other pairs interpolate position and appearance; unmatched
endpoints fade out or in. Position, appearance, and the background cut-out share one
smooth transition over the middle 40% of each pair interval. The rest of that interval
holds a complete source print. There are no per-cell timing offsets. Review intermediate
frames after changing dependencies.
If confidence decisions change, update `SHARP_SOURCE_PAIRS` in the renderer to
match the generated report before publishing the atlas.

The 3200×1242 atlas contains 8×6 tiles of 400×207 cells. Each opaque pixel encodes
`code = R + 256*G + 65536*B`: `code % 131072` is the target index plus one, or zero
for an unmatched source. `floor(code / 131072) % 2` indicates an incoming match at
that same cell. Indices are `row*400+column`; PNG row zero is the top row. Read
integer texels without filtering.

Stage centres are `(cell + 0.5) * [3.6, 3.87]`; source coordinates are
`(stage - [720, 400]) / 1.03 + [590.4, 400]`. Keep the renderer's framing and grid
aligned with this mapping.

## Poster bake

The fallback poster uses the same WebGL renderer, packed reference frame, glyph
atlas, prop matte and rear paint textures as the interactive portrait. A single
transparent image contains the portrait and rear blocks, with the same framing,
paper gap and cast shadow as the live block shader. The photographs and video
frames are unchanged. Extract the still from the browser decoder before baking:

```sh
bunx playwright install chromium
bun touchdesigner/scripts/extract-packed-still.mjs
bun touchdesigner/scripts/render-live-poster.mjs \
  --width 1800 --display-width 480 \
  --out images/source/about-motion/rendered/poster.png
```

The extraction command uses the production video-frame decoder and captures
zero-based frame 6 at `(6 + 0.5) / 12` seconds. It verifies identical pixels from
both independent decode lanes, then writes lossless WebP and compares every
decoded RGBA byte. `--check` validates the existing still without replacing it.
Lossy still encoding would change some marks when the first video frame arrives.
The rear blocks need no separate CSS cut-out mask or CPU matte bake. The text-flow
silhouette still uses the unchanged all-frame matte sequence.

`--width` controls output pixels; `--display-width` controls the media's CSS layout
width. Both enhancement tiers share a fixed 2160×1200 carrier and print pitch of
1.44×1.548, so switching tiers cannot change the ink. The light tier retains its
30fps limit. The final canvas still follows device pixels, and brush size still
follows the actual CSS layout. The default bake renders the 576×320 CSS stage at
3.75× device resolution and crops its central 1800×1200 portrait directly from the
carrier. This preserves the
original media framing without another filtering pass. The output stays
transparent; the page supplies its existing paper, foreground wash, and fades. Astro
generates responsive AVIF and WebP variants up to the native 1800-pixel width.

The command bundles the production TypeScript renderer and uses software WebGL
in the package-pinned Playwright Chromium. It verifies identical repeated still
renders and source uploads, checks WebGL errors, and preserves visible ink and
transparent paper. Set `CHROME_PATH` only to select a different installed
Chromium executable. Browser or renderer changes can change rasterization, so
review the live handoff at both 1× and 2× display resolution after rebuilding.
Use `--out /tmp/portrait-preview.png --preview` to inspect a bake before replacing
the committed poster.
