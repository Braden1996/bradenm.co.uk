<!-- cspell:words checkerboard -->

# Dog sprites

Generated with the built-in ChatGPT image generation tool from the dog in
`images/source/signature.webp`. The original transition source is `dog-generated.png`.
The model returned an opaque background; the final prompt requests white so
the export script can remove the surrounding background and preserve the white chest.

Run `bun images/source/signature/export-dog.mjs` to align and export the atlases.
Each output cell is 150 × 180; all frames share a ground line. The transition
atlas, `public/about/signature/dog-sprites.webp`, has five columns and three rows.
Columns in its first and last rows are left, front, right, up, down. The middle
row contains five successive frames lowering from seated to lying. Reverse
them to sit up.

Cursor tracking uses two denser atlases, `dog-seated.webp` and `dog-lying.webp`,
with 35 head angles per pose: seven columns and five rows, each 1050 × 900 pixels.
The seated generation sources and prompts are described in `dog-seated-readme.md`;
the lying generation prompt is in `dog-lying-prompt.md`.

## Prompt 1

Use case: illustration-story.
Asset type: production animation sprite sheet for the small dog beside a handwritten website signature.
Image 1 is the character and painting-style reference. Generate a coherent sprite sheet of THIS SAME chocolate-brown Newfoundland puppy, white chest bib, floppy ears, broad muzzle, thick shaggy fur, natural anatomy, vintage detailed watercolor/gouache painting in muted warm tones. Omit the lettering in the reference completely.

Canvas: 2500 by 1500 pixels, EXACTLY 5 equally sized columns and 3 equally sized rows, 500 by 500 cells. No labels, borders, guides, text or grid lines. GENUINELY TRANSPARENT background with alpha, NOT a white or checkerboard background. Exactly ONE full dog per cell. Maintain identical dog size, proportions, lighting, fur pattern and camera across every cell; lock the hindquarters/paws to the same ground line at y=440 within every cell. Keep generous empty margins. Each dog fits completely in its own cell. The dog occupies about 310px width and 355px height when seated. Small subtle patch of watercolor moss/grass directly under paws, same footprint throughout.

TOP ROW, all upright seated bodies with identical torso and paws, only the head and neck turn:
column 1: head looking left, as in original reference.
column 2: head looking straight out toward viewer.
column 3: head looking right.
column 4: head tilted upward, looking above the viewer.
column 5: head tilted downward, looking below the viewer.

MIDDLE ROW, five progressive animation in-between frames of the SAME dog lowering itself from sitting to lying, head kept in the original left-facing direction:
column 1: seated, leans shoulders slightly forward.
column 2: forelegs reach forward, elbows begin to bend, chest lowers 20 percent.
column 3: elbows halfway bent, chest halfway toward ground, hindquarters settle.
column 4: elbows nearly on ground, chest lowered 80 percent, forepaws extended.
column 5: chest fully down on ground, belly resting, head still raised alert.

BOTTOM ROW, all fully lying with chest and belly on ground, forepaws extended, same identical low body and paw positions, head remains up and alert:
column 1: head looking left.
column 2: head looking toward viewer.
column 3: head looking right.
column 4: head tilted upward.
column 5: head tilted downward.

Constraints: same puppy in every cell; reference likeness crucial; believable sit-to-lie body articulation; no costume, no collar, no props, no duplicate paws, no detached heads. No signature letters. Make the first seated pose faithfully match the reference. True alpha background.

## Prompt 2

-

Use case: precise-object-edit. Image 1 is the edit target, a 5-column 3-row sprite sheet. Keep this identical dog, painted fur, same 15 poses and sheet layout. Make exactly TWO corrections:

1. Replace all checkerboard background pixels with a completely uniform PURE WHITE #FFFFFF background. No checkerboard pattern anywhere. Pure white empty background, no shadows outside the little grass patches.
2. In the THIRD column of BOTH the TOP row and BOTTOM row, turn ONLY the dog's HEAD to face toward the RIGHT-HAND EDGE of that cell. The dog's NOSE MUST POINT RIGHT, toward the next dog, as the mirror direction of the first column. The seated/lying BODY stays identical. This is essential: the first column's nose points LEFT; third column's nose must point RIGHT. The five gaze states are left, front, RIGHT, up, down.
   Preserve all other artwork, colors, proportions, and the lowering transition in row 2 unchanged. No text, no guides. Align each row's grass baseline within equal cells, no overlapping cells.

## Prompt 3

-

Use case: precise-object-edit. Image 1 is edit target. Keep entire image EXACTLY unchanged except the head of ONE dog: SECOND ROW, THIRD COLUMN (the dog at the very center of the 5 by 3 sheet, crouching halfway down). In this single center cell, turn its head to look LEFT, nose pointing left toward column 2. Keep same crouching body. ALL other 14 dogs unchanged. Especially top row third and bottom row third keep looking RIGHT. Keep plain white background. No other edits.
