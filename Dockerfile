# Stage 1: Subset fonts
FROM python:3.13-slim AS fonts
RUN pip install --no-cache-dir fonttools brotli
WORKDIR /fonts
COPY fonts/source/Inter-Regular.woff2 ./Inter-Regular.woff2
RUN pyftsubset Inter-Regular.woff2 \
  --output-file=Inter-Regular.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt" \
  --no-hinting --desubroutinize

# Target: extract subset font only (docker build --target fonts-out --output public/fonts .)
FROM scratch AS fonts-out
COPY --from=fonts /fonts/Inter-Regular.subset.woff2 /Inter-Regular.subset.woff2

# Stage 2: Build site
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
COPY --from=fonts /fonts/Inter-Regular.subset.woff2 public/fonts/Inter-Regular.subset.woff2
RUN bun run build

# Stage 3: Output
FROM scratch AS dist
COPY --from=build /app/dist /
