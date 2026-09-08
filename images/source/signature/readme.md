# Animated signature assets

The signature separates the original Braden Marshall handwriting, coastal landscape, and
interactive Newfoundland dog. New painted assets were created with the built-in ChatGPT image
generation tool; the original handwriting remains intact.

## Website files

All files below are in `public/about/signature/` and include an alpha channel.

| File               | Dimensions | Contents                                         |
| ------------------ | ---------- | ------------------------------------------------ |
| `lettering.webp`   | 1000 × 334 | Original handwriting and underline               |
| `landscape.webp`   | 1000 × 334 | Coastal landscape on the shared signature canvas |
| `dog-seated.webp`  | 1050 × 900 | 35 seated head angles in a seven by five grid    |
| `dog-lying.webp`   | 1050 × 900 | 35 lying head angles in a seven by five grid     |
| `dog-sprites.webp` | 750 × 540  | Five lowering frames in the middle row           |

Dog atlas cells are 150 × 180 pixels and share a ground line. Head angle columns progress left
to right; rows progress from looking up to looking down. Lowering frames play in reverse to sit up.

Each resting pose uses one canonical body and ground patch across all 35 head drawings.
The white bib also comes from that canonical torso. A shaped head mask preserves the exposed
chest while allowing a lowered chin to overlap it; the motion-data build reads the same mask
to keep that fur still between drawings. Tests compare the chest pixels separately from the
lower-body anchors, including the exposed upper bib at side and upward angles.
`rig-dog.mjs` registers the generated artwork against that torso, then fits the collar to the
body's contour before feathering the neck into it. The back of the seated neck starts fitting just
below the eye line, preventing a second shoulder bulge behind a turned head. The forward contour
waits until below the jaw, with a lower boundary for downward-looking poses. This preserves the
nose's projection instead of squeezing the muzzle into the reference dog's neck.
Matching those contours avoids a cut shoulder
edge or a translucent strip of fur at the join. Paws, lower body, grass, and the lying
dog's back remain identical as the gaze changes. Lossless WebP export preserves those pixels.
`tests/signature-assets.test.ts` checks the decoded atlases for this stability, checks the neck
outline for abrupt steps, and verifies that all 35 head drawings remain distinct. A synthetic
projecting muzzle also guards against either side being pulled inward by collar registration.

## Interaction

The canvas displays one complete drawing at full opacity. A WebGL mesh moves its eyes, muzzle,
ears and outline continuously toward the neighbouring poses before the source drawing changes.
It never fades between head angles or body poses, which would double the eyes and muzzle. A
continuous angle controller turns at a maximum of 240 degrees per second, with eased arrival
and a small frame-selection margin that prevents flicker near angle boundaries. New pointer
positions redirect the current turn.

The measured geometry lives in `dog-motion.png`, a 95 KiB numeric data image loaded alongside
the atlases only on approach or interaction. It works under the existing image security policy.
Browsers without WebGL or motion data retain the sharp sprite animation. The static first-paint
drawing, reduced-motion behaviour and layout footprint are unchanged.

Gaze uses perspective angles from the seated or lying eye position. The head depth scales with the
displayed dog; the proximity radius only decides when the dog notices the pointer. Clicking first
turns the head toward the direction used by the body animation, then plays the five lowering
drawings over 650ms. Clicking again reverses the movement. Cursor tracking resumes smoothly at
the resting endpoint.

The generated drawings approximate their requested angles; they are not calibrated views of one
three-dimensional model. Geometry interpolation reduces positional steps, but separately painted
fur and hidden features can still change between drawings. A rigged model would be needed for
fully consistent surfaces and geometrically precise orientation.

## Sources and prompts

- [Lettering and landscape](lettering-readme.md): original ink extraction, stroke geometry, and
  the landscape generation prompt. Source image: `landscape-generated.png`.
- [Seated dog](dog-seated-readme.md): five selected strips in `dog-seated-rows/`; exact prompts
  are in that directory's `prompts.txt`.
- [Lying dog](dog-lying-prompt.md): generation prompt for `dog-lying-generated.png`.
- [Dog transitions](dog-prompts.md): generation prompts for the preserved `dog-generated.png`.
- [Motion measurements](dog-motion-readme.md): numeric correspondence generation, rebuild
  instructions and binary layout. The build checks that measurements match the artwork hashes.

The pen paths are in `src/features/about/lib/signature-strokes.ts`, using the same 1000 × 334
coordinates as the handwriting layer.

## Export

Run these commands from the repository root:

```sh
bun images/source/signature/export-layers.mjs
bun images/source/signature/export-dog.mjs
```

The scripts use Sharp to extract, align, and optimise the generated assets into their final
website files. They do not call image generation again. After changing dog artwork, rebuild the
[motion measurements](dog-motion-readme.md) before building the site.
