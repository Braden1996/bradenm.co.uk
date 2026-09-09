// cspell:ignore domcontentloaded networkidle SwiftShader llvmpipe softpipe Adreno Mali PowerVR GeForce
import { chromium, expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { safeParse, string } from "valibot";
import { warmAtlas } from "./helpers/atlas";

// Trace screenshots and DOM snapshots add rendering work to the numeric sample.
test.use({ trace: "off" });

function rendererMode(renderer: string | null) {
  if (
    /SwiftShader|llvmpipe|softpipe|software (?:rasterizer|renderer)|Microsoft Basic Render Driver/i.test(
      renderer ?? "",
    )
  )
    return "software";
  return /Apple (?:M\d|GPU)|NVIDIA|GeForce|AMD|Radeon|Intel|Adreno|Mali|PowerVR/i.test(
    renderer ?? "",
  )
    ? "hardware"
    : "unknown";
}

for (const mobile of [false, true]) {
  test(`records ${mobile ? "mobile grid" : "desktop atlas"} readiness, movement and idle resources`, async ({
    browserName,
  }, testInfo) => {
    test.setTimeout(120_000);
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
    });
    const context = await browser.newContext({
      baseURL: String(testInfo.project.use.baseURL),
      viewport: mobile ? { width: 412, height: 823 } : { width: 1350, height: 940 },
      deviceScaleFactor: mobile ? 1.75 : 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const browserSession = await browser.newBrowserCDPSession();
    try {
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: mobile ? 150 : 40,
        downloadThroughput: ((mobile ? 1638.4 : 10240) * 1024) / 8,
        uploadThroughput: ((mobile ? 750 : 10240) * 1024) / 8,
      });
      await session.send("Emulation.setCPUThrottlingRate", { rate: mobile ? 4 : 1 });
      await page.goto("/bookshelf", { waitUntil: "domcontentloaded" });
      const atlas = page.locator("[data-atlas]");
      let readiness: number;
      let intentAt: number | null = null;
      let readyAt: number;
      if (mobile) {
        await expect(page.locator("[data-bookshelf-root]")).toHaveAttribute(
          "data-bookshelf-initialized",
          "true",
        );
        await page
          .locator(".atlas-book__mobile img")
          .first()
          .evaluate(async (image: HTMLImageElement) => image.decode());
        readiness = await page.evaluate(() => performance.now());
        readyAt = readiness;
      } else {
        intentAt = await warmAtlas(page);
        await expect(atlas).toHaveAttribute("data-atlas-ready", "true", { timeout: 25_000 });
        readyAt = Number(await atlas.getAttribute("data-atlas-ready-at"));
        readiness = readyAt - intentAt;
      }
      await page.waitForLoadState("networkidle");
      // Identify the active browser GPU backend without creating WebGL on the page.
      const systemInfo = await browserSession.send("SystemInfo.getInfo").catch(() => null);
      const compositorRenderer = safeParse(string(), systemInfo?.gpu.auxAttributes?.glRenderer);
      const browserCompositor = {
        source: "SystemInfo.getInfo.gpu.auxAttributes.glRenderer",
        renderer: compositorRenderer.success ? compositorRenderer.output : null,
        displayType: systemInfo?.gpu.auxAttributes?.displayType ?? null,
        featureStatus: systemInfo?.gpu.featureStatus ?? null,
      };
      const compositorMode = rendererMode(browserCompositor.renderer);
      const environment = await page.evaluate((isMobile) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-atlas-canvas]");
        const gl = isMobile ? null : canvas?.getContext("webgl2");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        const resources = performance
          .getEntriesByType("resource")
          .filter(
            (entry): entry is PerformanceResourceTiming =>
              entry instanceof PerformanceResourceTiming,
          );
        return {
          userAgent: navigator.userAgent,
          gpu: gl ? String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) : null,
          viewport: [innerWidth, innerHeight],
          canvas: canvas ? [canvas.width, canvas.height] : null,
          devicePixelRatio,
          hardwareConcurrency: navigator.hardwareConcurrency,
          initialTransfer: resources.reduce((bytes, entry) => bytes + entry.transferSize, 0),
          rendererRequests: resources.filter((entry) => /atlas-renderer.*\.js/.test(entry.name))
            .length,
        };
      }, mobile);
      const movement = await page.evaluate(
        (isMobile) =>
          new Promise<{
            elapsed: number;
            frames: number;
            fps: number;
            p95: number;
            renderFramesBefore: number | null;
            scrollDisplacement: number | null;
          }>((resolve) => {
            const surface = document.querySelector<HTMLElement>("[data-atlas-scroll]");
            const root = document.querySelector<HTMLElement>("[data-atlas]");
            if (!surface || !root) throw new Error("Missing atlas");
            let start: number | null = null;
            let previous = 0;
            let initial = 0;
            let initialScroll = 0;
            const intervals: number[] = [];
            const step = (now: number) => {
              if (start === null) {
                start = now;
                previous = now;
                initial = Number(root.dataset.atlasFrames);
                initialScroll = scrollY;
              } else intervals.push(now - previous);
              previous = now;
              const elapsed = now - start;
              if (isMobile) window.scrollTo(0, elapsed * 0.5);
              else
                surface.dispatchEvent(
                  new WheelEvent("wheel", {
                    deltaY: -2,
                    clientX: 650,
                    clientY: 440,
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              if (elapsed < 2000) requestAnimationFrame(step);
              else {
                const frames = isMobile
                  ? intervals.length
                  : Number(root.dataset.atlasFrames) - initial;
                const ordered = intervals.toSorted((a, b) => a - b);
                resolve({
                  elapsed,
                  frames,
                  fps: (frames * 1000) / elapsed,
                  p95: ordered[Math.floor(ordered.length * 0.95)] ?? 0,
                  renderFramesBefore: isMobile ? null : initial,
                  scrollDisplacement: isMobile ? scrollY - initialScroll : null,
                });
              }
            };
            requestAnimationFrame(step);
          }),
        mobile,
      );
      let liveness: { before: number; after: number; timeoutMs: number } | null = null;
      if (!mobile) {
        const before = movement.renderFramesBefore;
        if (before === null) throw new Error("Desktop movement needs its initial render count");
        // Wheel input queues the controller RAF, which queues the renderer RAF. A slow
        // software GPU can finish the speed window before that render runs. Check its
        // eventual render-call count separately, preserving the raw FPS measurement.
        await expect
          .poll(async () => Number(await atlas.getAttribute("data-atlas-frames")), {
            timeout: 25_000,
          })
          .toBeGreaterThan(before);
        liveness = {
          before,
          after: Number(await atlas.getAttribute("data-atlas-frames")),
          timeoutMs: 25_000,
        };
        await page.mouse.move(650, 440);
        await page.mouse.wheel(0, -650);
        /* eslint-disable no-await-in-loop */
        for (const index of [0, 20, 40, 60, 80, 100, 120, 140, 164, 0]) {
          await page.locator("[data-book-open]").nth(index).focus();
          await page.evaluate(() => new Promise(requestAnimationFrame));
          await page.waitForLoadState("networkidle");
        }
        /* eslint-enable no-await-in-loop */
        await page.locator("[data-atlas-scroll]").focus();
        await page.keyboard.press("0");
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(700);
      const idleStart = Number(await atlas.getAttribute("data-atlas-frames"));
      await page.waitForTimeout(500);
      const idleFrames = Number(await atlas.getAttribute("data-atlas-frames")) - idleStart;
      const textures = Number(await atlas.getAttribute("data-atlas-textures"));
      const models = Number(await atlas.getAttribute("data-atlas-models"));
      const gpuTextures = Number(await atlas.getAttribute("data-atlas-gpu-textures"));
      const gpuGeometries = Number(await atlas.getAttribute("data-atlas-gpu-geometries"));
      const renderingMode = mobile ? "native" : rendererMode(environment.gpu);
      const targets = {
        readinessMs: mobile ? 6000 : 2000,
        fps: mobile ? 30 : 60,
        minimumFps: mobile ? 29 : 57,
      };
      const readinessEnforced = mobile || renderingMode !== "software";
      const frameRateEnforced = (mobile ? compositorMode : renderingMode) !== "software";
      if (!frameRateEnforced)
        testInfo.annotations.push({
          type: "software-rendering",
          description: mobile
            ? "Software-rendered FPS is recorded; mobile readiness and behavior/resource limits apply."
            : "Hardware speed targets are recorded; behavior and resource limits apply.",
        });
      const report = {
        profile: mobile ? "mobile" : "desktop",
        mode: mobile ? "grid" : "3D table",
        renderingMode,
        browserCompositor: { ...browserCompositor, renderingMode: compositorMode },
        browser: browser.version(),
        browserName,
        cache: "Fresh browser and context; OS and GPU driver caches uncontrolled",
        throttle: {
          latencyMs: mobile ? 150 : 40,
          downloadKbps: mobile ? 1638.4 : 10240,
          cpu: mobile ? 4 : 1,
        },
        readinessMs: readiness,
        readinessOrigin: mobile ? "navigation" : "pointer intent",
        intentAtMs: intentAt,
        readyAtMs: readyAt,
        targets,
        targetComparison: {
          readinessEnforced,
          frameRateEnforced,
          readinessMet: readiness <= targets.readinessMs,
          minimumFpsMet: movement.fps >= targets.minimumFps,
        },
        movement,
        liveness,
        idleFrames,
        textures,
        models,
        gpuTextures,
        gpuGeometries,
        environment,
      };
      await mkdir("artifacts/atlas", { recursive: true });
      await writeFile(
        `artifacts/atlas/${report.profile}-performance.json`,
        JSON.stringify(report, null, 2),
      );
      await testInfo.attach("atlas-performance", {
        contentType: "application/json",
        body: JSON.stringify(report, null, 2),
      });
      expect(idleFrames).toBe(0);
      expect(environment.initialTransfer).toBeLessThanOrEqual(1.5 * 1024 * 1024);
      if (mobile) {
        expect(movement.frames).toBeGreaterThan(0);
        expect(movement.scrollDisplacement).toBeGreaterThan(0);
        expect(environment.rendererRequests).toBe(0);
        expect(models).toBe(0);
        expect(gpuTextures).toBe(0);
      } else {
        expect(textures).toBeLessThanOrEqual(73);
        expect(models).toBe(165);
        expect(gpuTextures).toBeLessThanOrEqual(81);
        expect(gpuGeometries).toBeLessThanOrEqual(501);
        expect(gpuGeometries).toBeGreaterThan(3);
      }
      if (readinessEnforced) expect(readiness).toBeLessThanOrEqual(targets.readinessMs);
      if (frameRateEnforced) expect(movement.fps).toBeGreaterThanOrEqual(targets.minimumFps);
    } finally {
      await browserSession.detach();
      await context.close();
      await browser.close();
    }
  });
}
