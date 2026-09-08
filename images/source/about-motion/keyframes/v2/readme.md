<!-- cspell:words venv -->

# Gelato portrait motion v2

This directory preserves the authored source material and the exact 48-frame RGB sequence used
to build the homepage portrait loop.

## Contents

- `raw/` contains the selected, untouched ImageGen outputs.
- `canonical/` contains the accepted, composition-locked motion anchors.
- `sequence/` contains the final 48 registered 1200 × 800 RGB frames.
- `matte-sequence/` contains their 48 aligned foreground mattes.
- `props/chocolate-cavity.png` is the transparent final-space cavity patch.
- `review/` contains contact sheets for the raw sources, canonical anchors, complete motion, and
  spoon/tub continuity.
- `generation-manifest.json` records ImageGen IDs, prompt summaries, and source hashes.
- `canonical-manifest.json` records every accepted anchor and its source/output hash.
- `base-motion-manifest.json` records the pinned RIFE build before the prop correction.
- `sequence-manifest.json` records the clean-motion provenance, final cavity schedule, and hashes.

The current exact motion is also installed as compact all-I-frame source and matte videos in
`touchdesigner/input/`.

## Gelato continuity

The chocolate mound changes from a shallow disturbed surface to a clearly depleted scoop. The
cavity develops as the loaded spoon leaves the tub, stays visible while the spoon is away, and
softens beneath the returning hand and spoon before the loop seam. The opacity is identical on
frames 48 and 1, so there is no full-to-empty reset pop.

The depleted state came from ImageGen output
`exec-03ae4913-eb85-4e59-9592-6a5929e91cfb`. The prompt requested one clearly scraped,
teaspoon-sized cavity in the chocolate immediately beneath the loaded spoon, with every other
object held fixed. Only a 135 × 95-pixel feathered cavity region in the final 1200 × 800 frame is
used; the generated image is never used whole. The patch is applied after the independently
approved motion has been built, leaving every pixel outside that region unchanged.

## Rebuild

From the repository root:

```sh
bun touchdesigner/scripts/compose-motion-v2-keyframes.mjs

/private/tmp/rife-mlx/.venv/bin/python \
  touchdesigner/scripts/make-clean-motion-v2.py \
  --output-dir /private/tmp/braden-clean-motion-v2

bun touchdesigner/scripts/apply-gelato-continuity.mjs \
  --base-frame-dir /private/tmp/braden-clean-motion-v2/source-frames \
  --base-video /private/tmp/braden-clean-motion-v2/braden-gelato-clean-loop-v2.mp4 \
  --base-matte-video /private/tmp/braden-clean-motion-v2/braden-gelato-clean-matte-loop-v2.mp4 \
  --output-dir /private/tmp/braden-clean-motion-v2-continuity
```

The continuity pass is intentionally last. It composites only the small authored cavity into the
clean RGB sequence; it never re-synthesizes or masks the moving body.
