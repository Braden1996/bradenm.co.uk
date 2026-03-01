import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://bradenm.co.uk",
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "always",
  },
});
