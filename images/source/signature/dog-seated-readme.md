# Seated dog head poses

The five selected strips in `dog-seated-rows/` provide 35 seated Newfoundland drawings for
`public/about/signature/dog-seated.webp`. The website atlas is 1050 × 900 pixels, arranged as
seven columns and five rows of 150 × 180 pixel cells.

The strips were generated with the built-in ChatGPT image generation tool. Crops of the original
`dog-generated.png` transition sheet supplied the character and painting references: the same
chocolate brown dog, white chest, upright sitting body, and small grass patch. The exact prompts
are recorded in `dog-seated-rows/prompts.txt`.

Each strip contains seven gradual head turns, from looking left through front to looking right.
The intended yaw angles are −75, −50, −25, 0, 25, 50, and 75 degrees. Rows add vertical head tilt:

| Source strip  | Head tilt       | Source size |
| ------------- | --------------- | ----------- |
| `up-30.png`   | Up 30 degrees   | 2172 × 724  |
| `up-15.png`   | Up 15 degrees   | 2172 × 724  |
| `level.png`   | Level           | 2172 × 724  |
| `down-15.png` | Down 15 degrees | 1774 × 887  |
| `down-30.png` | Down 30 degrees | 2172 × 724  |

Run `bun images/source/signature/export-dog.mjs` from the repository to export the atlas. The
script crops the measured source gutters, removes the connected white background while retaining
the white chest, and aligns each drawing to a shared ground line. It also exports the lying atlas
and the original transition frames.
