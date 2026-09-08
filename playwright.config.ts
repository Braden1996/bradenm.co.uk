import { chromium, defineConfig } from "@playwright/test";

const externalPreview = process.env.BROWSER_TEST_BASE_URL;

export default defineConfig({
  testDir: "./browser-tests",
  testMatch: "**/*.browser.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: "artifacts/browser/results",
  reporter: [["list"], ["html", { outputFolder: "artifacts/browser/report", open: "never" }]],
  use: {
    baseURL: externalPreview ?? "http://127.0.0.1:4175",
    viewport: { width: 1350, height: 940 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.CHROME_PATH ?? chromium.executablePath() },
  },
  webServer: externalPreview
    ? []
    : {
        command: "bun scripts/performance-server.mjs",
        url: "http://127.0.0.1:4175",
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
      },
});
