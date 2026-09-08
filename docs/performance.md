<!-- cspell:ignore bunx overscroll -->

# Rendering and performance

The site remains a static Astro build. `/` renders the letter; `/bookshelf` renders the bookshelf.
The menu fetches and caches the destination document on pointer or keyboard intent, loads its
styles, mounts its known feature modules, and then transitions between the rooms. Failed fetches
fall back to ordinary navigation. Both routes also work without JavaScript.

## Atlas update — 8 September 2026

Desktop now opens with every book fitted to the viewport, with wheel zoom and two-axis panning.
Mobile uses a server-rendered grid and does not download Three.js. See
[Book Atlas](book-atlas.md) for rendering, shared texture sheets, fallback behaviour and current
review evidence. Exact audit results are retained in `artifacts/performance/budgets.json`.
The 7 September measurements below describe the preceding bookshelf.

## Measured results — 7 September 2026

The final local production run passed every configured budget. These figures use Lighthouse
13.4.1 and Chrome 152.0.7977.77 on macOS, with the compression, headers, and profiles described
below. Mobile values are medians of three runs; desktop values are single runs. The baseline is
the original audit recorded before this implementation.

| Route and profile  | Baseline FCP | Final FCP | Baseline LCP | Final LCP | Final initial transfer |
| ------------------ | ------------ | --------- | ------------ | --------- | ---------------------- |
| Home, mobile       | 3.3 s        | 1.21 s    | 5.6 s        | 2.48 s    | 302.2 KiB              |
| Bookshelf, mobile  | 3.1 s        | 1.43 s    | 5.8 s        | 2.40 s    | 457.8 KiB              |
| Home, desktop      | 0.7 s        | 0.31 s    | 1.7 s        | 0.60 s    | 335.3 KiB              |
| Bookshelf, desktop | 0.6 s        | 0.38 s    | 1.3 s        | 0.48 s    | 298.4 KiB              |

| Route     | HTML gzip | Initial JavaScript gzip |
| --------- | --------- | ----------------------- |
| Home      | 36.9 KiB  | 18.8 KiB                |
| Bookshelf | 33.3 KiB  | 18.5 KiB                |

HTML was approximately 362.6 KiB gzip per route before room isolation. Initial blocking time and
CLS were both zero in all eight final Lighthouse runs. The browser suite also verifies that
inactive rooms and motion assets wait for their loading triggers. The homepage LCP result is
close to its 2.5-second ceiling; passing this local run does not guarantee the same result on a
different CI machine or production network.

The separate portrait enhancement sample took 118 ms from keyboard intent to canvas readiness
with no observed long tasks. It used a fresh Chrome process and context on the local machine;
operating-system and GPU driver caches were uncontrolled. This is an interaction sample, not an
initial-render metric or a portable cold-GPU guarantee. The complete print stayed visible until
the canvas was ready.

Validation passed: `bun run check` (179 unit tests and all repository checks), `bun run build`,
45 browser tests, and the eight-run performance budget check. Evidence is in
`artifacts/performance/budgets.json`, the individual Lighthouse reports, and the browser report.
The generated reports are intentionally ignored by Git and uploaded by CI.

## Delivery

- Text paints immediately with metric-adjusted fallback fonts. The signature draws its original
  ink through ordered SVG mask paths, with responsive lossless layers embedded in one image
  request. Reduced motion and print use the complete composite; the reveal needs no JavaScript.
- The portrait uses responsive AVIF with WebP fallback. Its preload and image share the same
  sizing expression. The current assets use AVIF quality 60 and WebP quality 90 for fine
  lettering; the earlier measurements above used quality 50 and 82. Visible paint loads with
  the artwork; pigment data and GPU resources wait for interaction.
- Desktop books share a pre-rendered image sheet, with Three.js and one shared cover sheet loading
  after first paint for the active room. Zooming loads larger 256/512/768px candidates near the
  viewport; inspection originals are capped at 1536px without upscaling. Mobile uses ordinary
  cover images in a grid, with the first six eager and the remainder lazy loaded.
- Generated textures, fonts, and signature assets carry content hashes and immutable caching.
  Existing geometry, the small portrait occlusion mask, and the tiny paper grain remain in the
  server-rendered page. The letter's tiny underlines also stay inline to avoid nine separate
  requests. Hidden career decoration and overscroll artwork load when used.
- Scrub masks load and decode on navigation intent. The current room stays readable until the
  destination and its transition assets are ready; static and light modes never request the masks.
- One shared startup module coordinates the menu, rooms, and scrolling. Shared layout styles up to
  32 KiB and other shell styles up to 6 KiB stay inline; route presentation styles use Astro's
  automatic stylesheet policy.
- Initial feature setup follows the first paint. Search retains input entered before its module
  finishes loading. Cached rooms retain their controllers, with activity scoped to the visible
  room and tab.

## Enhancement policy

| Mode   | Selection                                                 | Behaviour                                                                                  |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Static | Reduced motion, Save-Data, or unavailable WebGL context   | Complete printed artwork; static dog poses                                                 |
| Light  | Coarse pointer, slow connection, or reported low capacity | Desktop 3D with reduced resolution; mobile grid; intent-triggered artwork, short room fade |
| Full   | Remaining devices                                         | Desktop 3D; mobile grid; intent-triggered artwork and the original scrub transition        |

Missing connection, memory, or processor information is treated as unknown. Vertical touch
scrolling does not start the portrait. Its printed image remains until the first canvas frame is
ready. Context loss restores that image and accessible image semantics. Shader compilation uses
parallel completion checks where available and yields between compilation stages otherwise.
Confirmed context failure switches the shared policy to static for the current document; it is
discovered during an intended effect, without a speculative first-paint WebGL probe. An artwork
download failure only disables that artwork.

## Reproduce the checks

```sh
bun ci
bunx playwright install chromium
bun run check
bun run build
bun run check:browser
bun run check:performance
```

On Linux, install browser system dependencies with `bunx playwright install --with-deps chromium`.
An existing Chrome binary can be selected with `CHROME_PATH`. Both browser commands start a local
server for `dist/`, applying the repository's response headers and gzip compression. Stop any
other server on port 4175 first. `bun run preview:performance` starts the same server manually.

The Lighthouse script runs three cold mobile samples and one cold desktop sample per route,
serially to avoid measurement contention. Mobile uses 412 × 823 at DPR 1.75, simulated 150 ms RTT,
1638.4 Kbps throughput, and 4× CPU slowdown. Desktop uses 1350 × 940 at DPR 1, 40 ms RTT,
10240 Kbps throughput, and no CPU slowdown. Reports record the browser version. These are local
lab measurements, not production field data or a simulation of Cloudflare's entire network.

The enforced limits are mobile median FCP ≤1.8 s, LCP ≤2.5 s, blocking time ≤200 ms, and CLS ≤0.02;
HTML ≤100 KiB gzip; homepage JavaScript ≤35 KiB gzip and transfer ≤500 KiB mobile or
≤600 KiB desktop. The bookshelf has explicit ceilings of 350 KiB gzip JavaScript and 1.5 MiB
initial transfer, including automatic 3D enhancement. The desktop run is checked against the same paint and stability ceilings.
Initial transfer includes the resources requested without interaction, including native lazy
loading's nearby covers. JavaScript size is the sum of gzip sizes of the requested script files.

`artifacts/performance/` contains the Lighthouse reports and budget summary.
`artifacts/browser/report/` contains the browser report, screenshots, and a separate JSON record
of cold portrait enhancement. The latter records intent-to-ready timing, long tasks, and browser
and GPU context without claiming a portable hardware budget. Its browser and resource caches are
fresh; operating-system and driver caches are uncontrolled.

The browser suite covers direct and cached routes, loading failures and CSS readiness, rapid reversals,
metadata, native link behaviour, pre-initialization search, stable ordering, no-JavaScript use,
blocked scripts and delayed fonts, breakpoints and DPR 1/2/3, reduced motion, Save-Data, unavailable
WebGL, context loss, hidden-tab resume, native touch scrolling, stable listener counts, and no
recurring animation work before intent.

CI builds one production artifact, runs browser behaviour and performance budgets against that
artifact, and retains output and evidence for 14 days. Cloudflare deployment uses the same artifact
after successful CI on the latest `master` commit. Manual redeployment runs CI again; see
[deployment](deployment.md) for the pipeline and recovery steps.

## Deployment verification

After deployment, verify both public routes with the deployed response headers, repeat navigation
and enhancement checks, and inspect cold and warm asset requests. An authenticated Cloudflare
deployment is needed to complete that verification. Local checks cannot establish production
p75 Core Web Vitals; the field targets remain LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1.
