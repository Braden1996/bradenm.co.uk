import type { KnipConfig } from "knip";

const frontmatterMatcher = /^---\r?\n([\s\S]*?)\r?\n---/;
const selfClosingScriptMatcher = /<script\b[^>]*\/>/gm;
const scriptBlockMatcher = /<script\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/gm;
const srcAttributeMatcher = /\bsrc=(["'])(?<path>[^"']+)\1/;

function compileAstro(source: string) {
  const compiledParts: string[] = [];
  const sanitizedSource = source.replace(selfClosingScriptMatcher, "");
  const frontmatter = sanitizedSource.match(frontmatterMatcher)?.[1];

  if (frontmatter) {
    compiledParts.push(frontmatter);
  }

  for (const match of sanitizedSource.matchAll(scriptBlockMatcher)) {
    const attributes = match.groups?.attributes ?? "";
    const body = match.groups?.body ?? "";
    const src = attributes.match(srcAttributeMatcher)?.groups?.path;

    if (src) {
      compiledParts.push(`import "${src}";`);
    }

    if (body.trim()) {
      compiledParts.push(body);
    }
  }

  return compiledParts.join("\n");
}

const config = {
  entry: ["images/source/signature/export-layers.mjs", "scripts/lib/atlas-preview-renderer.ts"],
  project: [
    "src/**/*.{astro,js,mjs,ts}",
    "scripts/**/*.{js,mjs,ts}",
    "tests/**/*.{js,mjs,ts}",
    "browser-tests/**/*.ts",
  ],
  compilers: {
    astro: compileAstro,
  },
} satisfies KnipConfig;

export default config;
