# Project Overview

This repository is a static Astro site for `bradenm.co.uk`.

## Stack and Workflow

- Use Bun for package management and scripts.
- Prefer Astro-native patterns before introducing new frameworks or client-side abstractions.
- Keep the site buildable with `bun run build` and keep checks passing with `bun run check`.
- Cloudflare Pages deploys from the generated static output.

## Code Style

- Follow the existing Prettier configuration: 2 spaces, semicolons, double quotes, trailing commas, and a 100 character print width.
- Keep Astro components and layouts simple and colocated with the page or feature they support.
- Do not hand-edit generated Rulesync outputs. Update `.rulesync/**` sources and regenerate instead.

## Layout Stability

- Preserve first-paint geometry when extracting reusable visual primitives. If a parent layout depends on an element's size, encode that size in the SSR markup or a shared custom property from the start instead of relying on a later component-scoped override.
- Avoid post-hydration geometry corrections for core alignment. Prefer structural CSS that shares a layout or scroll container over JavaScript measurements that patch spacing after paint.
- Keep `transition:persist` targets stable. When refactoring a persisted element into a reusable component, preserve the original persisted wrapper or explicitly reserve the same footprint so the rest of the layout does not shift around it.

## Generated and Build Artifacts

- Treat `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` as generated files owned by Rulesync.
- Keep local `.claude/`, `.cursor/`, and `.cursorignore` artifacts out of commits.
- Avoid editing `dist/`, `.astro/`, `node_modules/`, or font binaries unless the task explicitly requires it.
