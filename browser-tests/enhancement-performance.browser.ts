// cspell:ignore networkidle longtask
import { chromium, expect, test } from "@playwright/test";

type PortraitStartup = {
  intentAt: number | null;
  motionReadyAt: number | null;
  canvasVisibleAt: number | null;
  canvasOpaqueAt: number | null;
  finishedAt: number;
  longTasksSupported: boolean;
  longTasks: { startTime: number; duration: number }[];
  framesBeforeReady: number;
  posterHiddenBeforeReady: boolean;
  resources: { name: string; startTime: number; duration: number; transferSize: number }[];
  environment: {
    userAgent: string;
    hardwareConcurrency: number;
    devicePixelRatio: number;
    viewport: { width: number; height: number };
    canvas: { width: number; height: number };
    webglRenderer: string | null;
  };
};

declare global {
  interface Window {
    portraitStartupProbe?: { finish: () => PortraitStartup };
  }
}

test("records cold portrait enhancement and preserves the poster until the canvas is ready", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(45_000);
  // A separate process avoids the earlier interaction tests warming this
  // browser's resource/shader caches. OS and driver caches remain uncontrolled.
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  });
  const browserContext = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    viewport: { width: 1350, height: 940 },
    reducedMotion: "no-preference",
  });
  const page = await browserContext.newPage();
  try {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const posterImage = page.locator(".about-portrait__poster");
    const portraitRoot = page.locator("[data-about-portrait]");
    const portraitCanvas = page.locator("[data-about-portrait-canvas]");
    await expect(posterImage).toHaveCSS("opacity", "1");
    await expect(portraitRoot).not.toHaveAttribute("data-motion-ready");

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-about-portrait]");
      const poster = root?.querySelector<HTMLElement>(".about-portrait__poster");
      const canvas = root?.querySelector<HTMLCanvasElement>("[data-about-portrait-canvas]");
      if (!root || !poster || !canvas) throw new Error("The static portrait must be present");
      let intentAt: number | null = null;
      let motionReadyAt: number | null = null;
      let canvasVisibleAt: number | null = null;
      let canvasOpaqueAt: number | null = null;
      let framesBeforeReady = 0;
      let posterHiddenBeforeReady = false;
      let frame = 0;
      const longTasks: { startTime: number; duration: number }[] = [];
      const collectTasks = (entries: PerformanceEntry[]) => {
        for (const entry of entries) {
          if (intentAt !== null && entry.startTime + entry.duration >= intentAt) {
            longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        }
      };
      const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
      const tasks = new PerformanceObserver((list) => collectTasks(list.getEntries()));
      if (longTasksSupported) tasks.observe({ type: "longtask" });

      const readiness = new MutationObserver(() => {
        if (motionReadyAt === null && root.dataset.motionReady === "true") {
          motionReadyAt = performance.now();
        }
      });
      readiness.observe(root, { attributes: true, attributeFilter: ["data-motion-ready"] });
      const sample = (now: number) => {
        if (root.dataset.motionReady !== "true") {
          framesBeforeReady += 1;
          posterHiddenBeforeReady ||= Number(getComputedStyle(poster).opacity) < 0.999;
        }
        const opacity = Number(getComputedStyle(canvas).opacity);
        if (canvasVisibleAt === null && opacity > 0) canvasVisibleAt = now;
        if (canvasOpaqueAt === null && opacity >= 0.999) canvasOpaqueAt = now;
        if (canvasOpaqueAt === null) frame = requestAnimationFrame(sample);
      };
      const intent = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || !(event.target instanceof Element)) return;
        if (!event.target.closest(".about-portrait")) return;
        intentAt = performance.now();
        frame = requestAnimationFrame(sample);
        document.removeEventListener("keydown", intent, true);
      };
      document.addEventListener("keydown", intent, { capture: true });
      window.portraitStartupProbe = {
        finish() {
          cancelAnimationFrame(frame);
          collectTasks(tasks.takeRecords());
          tasks.disconnect();
          readiness.disconnect();
          document.removeEventListener("keydown", intent, true);
          const context = canvas.getContext("webgl2");
          const rendererInfo = context?.getExtension("WEBGL_debug_renderer_info");
          return {
            intentAt,
            motionReadyAt,
            canvasVisibleAt,
            canvasOpaqueAt,
            finishedAt: performance.now(),
            longTasksSupported,
            longTasks,
            framesBeforeReady,
            posterHiddenBeforeReady,
            resources: performance
              .getEntriesByType("resource")
              .filter(
                (entry): entry is PerformanceResourceTiming =>
                  entry instanceof PerformanceResourceTiming &&
                  intentAt !== null &&
                  entry.startTime >= intentAt,
              )
              .map(({ name, startTime, duration, transferSize }) => ({
                name,
                startTime,
                duration,
                transferSize,
              })),
            environment: {
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
              devicePixelRatio: window.devicePixelRatio,
              viewport: { width: innerWidth, height: innerHeight },
              canvas: { width: canvas.width, height: canvas.height },
              webglRenderer: context
                ? String(
                    context.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
                  )
                : null,
            },
          };
        },
      };
    });

    await page.locator(".about-portrait").focus();
    await page.keyboard.press("Enter");
    // This timeout bounds test execution; it is not a GPU performance budget.
    await expect(portraitRoot).toHaveAttribute("data-motion-ready", "true", { timeout: 30_000 });
    await expect(portraitCanvas).toHaveCSS("opacity", "1");
    await expect(posterImage).toHaveCSS("opacity", "0");
  } finally {
    try {
      const startup = await page.evaluate(() => window.portraitStartupProbe?.finish() ?? null);
      const readyDuration =
        startup?.motionReadyAt !== null &&
        startup?.motionReadyAt !== undefined &&
        startup.intentAt !== null
          ? startup.motionReadyAt - startup.intentAt
          : null;
      await testInfo.attach("portrait-cold-start.json", {
        contentType: "application/json",
        body: JSON.stringify(
          {
            browserName,
            browserVersion: browser.version(),
            cache: "Fresh browser and context; OS/driver caches are not controlled",
            instrumentation: "Long-task observer, readiness observer, and frame opacity samples",
            intentToMotionReadyMs: readyDuration,
            longTaskSummary: startup?.longTasksSupported
              ? {
                  count: startup.longTasks.length,
                  longestMs: Math.max(0, ...startup.longTasks.map((entry) => entry.duration)),
                  blockingMs: startup.longTasks.reduce(
                    (sum, entry) => sum + Math.max(0, entry.duration - 50),
                    0,
                  ),
                }
              : null,
            startup,
          },
          null,
          2,
        ),
      });
      expect(startup).not.toBeNull();
      expect(startup?.intentAt).not.toBeNull();
      expect(startup?.motionReadyAt).not.toBeNull();
      expect(startup?.canvasVisibleAt).not.toBeNull();
      expect(startup?.posterHiddenBeforeReady).toBe(false);
    } finally {
      await browser.close();
    }
  }
});
