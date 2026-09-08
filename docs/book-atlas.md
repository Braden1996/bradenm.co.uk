<!-- cspell:ignore clearcoat shadowmap PMREM dialog overscroll bunx SwiftShader llvmpipe softpipe -->

# Book Atlas

The desktop bookshelf opens with all 165 books scattered across the available viewport. Mobile
screens at or below 760px use a vertical grid of upright covers with title and author labels.
Both views retain the site's paper, typography, search and native navigation.

## Using the bookshelf

On desktop, scroll the mouse wheel to zoom around the pointer and drag to move the flat table
in either direction. Zoom and pan stay bounded by the collection.
The desktop page itself stays fixed: it has no vertical scroll or decorative overscroll tail.
The table begins just below the header, with its last books close to the bottom wash. Mobile
retains ordinary vertical scrolling for its grid.
There is no separate row of zoom controls; `-`, `0`
(fit all) and `+` remain available while the table has focus. Horizontal trackpad
movement and Shift-wheel move sideways. Browser zoom remains native. There is no drag bar,
miniature map or separate overview mode.

The printed atlas is the stable first frame. The renderer prepares in the background, but its
canvas stays hidden until pointer movement, zooming, dragging, keyboard navigation, selection or
search. A stationary pointer left over a book during refresh does not trigger hover or reveal.
The shared 8px table inset is present in Astro markup and used by both CSS and the camera.

Hover or focus a book to lift, enlarge and straighten it, with a tooltip showing title, author
and owned formats. Select it to bring a large book to the centre of the viewport. Its information
appears on a torn notebook note beneath the cover. Drag the book, or use
arrow keys with the book focused, to turn it fully around (vertical tilt is limited to 36 degrees).
Home returns to the initial orientation. Escape, the backdrop or the close icon returns it to the
table and restores focus and camera position. Short windows allow scrolling inside inspection to
keep the book and its text readable. The table itself remains fixed.
The book's physical center, including its thickness, meets the viewport center before any internal
scrolling. Closing folds the note into a small paper ball and fades it away; reduced motion skips
the effect.

Arrow keys move through the collection; Home and End reach its boundaries and bring the focused
book into view. Focusing search gathers the desktop books into straight rows over 480ms. Typing
orders matches by fuzzy-search relevance, left to right and then down, and fits them in view.
Up and Down move between rows. Retyping redirects the animation from each book's current pose.
Rows remain while a query is present; clearing restores every book, and leaving an empty search
returns to the original scatter. Reduced motion applies these changes immediately. Mobile keeps
its upright grid, animates reordered results and uses normal page scrolling; selecting a cover
loads a light 3D inspection on demand. The mobile grid itself still needs no 3D download.

## Rendering and ownership

- `atlas-layout.ts` defines deterministic visual profiles and a packing pass with continuous
  positions, rotated footprints and gaps. Title order follows the horizontal axis without
  imposing aligned rows. `atlas-camera.ts` fits one canonical spread into the desktop viewport,
  expanding spare space between books while preserving their proportions. SSR previews and
  the renderer use the same positions, zoom and pan coordinates.
- `atlas-transition.ts` interpolates placements, rotation and size by book ID. Printed previews,
  semantic buttons and the live scene share the same animation frame, including transitions
  from a zoomed camera. Inspection pauses the arrangement and resumes it after return.
- `atlas-scene.ts` owns paperback/hardback models, recessed pages, cover boards, binding joints,
  fine page and fibre textures and physical materials. Browsing models merge binding geometry
  into three draws per book; inspection temporarily adds bevelled detail. Authentic cover art
  uses sRGB and neutral tone mapping. Square audio art is fitted without distortion. Thickness,
  binding colour and material are approximations; back artwork is not invented.
- `atlas-lighting.ts` combines studio illumination, a daylight key and local contact shading.
  Directional shadows use 48 rotated samples with a world-scale penumbra. Full mode uses a 2048px shadowmap;
  light mode uses a filtered 1024px map and a
  512px contact target. There is no depth-of-field blur.
- `atlas-sheet.ts` defines a shared cover sheet and a shared transparent preview sheet. The
  initial desktop view needs two image requests instead of one per book. Each book retains its
  canonical sheet index through filtering. Zooming loads larger textures for nearby books,
  with bounded caches of 72 entries in full mode and 36 in light mode, plus the shared sheet.
  Off-screen models and evicted textures are disposed. Inspection masters and detailed models
  are released on return, including images that finish loading after dismissal.
- `atlas-renderer.ts` draws only during camera movement, hover, pickup, rotation and asset changes.
  `bookshelf.ts` owns search, input, the tooltip, dialog and lifecycle. One canvas performs pickup
  and return, retaining a frozen browsing frame underneath the modal. Async image callbacks
  cannot change a later inspection.

The desktop renderer loads after first paint when the room becomes active. The complete printed
spread remains visible until both the first complete 3D frame and an interaction. Details open immediately even if
3D is still loading. Hidden tabs and inactive rooms suspend drawing. Changing rooms resets the
camera. Resizing across the mobile breakpoint replaces the renderer and switches the browsing
layout. Mobile inspection uses one detailed model and releases its renderer on close.

The book and its caption have separate areas in a responsive column. The note stays readable
while the book rotates, with no 3D text projection or scaling. [Popover Kit](popover-kit.md) provides
the torn paper, punched margin, faint ruling, painted dividers and shared content structure
and optional sourced metadata. Title, author and owned formats remain available for every book;
the initial richer metadata records cover three books, with unknown fields omitted.
Text, ruled lines and painted dividers share a baseline rhythm that survives wrapping and enlarged
text. The short-lived paper-fold mesh shares its vertices and reuses inert copies of the actual
note. Its geometry and animation are released on completion or interruption.

Scene preparation holds its materials until asynchronous shader compilation finishes. Early
inspection, filtering and disposal wait for that boundary, so the compiler cannot poll a material
that has already been released. Details and the printed cover remain available while it prepares.

Static policy, Save-Data, reduced motion, unavailable WebGL and context loss retain printed
covers, search and immediate details. With JavaScript disabled, native popovers expose every
book's title, author and owned formats. The mobile grid is also fully server rendered.

## Assets

Normal Astro builds consume committed images and manifests without a GPU or network access.
The atlas stylesheet is imported by its Astro template, so Vite tracks CSS changes during
development and Astro emits the production stylesheet with the page. It is not read into a
long-lived server module or served through a separate generated CSS endpoint.

```sh
bun run bookshelf:covers:upgrade
bunx playwright install chromium
bun run bookshelf:atlas-assets
bun run check:atlas-assets
```

The atlas command renders transparent 640px previews using the same scene and lighting, then
builds content-hashed preview and cover sheets. It records provenance and dimensions in
`data/bookshelf-atlas.json`; the freshness check covers rendering and sheet-generation inputs.
`--limit 12` produces a representative proof without replacing the public manifest.

Cover candidates use 256/512/768px widths where originals permit; inspection masters are capped
at 1536px on the longest edge without upscaling. Recorded source URLs and edition matches remain
in `data/bookshelf-covers.json`. Only 24 sources reach 1000px on the longest edge; the remaining
141 are recorded in `data/bookshelf-cover-quality.json`. Median source height is still 500px,
so some close-ups remain limited by their original artwork.

## Verification

```sh
bun run check
bun run build
bun run check:browser
bun run check:performance
```

For an already running development server, run the bookshelf checks against that same server:

```sh
BROWSER_TEST_BASE_URL=http://localhost:4321 bun run check:browser browser-tests/atlas-search.browser.ts browser-tests/atlas-visual.browser.ts browser-tests/bookshelf-scroll.browser.ts
```

The visual checks assert a positive table height and styled icon controls before 3D loads, as
well as the absence of the old instruction text. This catches missing or stale atlas styles.

Browser coverage includes the fitted desktop view, anchored wheel zoom, dragging without pickup,
keyboard navigation, tooltips, filtering, native mobile swipes, pickup/return through resizing,
delayed and failed images, context loss, hidden-tab return and cached room changes. Existing
letter, header, paper-overscroll, no-script and navigation coverage remains in the suite.

Visual captures in `artifacts/atlas/` compare desktop previews and live rendering, hover, zoom,
inspection and mobile/short-landscape layouts. Semantic geometry must agree before and after
enhancement within one CSS pixel. The isolated preview bake and viewport-sized contact pass can
produce small shadow differences.

Performance samples record browser/GPU details, applied CPU/network throttling, readiness,
movement, idle frames and bounded resources. Mobile measures grid readiness and native scrolling;
it does not initialize a WebGL context. Desktop targets 2-second 3D readiness and 60 fps, with a
57 fps acceptance floor. Mobile retains 6-second readiness and a 29 fps acceptance floor against
its 30 fps target. Emulation uses the host computer, not a
physical phone, with fresh browser contexts and uncontrolled OS/driver caches.

The recorded renderer identifies software GPUs such as SwiftShader, llvmpipe and softpipe.
CPU-only CI records their measured readiness and frame rate, including whether each hardware
target was met, without enforcing hardware speed targets on a software rasterizer. The report
states the rendering mode and whether those numeric targets were enforced; an unmet target
remains recorded as unmet. All desktop runs must still become ready within 25 seconds and pass
the same idle, transfer, model, texture and geometry checks. Hardware and unidentified desktop
GPUs retain the 2-second and 57 fps assertions, including local runs and CI with a GPU. Mobile
speed assertions always apply. The renderer determines this distinction; the CI environment
variable does not.

The bookshelf retains ceilings of **350 KiB gzip JavaScript** and **1.5 MiB initial transfer**.
All paint, blocking-time, HTML, layout-shift and homepage budgets remain unchanged. Exact results
are recorded in `artifacts/atlas/*-performance.json` and `artifacts/performance/budgets.json`.

### Search interaction verification — 8 September 2026

The search update passes `bun run check` (210 unit tests) and the production build. All 101
browser tests passed; after the final search/zoom focus fix, the 30 bookshelf tests passed again.
All four search tests also passed against the development server. Coverage includes relevance
order, focus/blur, interrupted transitions, inspection during movement, clearing, empty results,
mobile and reduced motion. Captures are `artifacts/atlas/search-*.png`.

Three focus/blur transitions measured **60 fps**, with a worst frame interval of **16.8ms**, at
1350 × 940 in Chrome 153 on ANGLE Metal / Apple M5. The table stops rendering when settled.
`artifacts/atlas/search-performance.json` records the samples. A separate SwiftShader software
rendering run measured only 4–6 fps; the 60 fps target depends on hardware acceleration.

Both bookshelf profiles still pass all Lighthouse budgets. Desktop loads 162.5 KiB of compressed
JavaScript and 1103.3 KiB in total, with zero layout shift. The shared performance command reports
one existing failure: homepage mobile LCP at 2.553 seconds against its 2.5-second limit. Full
results are in `artifacts/performance/budgets.json` and `artifacts/atlas/search-lighthouse.log`.

## Earlier baseline — 8 September 2026

The full browser suite passed 91 tests. After the final inspection cleanup and hover-clearance
fix, all 28 bookshelf, visual and resource tests passed again. `bun run check` passed, including
207 unit tests, and the production build passed.

| Bookshelf profile | FCP    | LCP    | Blocking time | CLS | JavaScript gzip | Initial transfer |
| ----------------- | ------ | ------ | ------------- | --- | --------------- | ---------------- |
| Mobile            | 1.51 s | 2.03 s | 2.5 ms        | 0   | 24.5 KiB        | 446.1 KiB        |
| Desktop           | 0.37 s | 0.76 s | 70.0 ms       | 0   | 161.2 KiB       | 1103.1 KiB       |

Both bookshelf profiles pass every Lighthouse budget. The shared command still exits with the
homepage mobile LCP failure: **2.554 seconds** against its unchanged 2.5-second limit.

On Chrome 153.0.8010.12 with ANGLE Metal / Apple M5, the complete desktop table is
ready in **1.31 seconds** and measures **60.1 fps** while zooming. The throttled mobile grid
is ready in **1.82 seconds**, with **60.8 fps** during the native scrolling sample and no renderer
requests. Both record zero idle frames. After traversing the collection, the desktop uses
165 compact models, 498 uploaded geometries and a bounded cache of 72 textures plus its sheet.
These are local emulated profiles; the mobile result is not a physical-phone measurement.

### Static first frame and closer table spacing

The first-frame checks delay all JavaScript, capture the printed table, then compare that capture
pixel-for-pixel with the same table after the renderer has prepared. Both 1350×940 and 1100×600
viewports stay unchanged. Refreshing with a stationary pointer over a book also leaves the print
visible and the tooltip hidden; real pointer movement reveals the live scene and activates hover.
The header clearance and table inset are reserved in CSS and SSR, with no controls row.
Captures are `artifacts/atlas/static-first-1350.png` and `static-first-1100.png`; validation logs
use the `static-first-` prefix. Wheel zoom, dragging, search, inspection and the keyboard zoom
shortcuts remain available.

`bun run check` and `bun run build` pass. All 115 browser scenarios are verified: 114 passed in
the complete run, and the fixed-page scroll check passed after its pointer target was updated
for the removed controls row. The desktop renderer prepared in 1.33s and measured 60.0fps during
movement, with zero idle frames, on Chrome 153 / ANGLE Metal / Apple M5. Readiness now measures
background preparation; the printed frame remains visible until interaction.
