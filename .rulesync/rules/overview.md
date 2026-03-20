---
root: true
targets: ["*"]
description: "Repo-wide guidance for the Astro site and its automation"
globs: ["**/*"]
cursor:
  alwaysApply: true
  description: "Repo-wide guidance for the Astro site and its automation"
  globs: ["*"]
---

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

## Generated and Build Artifacts

- Treat `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` as generated files owned by Rulesync.
- Keep local `.claude/`, `.cursor/`, and `.cursorignore` artifacts out of commits.
- Avoid editing `dist/`, `.astro/`, `node_modules/`, or font binaries unless the task explicitly requires it.
