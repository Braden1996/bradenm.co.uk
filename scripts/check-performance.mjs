// cspell:ignore devtoolslog
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { userAgents } from "lighthouse/core/config/constants.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { startPerformanceServer } from "./performance-server.mjs";

const output = path.resolve("artifacts/performance");
const routes = ["/", "/bookshelf"];
const budgets = {
  fcp: 1800,
  lcp: 2500,
  tbt: 200,
  cls: 0.02,
  htmlGzip: 100 * 1024,
  javascriptGzip: 35 * 1024,
};
const auditNames = {
  fcp: "first-contentful-paint",
  lcp: "largest-contentful-paint",
  tbt: "total-blocking-time",
  cls: "cumulative-layout-shift",
};
const runs = [];
const failures = [];
const port = Number(process.env.PERFORMANCE_PORT ?? 4175);
const debugPort = Number(process.env.PERFORMANCE_DEBUG_PORT ?? 9224);
const baseURL = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
const server = await startPerformanceServer(port);
let browser;

function median(values) {
  const ordered = values.toSorted((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

async function auditRoute(route, formFactor, index) {
  const mobile = formFactor === "mobile";
  const result = await lighthouse(`${baseURL}${route}`, {
    port: debugPort,
    logLevel: "error",
    onlyCategories: ["performance"],
    output: "json",
    formFactor,
    emulatedUserAgent: userAgents[formFactor],
    screenEmulation: mobile
      ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
      : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
    throttlingMethod: "simulate",
    throttling: mobile
      ? { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 }
      : { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
  });
  if (!result) throw new Error("Lighthouse did not return a result");
  const name = `${route === "/" ? "home" : "bookshelf"}-${formFactor}-${index}`;
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(result.lhr, null, 2));
  // Persist the evidence Lighthouse already gathered, after the measured audit has finished.
  await writeFile(path.join(output, `${name}.trace.json`), JSON.stringify(result.artifacts.Trace));
  await writeFile(
    path.join(output, `${name}.devtoolslog.json`),
    JSON.stringify(result.artifacts.DevtoolsLog),
  );
  if (result.lhr.runtimeError) throw new Error(JSON.stringify(result.lhr.runtimeError));
  const metrics = Object.fromEntries(
    Object.entries(auditNames).map(([key, audit]) => [
      key,
      result.lhr.audits[audit]?.numericValue ?? null,
    ]),
  );
  const network = result.lhr.audits["network-requests"]?.details?.items ?? [];
  const scripts = new Set(
    network
      .filter((request) => request.resourceType === "Script" || /\.m?js(?:$|\?)/.test(request.url))
      .map((request) => request.url),
  );
  const scriptSizes = await Promise.all(
    [...scripts].map(async (url) => {
      const scriptURL = new URL(url);
      if (scriptURL.origin !== baseURL) throw new Error(`Unexpected external script: ${url}`);
      return gzipSync(await readFile(path.join("dist", decodeURIComponent(scriptURL.pathname))))
        .length;
    }),
  );
  const html = await readFile(route === "/" ? "dist/index.html" : "dist/bookshelf/index.html");
  const measured = {
    route,
    formFactor,
    index,
    ...metrics,
    htmlGzip: gzipSync(html).length,
    javascriptGzip: scriptSizes.reduce((sum, size) => sum + size, 0),
    networkBytes: result.lhr.audits["total-byte-weight"]?.numericValue ?? null,
    requests: network.length,
    browserVersion: result.lhr.environment.hostUserAgent,
  };
  runs.push(measured);
  console.log(JSON.stringify(measured));
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
    args: [`--remote-debugging-port=${debugPort}`],
  });
  for (const route of routes) {
    for (const index of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop -- Serial cold runs avoid sharing CPU and network pressure.
      await auditRoute(route, "mobile", index);
    }
    // eslint-disable-next-line no-await-in-loop -- Desktop measurements must not overlap mobile measurements.
    await auditRoute(route, "desktop", 1);
  }
  const summaries = routes.flatMap((route) =>
    ["mobile", "desktop"].map((formFactor) => {
      const selected = runs.filter((run) => run.route === route && run.formFactor === formFactor);
      const limits = {
        ...budgets,
        javascriptGzip: route === "/bookshelf" ? 350 * 1024 : budgets.javascriptGzip,
        networkBytes:
          route === "/bookshelf" ? 1.5 * 1024 * 1024 : (formFactor === "mobile" ? 500 : 600) * 1024,
      };
      const metrics = Object.fromEntries(
        Object.keys(limits).map((key) => [key, median(selected.map((run) => run[key]))]),
      );
      for (const [key, limit] of Object.entries(limits)) {
        const value = metrics[key];
        if (!Number.isFinite(value) || value > limit)
          failures.push({ route, formFactor, metric: key, value, limit });
      }
      return { route, formFactor, samples: selected.length, metrics, limits };
    }),
  );
  await writeFile(
    path.join(output, "budgets.json"),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        lighthouseVersion: "13.4.1",
        aggregation:
          "Median of three mobile runs; one desktop run per route. Milliseconds and bytes unless CLS.",
        summaries,
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length) {
    console.error("Performance budgets exceeded:", JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  await writeFile(
    path.join(output, "budgets.json"),
    JSON.stringify(
      { measuredAt: new Date().toISOString(), error: String(error), runs, failures },
      null,
      2,
    ),
  );
  throw new Error(
    "Performance audit could not complete; inspect artifacts/performance/budgets.json",
    { cause: error },
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
