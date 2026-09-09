# Bookshelf metadata

`bun run build` starts with a small catalogue sync, then builds the static Astro
site. Previously checked titles use the committed cache, so an unchanged build
makes no external metadata requests. Adding a title to `data/bookshelf.json`
automatically queues a lookup on the next build.

```sh
bun run bookshelf:metadata           # Look up titles not yet checked
bun run bookshelf:metadata --retry   # Retry failed or unmatched titles
bun run bookshelf:metadata --refresh # Revisit the whole catalogue
bun run bookshelf:metadata --offline # Regenerate output using saved data only
bun run check:metadata               # Check generated output without network access
bun run build:offline                # Entire site build using saved metadata
```

`BOOKSHELF_METADATA_OFFLINE=1` also disables requests. The build step allows at
most 24 requests and about 45 seconds of lookup time, with an eight-second
timeout per request and a circuit breaker after three consecutive failures.
The explicit sync command processes the whole queue. Both use two workers and
a shared request gate below three requests per second, with an identifying
User-Agent as requested by [Open Library](https://openlibrary.org/developers/api).
No API keys or backend are required.

## Matching and provenance

Search results must match the title and all named authors. Recorded cover
matches help resolve subtitles and duplicate catalogue records. Where an
Open Library cover identifies a specific edition, that edition can supply its
publisher, publication date and page count. A matching work alone supplies no
edition-specific fields. The note calls the edition date “Cover edition”: it
does not claim that a pictured edition is the precise audiobook or physical
copy owned. First publication is a separate work-level field.

Descriptions are short catalogue excerpts, capped at 24 words;
their source attribution stays in the metadata rather than a link on the note. HTML, links and obvious catalogue-maintenance
text are stripped. Categories are a small set of readable labels derived from
the catalogue's subjects. Missing or uncertain fields remain absent.

- `data/bookshelf-metadata-cache.json` saves matches, source work/edition IDs,
  timestamps, failure reasons, source subjects and fetched details.
- `data/bookshelf-details.json` contains hand-curated overrides. Its fields win
  over fetched values, and curated descriptions replace excerpt attribution.
  An empty string suppresses a known incorrect field. For example, the catalogue
  year for _Meditations_ refers to a later edition, so it is not shown as the
  work's first publication date.
- `data/bookshelf-metadata.json` is the merged, generated public payload.
- `data/bookshelf-metadata-report.json` records coverage and missing fields for
  every incomplete title.

Failed refreshes retain previously successful details. Unmatched and failed
lookups are saved too, avoiding repeated requests on every deployment; use
`--retry` to revisit them. Commit the cache, output and report together. Ordinary
builds never fetch descriptions in a visitor's browser: the inspector loads the
small static `/bookshelf/details.json` payload only when a book is opened.
The shared request fills the current inspection when it arrives; title and cover appear immediately.
It has no short wall-clock deadline, because graphics work can delay JavaScript processing even
after the response reaches the browser. Late responses cannot replace a different selected book.

## Note design

The inspector centers a full book above torn dot-grid paper at every width. Recoleta sets
the title, Newsreader the summary, and self-hosted Caveat the author and coloured
category buttons. Their broad highlighter marks use the site's painted-stroke generator.
The title and author are centered above the categories; the description and labelled
publication facts follow below. Only audiobook ownership gets a small label beside
the title. Text baselines and separators share the paper's dot spacing. Existing
slide-in, crumple-on-close and reduced-motion behaviour remain in place.

Hover and keyboard-focus labels use a compact version of the same paper, with the
title above a single wrapping byline: author, first-publication year and page count
when known. This small metadata index is server-rendered with the bookshelf, so
hovering needs no catalogue request. A
shared ink-arrow component also supplies the About page's company connectors.
The label chooses a clear side of the book and stays inside the viewport; the
arrow draws toward its book, with immediate display under reduced motion.

Selecting a category closes the book and leaves its matching titles in colour;
other books stay in place as muted printed covers and remain inspectable. The
category label sits to the left of search, with a control to clear it. Text search keeps its relevance
ordering and combines with the category, while clearing the category retains the
search query. The live renderer hides muted volumes so the printed and live layers
agree; returning from inspection and zooming preserve the filter.

Font provenance and redistribution terms are in
[`fonts/licenses/readme.md`](../fonts/licenses/readme.md).
