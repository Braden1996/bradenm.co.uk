# Typographic portrait — TouchDesigner authoring project

<!-- cspell:words venv keyint faststart libx264 hstack bunx SwiftShader -->

`about-portrait.toe` is the look-development source for the animated portrait on the
homepage. TouchDesigner is used to tune and render the effect; it is deliberately **not**
part of the website runtime.

## Network

The `ABOUT_PORTRAIT` component keeps the visual model inspectable:

1. `SOURCE_VIDEO` — the 48-frame, 12 fps source loop.
2. `SUBJECT_MATTE` — an aligned foreground matte.
3. `GLYPH_ATLAS` — 64 real mono-font glyphs ordered into eight tone families.
4. `PROP_SUPPORT` — an authored fixed matte for the cup, gelato and upright utensils.
5. `PACKED_MATTES` — the dynamic and fixed mattes packed into separate channels.
6. `TYPOGRAVURE` — one GPU shader rebuilding the source from cell-centred printed stamps,
   stable glyph identities, broken edge fragments and transparent output.
7. `FINAL_RGBA` — the output to inspect or record.

The parameters that materially change the look are grouped on the shader and documented
in `shaders/typogravure.frag`. Glyph identity is derived only from integer cell coordinates,
so it stays registered while the video moves. Source tone continuously changes each cell's
stamp size, glyph scale, stroke weight, opacity and presence. There is no greyscale photograph
or continuous detail wash beneath the marks: transparent paper channels form the visible grid.

## Rebuild the clean motion source

The v2 loop uses a true scoop, bite, withdrawal and return cycle. ImageGen supplies eight tightly
constrained, composition-locked pose anchors plus one depleted-chocolate prop state. The accepted
pose anchors remain complete frames so their hand, spoon, face and glasses stay internally
coherent. RIFE-MLX 4.25 is limited to small, safe gaps, with a clean authored pose occupying every
former hand/face ghost frame. A locked anisotropic crop is applied once, then Apple's Vision
framework regenerates all registered person mattes. Finally,
`apply-gelato-continuity.mjs` overlays only a 135 × 95-pixel feathered chocolate cavity in final
frame space. That last pass leaves all approved motion pixels outside the cavity unchanged.

The optional authoring dependencies remain outside the website package. On Apple Silicon:

```sh
git clone https://github.com/xocialize/rife-mlx.git /private/tmp/rife-mlx
git -C /private/tmp/rife-mlx checkout 764b89be56497fb26243d1de75f2957f3889e5d3
python3 -m venv /private/tmp/rife-mlx/.venv
/private/tmp/rife-mlx/.venv/bin/pip install -e /private/tmp/rife-mlx opencv-python-headless
bun touchdesigner/scripts/compose-motion-v2-keyframes.mjs
/private/tmp/rife-mlx/.venv/bin/python touchdesigner/scripts/make-clean-motion-v2.py
bun touchdesigner/scripts/apply-gelato-continuity.mjs \
  --base-frame-dir /private/tmp/braden-clean-motion-v2/source-frames \
  --base-video /private/tmp/braden-clean-motion-v2/braden-gelato-clean-loop-v2.mp4 \
  --base-matte-video /private/tmp/braden-clean-motion-v2/braden-gelato-clean-matte-loop-v2.mp4 \
  --output-dir /private/tmp/braden-clean-motion-v2-continuity
```

The cavity is applied after motion synthesis instead of being mixed into the pose compositor. This
prevents a prop correction from duplicating or clipping the hand, spoon, glasses, or face. The RIFE
model is pinned in the generated manifest to Hugging Face revision
`6b650eaa5664aab280119511fe944861491aa15e`. Copy the two generated v2 MP4 files from
`/private/tmp/braden-clean-motion-v2-continuity` into `touchdesigner/input` only after reviewing
its PNG source and matte sequences. The source manifest lives at
`images/source/about-motion/keyframes/v2/generation-manifest.json`. Rebuild the held-prop matte
separately after any crop change:

```sh
bun touchdesigner/scripts/make-prop-support.mjs
```

## Rebuild the glyph atlas

```sh
bun touchdesigner/scripts/make-glyph-atlas.mjs
```

The atlas uses the bundled Fira Code Nerd Font Mono file and is committed so opening the
project does not depend on an installed system font. The unmodified Nerd Fonts 3.4.0 binary
is distributed under the SIL Open Font License 1.1; see its
[notice](assets/fira-code-notice.md) and [full license](assets/fira-code-license.txt).

## Export

Render `FINAL_RGBA` as 48 straight-alpha PNG frames at 1200×800 and 12 fps. Do not record a
49th duplicate frame. Those PNG masters feed the packed colour|matte encode in the next
section — the site ships no alpha videos (the old VP9/HEVC-alpha delivery pipeline and its
`encode-web.sh` / `validate-web.mjs` helpers are gone).

The artwork remains transparent throughout. Paper and layout belong to the web page, not the
video.

## Live-runtime poster

The website no longer ships the rendered alpha videos: the runtime effect is a WebGL2
port of the carrier (`src/features/about/client/typogravure-shaders.ts`) fed by a packed
colour|matte H.264 loop, with fine glyph marks at a 3.6 x 3.87 pitch. Correspondence
between adjacent source frames moves the marks and blends their appearance using one
shared, brief transition; low-confidence transitions preserve sharp source frames.
Stable glyph sampling offsets and averaged paper coverage prevent aligned cell gutters
from appearing as a grid. See [portrait-interpolation.md](portrait-interpolation.md) for
the correspondence format and reproducible bake commands.
Pointer travel advances the film with a bounded, smoothly following playback target.
Hovering moves the film, parts the dots, and smears the paint; pressing adds a
pulse, and a click restores the resting pose. The loop is encoded with
4-frame GOPs for cheap random seeks.
`scripts/render-live-poster.mjs` bundles and runs the actual TypeScript renderer in
headless Playwright Chromium, using the same packed still, glyph atlas, prop matte and
rear paint textures as the website. It bakes the portrait and rear blocks into one
transparent poster, with the live shader's framing, paper gap and cast shadow.
Install the pinned browser once, then regenerate the SSR poster:

```sh
bunx playwright install chromium
bun touchdesigner/scripts/extract-packed-still.mjs
bun touchdesigner/scripts/render-live-poster.mjs
```

The reference still is a lossless copy of browser-decoded video frame 6, verified against
both runtime decode lanes. Both enhancement tiers share a 2160×1200 carrier and fixed
print pitch, so resizing or switching tiers cannot change the ink recipe. The light
tier retains its 30fps limit, and the final canvas retains exact device pixels.
The default bake displays the media at 480 CSS pixels (`--display-width 480`), renders
the 576×320 CSS stage at 3.75× device resolution, then crops the central 1800×1200 portrait
without resampling. `--width` controls output pixels independently of CSS layout size.
PNG export preserves straight alpha from
the renderer's premultiplied canvas. Responsive AVIF and WebP candidates are generated
from this master by Astro, including sizes for dense displays. The page supplies the
paper, foreground wash and fades. The poster already contains the rear blocks, so it
needs no separate CSS cut-out mask or CPU approximation of the live shader.

Re-run the command after any shader, packed-still or rear-block change so the SSR poster
(the no-JS/no-WebGL fallback) keeps the same marks, cut-out and shadow as the canvas. SwiftShader makes
the bake independent of local GPU drivers. The script checks that repeated unchanged
renders are identical, WebGL reports no errors, and the output contains transparent
paper and visible ink. Browser version changes can still change rasterization, so use
the package-pinned Chromium for reproducible builds; `CHROME_PATH` can select an
already installed browser for local look development.

Use `--out=/private/tmp/portrait.png --preview` for a disposable transparent PNG and a
paper-composited preview; `--width=1200` can inspect the renderer at another backing
resolution. Add `--verify-sizes` to render the source at 480, 800 and 1200 CSS pixels
at both 1× and 2× device resolution. This checks mean ink coverage and paper-composited
luminance in the full portrait, shirt, forehead and arm, rejecting variation above one
percentage point. Each configuration also reuploads the unchanged source and requires
an identical second render, so changes to the cached and freshly rendered paths are
checked together.

The temporary loopback server serves only the bundled renderer and its
explicit portrait inputs, and closes with the browser after the bake. Neither is part of
the deployed website.

To inspect the printed appearance of decoded video poses, use:

```sh
bun touchdesigner/scripts/render-live-poster.mjs \
  --out=/private/tmp/portrait-motion.png --width=1200 --motion-preview
```

The command writes representative poses, the final frame and a return to the first
pose, plus a labelled contact sheet. Inspect the face, hand and shirt at their displayed
size while the source changes. Returning to the first pose must restore the same print.
Use `--frame=19` to inspect one decoded video frame; frame numbers are one-based. All motion
diagnostics require an explicit `--out` so they cannot accidentally replace the SSR poster.

Check atomic frame loading and consistent print allocation with:

```sh
bun test tests/portrait-frame-pair.test.ts tests/portrait-render-size.test.ts
```

The tests cover complete frame pairs, stale requests, cache ownership, and matching carrier
dimensions across enhancement tiers and display sizes. Review intermediate rendered poses
after changing the correspondence or print shader.

`render-reference-glyph-portrait.mjs` below remains the renderer for the original approved
look.

The runtime assets in `images/source/about-motion/packed/` are produced with:

```sh
ffmpeg -i touchdesigner/input/braden-gelato-clean-loop-v2.mp4 \
  -i touchdesigner/input/braden-gelato-clean-matte-loop-v2.mp4 \
  -filter_complex "[0:v][1:v]hstack=inputs=2" \
  -c:v libx264 -preset veryslow -crf 22 -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -bf 0 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart -an images/source/about-motion/packed/portrait-packed.mp4
```

Extract the packed still from the resulting MP4 with `extract-packed-still.mjs` as described
above. `glyph-atlas.webp` is the greyscale reference atlas recompressed as lossless WebP
— lossless is mandatory because the carrier thresholds slice that coverage field and lossy
ringing moves mark edges. `prop-support.png` ships unchanged.

## Offline reference-glyph fallback

`scripts/render-reference-glyph-portrait.mjs` reproduces the approved reference-glyph
carrier without opening TouchDesigner. It is deterministic and uses only the committed clean
source, registered matte, prop support and 936-cell reference atlas. Glyph identity remains
stage-locked; source tone changes threshold, opacity and umber depth only.

Render the representative frame seven while retaining the true-size intermediate for review:

```sh
bun touchdesigner/scripts/render-reference-glyph-portrait.mjs \
  --out-dir /private/tmp/braden-reference-glyph-frame-7 \
  --frame-indices 7 \
  --keep-master
```

Render the complete loop with:

```sh
bun touchdesigner/scripts/render-reference-glyph-portrait.mjs \
  --out-dir /private/tmp/braden-reference-glyph-sequence \
  --frame-indices all
```

Frame indices are one-based and also accept comma-separated values or ranges such as
`1,7,25,43` or `1-12`. Each frame is built at 2400×1600 and receives exactly one Lanczos3
downsample to its 1200×800 straight-alpha PNG. Outputs live under `frames/`; `--keep-master`
also writes the 2400×1600 PNGs under `masters-2400x1600/`. `render-manifest.json` records input
hashes, carrier parameters and per-frame timings. The script requires `ffmpeg` for deterministic
frame extraction.

This fallback intentionally renders the portrait carrier only. The sparse exterior debris stays
in the TouchDesigner authoring network. Keeping that concern separate makes the offline renderer
a precise carrier reference instead of a second, subtly divergent implementation of the entire
atmosphere.

## Automated rebuild and still render

The automation runners open a separate TouchDesigner process from the committed minimal
`automation/bootstrap.toe`. They rebuild from `build-project.py`, wait until the source,
matte and glyph atlas have uploaded decoded frames, write JSON status, and quit. They never
overwrite `about-portrait.toe` or a website asset.

```sh
touchdesigner/automation/run.sh
```

That command saves a still and disposable project copy. To render all 48 registered master
frames instead:

```sh
touchdesigner/automation/render-sequence.sh
```

After a successful sequence render, the PNG masters feed the packed colour|matte encode in
"Live-runtime poster" above — the web-alpha encode and validation helpers that used to
follow here shipped the retired alpha-video delivery pipeline and have been removed.

This is suitable for a locked screen because it does not use Accessibility, Textport
keystrokes, or window automation. TouchDesigner still creates a normal GPU-backed process;
it is not a documented headless mode. `TOUCH_ALWAYS_START=1` is essential when another
TouchDesigner project is already open because it forces a separate process.

Outputs:

- `/private/tmp/braden-touchdesigner-run/preview.png`
- `/private/tmp/braden-touchdesigner-run/about-portrait.generated.toe`
- `/private/tmp/braden-touchdesigner-run/status.json`
- `/private/tmp/braden-touchdesigner-run/touchdesigner.log`

Sequence outputs are written to `/private/tmp/braden-touchdesigner-sequence/frames` with
status in `/private/tmp/braden-touchdesigner-sequence/sequence-status.json`.

Set `CODEX_TD_RUN_DIR` to use a different disposable output directory, or
`CODEX_TD_TIMEOUT_SECONDS` to change the shell-side inactivity timeout. A sequence render
reports every completed frame, so an unusually slow PNG write does not look like a hung process.
If macOS suspends a background worker after the status reports `frame_completed: N`, resume the
same directory with `CODEX_TD_START_FRAME=N`. The runner validates the contiguous completed
prefix and removes any partial frame after it before starting a fresh isolated worker.
The committed `.toe` contains
only a root-level Execute DAT that dispatches to the callback selected by the runner. It sits
outside `/project1`, so rebuilding that generated network cannot delete the active callback.
The full network is always built with TouchDesigner's Python API rather than hand-editing its
expanded representation.
