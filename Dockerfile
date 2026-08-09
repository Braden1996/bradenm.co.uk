# Stage 1: Subset fonts
FROM python:3.14.6-slim AS fonts
RUN python -m pip install --no-cache-dir --root-user-action=ignore --upgrade \
  pip==26.2.1 \
  fonttools==4.63.0 \
  brotli==1.2.0
WORKDIR /fonts
COPY fonts/source/inter-regular.woff2 ./inter-regular.woff2
RUN pyftsubset inter-regular.woff2 \
  --output-file=inter-regular.subset.woff2 \
  --flavor=woff2 \
  --unicodes="U+0020-007F,U+00A0-00FF,U+2018-201D,U+2026" \
  --layout-features="kern,liga,calt" \
  --no-hinting --desubroutinize

# Target: extract subset font only (docker build --target fonts-out --output public/fonts .)
FROM scratch AS fonts-out
COPY --from=fonts /fonts/inter-regular.subset.woff2 /inter-regular.subset.woff2

# Stage 2: Build site
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
COPY --from=fonts /fonts/inter-regular.subset.woff2 public/fonts/inter-regular.subset.woff2
RUN bun run build

# Stage 3: Output
FROM scratch AS dist
COPY --from=build /app/dist /
