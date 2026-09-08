# Dog motion measurements

<!-- cspell:ignore venv numpy bunx -->

`build-dog-motion.py` measures how features move between the existing painted dog drawings. It
reads the three exported WebP atlases and produces numeric mesh offsets. It does not generate,
retouch, or replace the artwork.

The runtime can move one drawing's eyes, muzzle, ears, and outline toward its neighbouring
drawings without layering two faces. This reduces positional jumps when it changes textures.
The independently painted fur and partially hidden features still differ between source drawings;
the measured geometry cannot make those textures identical.

## Rebuild

Use Python 3.11 or newer in an isolated environment, with the project's Bun toolchain available.
These dependencies are only required when rebuilding the measurements; the site has no Python
dependency. Bun reads the compositor's head ownership mask directly from `rig-dog.mjs`, so the
numeric measurements and artwork use exactly the same chest and jaw boundaries.

```sh
python3 -m venv /tmp/braden-dog-motion
/tmp/braden-dog-motion/bin/python -m pip install opencv-python-headless==5.0.0.93 numpy==2.3.5
/tmp/braden-dog-motion/bin/python images/source/signature/build-dog-motion.py
bunx prettier --write public/about/signature/dog-motion.json
```

Run this after exporting the artwork with `export-dog.mjs`. The metadata records the input
hashes, ownership source hash, dependency versions, and output hash so stale measurements can be
detected. Rebuild after changing the ownership mask as well as after exporting new artwork.

## Output format

`public/about/signature/dog-motion.png` is a lossless data container, not a visible illustration.
Its red, green, and blue channels contain successive payload bytes. Alpha is fully opaque;
the file has no colour profile. This allows a normal same-origin image decode under the site's
existing content security policy. Read RGB channels in row order, skip alpha, and discard trailing
zero padding after the payload length in `dog-motion.json`.

The decoded payload contains 697,984 bytes of signed little-endian 16-bit integers. Divide each
integer by 16 to obtain a displacement in source pixels. Every flow uses the same 304 mesh points:
16 columns at x = 0, 10, …, 150 and 19 rows at y = 0, 10, …, 180. Points use row order and each
point stores x displacement followed by y displacement.

| Block | Byte offset | Byte length | Dimensions, outermost first                              |
| ----- | ----------- | ----------- | -------------------------------------------------------- |
| Gaze  | 0           | 680,960     | 2 poses × 35 frames × 8 directions × 304 points × 2 axes |
| Body  | 680,960     | 17,024      | 7 frames × 2 directions × 304 points × 2 axes            |

Gaze poses are seated, then lying. Frame index is `row * 7 + column`. Directions are changes in
column and row, in this order:

```text
(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)
```

Directions outside the atlas are zero. Body frames are seated column 1 / row 2, the five
transition drawings in their middle row, then lying column 1 / row 2. Body directions are previous
frame, then next frame; the unavailable endpoint directions are zero.

## Interpolation and safety

The selected texture can remain within 0.62 of its integer frame coordinate. For horizontal and
vertical distances `u` and `v`, combine the selected texture's outgoing measurements with weights
`u * (1 - v)` toward the horizontal neighbour, `v * (1 - u)` toward the vertical neighbour, and
`u * v` toward the diagonal neighbour. The body sequence uses a single adjacent measurement.

The optical flow uses DIS medium, its finest scale, 50 gradient iterations, 10 refinement
iterations, and Gaussian smoothing with a 1.8 pixel standard deviation. Displacements are bounded
to 28 pixels for gaze and 42 pixels for body movement. Gaze movement follows the compositor's
head ownership mask in both source and target drawings. This mask protects the canonical chest
and its white fur while allowing a downward-facing chin to overlap it. The generator samples the
whole 10 pixel neighbourhood affected by each mesh vertex and uses its minimum ownership. A
vertex touching any fixed torso pixel is pinned, including vertices just above or beside it, so
an adjacent triangle cannot pull that pixel sideways. Body movement remains independent of the
gaze mask and fades to zero at the shared y = 170 baseline.

Optical flow can mistake disappearing fur or an ear edge for a feature that shrinks substantially.
Preventing triangle inversions alone allowed a neck region to compress to 35% of its original
width. The generator now finds the closest displacement fields whose local deformation norm is
at most 0.33. It adjusts excessive local gradients while preserving translations, rather than
reducing the complete head's movement. Fixed body points and unavailable directions remain zero.
Pins that apply to only one destination angle are exact equalities inside each solve update;
the shared spatial basis must not move them just because another angle owns that jaw region.
Enforcing them during the solve avoids creating a new sharp gradient by zeroing them afterwards.
The small constrained solve uses NumPy and leaves the browser implementation unchanged.

The constraints include horizontal, vertical, and diagonal combinations through `u, v = 0.62`.
The gradient is bilinear in these coordinates, and its norm is convex, so bounding the corners
bounds every intervening angle. After quantization the maximum deformation norm must stay below
0.35. This limits each triangle's local linear size to 65–135% of its original size in every
direction, including shear, and also prevents inversion. Regression tests check those bounds
across both resting poses and the body sequence, alongside the fixed body points. Additional
tests inspect the cells containing canonical torso pixels and require every corner to stay
fixed for all source and destination gaze angles.

The metadata records local correction amounts, the minimum signed triangle area, and any
remaining quantization guard scaling. These geometric constraints reduce distorted intermediate
faces; they cannot correct anatomy already present in an exact source drawing or recover fur
hidden from that drawing's viewpoint.
