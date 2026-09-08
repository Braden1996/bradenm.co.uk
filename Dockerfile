# Stage 1: Subset fonts
FROM python:3.14.7-slim AS fonts
RUN python -m pip install --no-cache-dir --root-user-action=ignore --upgrade \
  pip==26.2.1 \
  fonttools==4.63.0 \
  brotli==1.2.0
WORKDIR /fonts
# Source Sans 3 ships as a single upright variable face, so one subset covers
# every body weight the site uses (400 through 700) with drawn rather than
# synthesised bolds. The whole 200-900 axis is kept: instancing it down to the
# used range rebuilds the CFF2 deltas and lands ~1KB larger, so trimming costs.
COPY fonts/source/source-sans-3-variable.woff2 ./source-sans-3-variable.woff2
# `smcp` buys real small caps for the eyebrow labels — drawn at small-cap stem
# weight rather than shrunken capitals, so they can be set larger and still read
# quiet. `case` lifts hyphens, parens and the middot onto the cap axis, which
# every uppercase label on the site needs. Together they cost ~7KB of the 25KB.
RUN pyftsubset source-sans-3-variable.woff2 \
  --output-file=source-sans-3-variable.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt,case,smcp" \
  --no-hinting --desubroutinize

# Recoleta only ever sets the masthead name, so it is cut down to basic Latin.
COPY fonts/source/recoleta-semibold.woff2 ./recoleta-semibold.woff2
RUN pyftsubset recoleta-semibold.woff2 \
  --output-file=recoleta-semibold.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt" \
  --no-hinting --desubroutinize

# Newsreader sets the about letter and nothing else, always at one weight, so
# the variable face is instanced down to a static 400 at the text optical size
# before subsetting — the whole axis would be ~110KB of dead bytes. En and em
# dashes are kept here (the letter is prose); the UI faces still omit them.
COPY fonts/source/newsreader-variable.woff2 ./newsreader-variable.woff2
COPY fonts/source/newsreader-italic-variable.woff2 ./newsreader-italic-variable.woff2
RUN fonttools varLib.instancer newsreader-variable.woff2 wght=400 opsz=18 \
  -o newsreader-regular.instance.ttf && \
  pyftsubset newsreader-regular.instance.ttf \
  --output-file=newsreader-regular.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt" \
  --no-hinting --desubroutinize && \
  fonttools varLib.instancer newsreader-italic-variable.woff2 wght=400 opsz=18 \
  -o newsreader-italic.instance.ttf && \
  pyftsubset newsreader-italic.instance.ttf \
  --output-file=newsreader-italic.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt" \
  --no-hinting --desubroutinize

# Target: extract subset fonts only (docker build --target fonts-out --output public/fonts .)
FROM scratch AS fonts-out
COPY --from=fonts /fonts/source-sans-3-variable.subset.woff2 /source-sans-3-variable.subset.woff2
COPY --from=fonts /fonts/recoleta-semibold.subset.woff2 /recoleta-semibold.subset.woff2
COPY --from=fonts /fonts/newsreader-regular.subset.woff2 /newsreader-regular.subset.woff2
COPY --from=fonts /fonts/newsreader-italic.subset.woff2 /newsreader-italic.subset.woff2

# Stage 2: Build site
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
COPY --from=fonts /fonts/source-sans-3-variable.subset.woff2 public/fonts/source-sans-3-variable.subset.woff2
COPY --from=fonts /fonts/recoleta-semibold.subset.woff2 public/fonts/recoleta-semibold.subset.woff2
COPY --from=fonts /fonts/newsreader-regular.subset.woff2 public/fonts/newsreader-regular.subset.woff2
COPY --from=fonts /fonts/newsreader-italic.subset.woff2 public/fonts/newsreader-italic.subset.woff2
RUN bun run build

# Stage 3: Output
FROM scratch AS dist
COPY --from=build /app/dist /
