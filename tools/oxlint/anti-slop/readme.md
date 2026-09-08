# anti-slop (vendored)

Opinionated oxlint rules that reject low-evidence and low-signal TypeScript
patterns. Vendored from <https://github.com/dmmulroy/anti-slop> at commit
`446268e5d15baa968eaec669ff65358d36ae6259` (upstream recommends vendoring over
depending on a package). Upstream tests are not copied; the sources were
reformatted with this repo's Prettier config, so bytes diverge from upstream.

Registered in `.oxlintrc.json` via `jsPlugins`; requires the version-paired
`oxlint` + `@oxlint/plugins` devDependencies (currently 1.78.0).

The registered entry is the pre-bundled `dist/index.mjs` (prettier-ignored),
not the TypeScript sources: oxlint's plugin host is Node, and Node below
22.18 cannot load `.ts` modules. After editing the sources, regenerate with:

```bash
bun build tools/oxlint/anti-slop/index.ts --target=node --external @oxlint/plugins --outfile tools/oxlint/anti-slop/dist/index.mjs
```

## Local policy

- All 15 rules run as `error` repo-wide.
- A rule may only be tuned down with a documented reason recorded here.

## Documented divergences

- `src/features/bookshelf/client/bookshelf.ts` disables
  `anti-slop/no-runtime-typeof` and `anti-slop/no-unknown-parameters`
  (override in `.oxlintrc.json`): the file's hand-rolled type-guard chain IS
  the I/O boundary the rules point at — it parses the embedded bookshelf JSON
  payload with `unknown` inputs and `typeof` narrowing by design, and pulling
  in a schema library for one payload is not worth the dependency.
