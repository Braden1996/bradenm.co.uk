import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://bradenm.co.uk",
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    build: {
      // Put shared layout CSS in the document to remove a first-paint request.
      // Route styles, media, and scripts keep separate cache identities.
      assetsInlineLimit: (filePath, content) =>
        filePath.endsWith(".css") &&
        (content.byteLength <= 6 * 1024 ||
          (/\/layout\.[^/]+\.css$/.test(filePath) && content.byteLength <= 32 * 1024)),
    },
  },
});
