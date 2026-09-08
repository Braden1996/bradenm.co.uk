<!-- cspell:ignore dialog Skyrim -->

# Popover Kit

Small Astro components share the site's paper, painted dividers, typography and action placement.
They provide content structure; the feature controller owns the native dialog or popover, focus,
Escape, dismissal and lifecycle. About's existing card remains its single server-rendered copy.

```astro
---
import PopoverKit from "../src/components/popover-kit/popover-kit.astro";
import PopoverHeader from "../src/components/popover-kit/popover-header.astro";
import PopoverBody from "../src/components/popover-kit/popover-body.astro";
import PopoverFooter from "../src/components/popover-kit/popover-footer.astro";
---

<PopoverKit surface="paper" aria-labelledby="note-title">
  <PopoverHeader>
    <h2 id="note-title">An annotation</h2>
  </PopoverHeader>
  <PopoverBody><p>The contents of the note.</p></PopoverBody>
  <PopoverFooter action={{ href: "/bookshelf", label: "Bookshelf" }}>
    <button slot="end" type="button">Done</button>
  </PopoverFooter>
</PopoverKit>
```

- The root accepts `surface="paper" | "bare" | "notebook"`, `as="section" | "div"`, classes, styles
  and standard section attributes. `paper` supplies the textured surface. `bare` leaves the
  surface to its feature. `notebook` adds a torn SVG silhouette, punched margin, faded ruling,
  a margin line and a soft shadow. It uses the existing paper grain and needs no image service.
- Header and footer accept `divider={false}`. Their dividers use a shared, content-hashed WebP
  baked from the site's pigment and brush functions. Ordinary builds need neither GPU nor network.
- The body is a content slot. Its feature can constrain scrolling independently of header and footer.
- Footer's `action` takes `href`, `label`, optional `ariaLabel` and `newTab`. A new-tab action adds
  the external-link icon and `noopener noreferrer`. Its normal slot follows the leading link;
  its `end` slot sits at the opposite end. Custom links can use `PopoverAction` directly.
- `--popover-inset` controls shared padding. `--popover-divider-display: none` suppresses painted
  rules in About's bare desktop margin annotations; modal company notes retain both rules.
- `enterPopover(surface, spacious)` supplies the entrance animation, with reduced-motion and
  forced-colour opt-outs. The caller owns its returned Animation and cancels it during retargeting.

Book inspection borrows the object-above-caption composition from the supplied Skyrim reference.
The book's physical center is at the viewport center, with the notebook note directly beneath it.
The note stays upright, with
Recoleta for the title, Newsreader for author and prose, and a compact Source Sans metadata row.
All text follows one left margin. Its size follows the reader's root text setting and is never
scaled by the 3D camera. The note settles into place after pickup begins; reduced motion skips
the entrance. Short screens scroll inside the inspection dialog while its close button stays fixed.
Opening always resets that internal scroll position.

`--notebook-line` supplies the shared rhythm for the ruling, section spacing, text and dividers.
Font cap and alphabetic metrics place text baselines on the rules; wrapped lines add whole ruled
lines. Browsers without text-box trimming retain the same line height and readable spacing.
The punched margin and vertical rule derive from the same paper inset.

On closing, a temporary inert copy folds into a ball and fades over 720ms. Its triangular faces
share moving vertices, so the actual printed note folds as a connected sheet. Facet shading follows
the upper-left light. Copies have no IDs and are hidden from accessibility APIs; the original
semantic note remains intact. The effect allocates no WebGL renderer or textures, and its animation
frame and copies are removed on completion, policy changes, hidden tabs, resize or room changes.
Reduced motion uses immediate dismissal.

## Book information

`data/bookshelf-details.json` contains optional, reviewed records matched by both title and author.
The static `/bookshelf/details.json` endpoint is requested only on first inspection. Failed requests,
missing records and invalid JSON keep the available title, author and owned formats. A late response
cannot replace the information for a different selected book.

Three initial records contain original short summaries and categories, with publisher URLs retained
as sources: _12 Rules for Life_, _How to Win Friends and Influence People_, and _Foundation_.
The first two also have verified original publication years. Additional records can supply
`publisher`, `released` and `pages` once the displayed edition is verified. Do not take a publisher's
current reprint date as the work's original publication date or assume its page count matches an
owned copy. Missing information is omitted, with no placeholder labels or guessed descriptions.

The browser checks in `browser-tests/popover-kit.browser.ts` exercise painted company notes,
keyboard focus, actions, backdrop dismissal, desktop/mobile rotation, repeated inspection, short
windows and delayed/failed metadata. Captures are written to `artifacts/atlas/`.

## Notebook inspection verification — 8 September 2026

`bun run check` passes, including 210 unit tests, and `bun run build` passes. The complete browser
suite passes all 113 scenarios, including nine Popover Kit checks. This includes a 320px
phone with a long title, doubled root text, short windows, keyboard rotation, dismissal,
repeated inspection, and delayed or failed metadata. The tests also verify centered books,
text and brush baselines, the closing fold, cleanup and reduced-motion dismissal, and catch page
errors when selecting a book before the renderer finishes preparing its shaders.

Desktop, phone, long-title, enlarged-text and short-window captures are saved as
`artifacts/atlas/notebook-*.png`. Check, build and browser logs use the same `notebook-` prefix.
The connected fold and ball stages are captured as `notebook-crumple-mid.png` and
`notebook-crumple-ball.png`. Closing took about 735ms with a 16.7ms 95th-percentile frame interval
on both the desktop and 4× CPU-throttled mobile profiles in Chrome 153 / ANGLE Metal / Apple M5.
Both runs left zero temporary copies. These browser-emulated samples and their script are
`artifacts/atlas/note-crumple-performance.json` and `artifacts/atlas/measure-note-crumple.mjs`.

On Chrome 153 with ANGLE Metal / Apple M5, inspection measured 60.3 fps on desktop and 60.0 fps
with mobile CPU throttled 4×. Both stopped rendering when idle. Desktop pickup reused its loaded
renderer (68ms to inspection readiness); mobile's on-demand renderer took 4.13s at 150ms latency
and 1638.4 Kbps. These are desktop-hosted browser emulations, not physical-phone measurements.
The reproducible measurement and samples are `artifacts/atlas/measure-inspection.mjs` and
`artifacts/atlas/inspection-performance.json`. Desktop table readiness measured 1.29s, with
60.1 fps while moving and no idle frames (`artifacts/atlas/desktop-performance.json`).

The preceding Lighthouse run remains in `artifacts/performance/budgets.json`: bookshelf budgets
passed, with zero layout shift on both profiles. That run also records the existing homepage
mobile LCP exception (2.554s against its 2.5s ceiling). Lighthouse was not rerun for this notebook
styling change, and the budgets were not changed.
