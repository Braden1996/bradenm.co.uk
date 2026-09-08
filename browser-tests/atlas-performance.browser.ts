// cspell:ignore domcontentloaded networkidle SwiftShader llvmpipe softpipe Adreno Mali PowerVR GeForce
import { chromium, expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

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
      } else {
        await expect(atlas).toHaveAttribute("data-atlas-ready", "true", { timeout: 25_000 });
        readiness = Number(await atlas.getAttribute("data-atlas-ready-at"));
      }
      await page.waitForLoadState("networkidle");
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
          new Promise<{ elapsed: number; frames: number; fps: number; p95: number }>((resolve) => {
            const surface = document.querySelector<HTMLElement>("[data-atlas-scroll]");
            const root = document.querySelector<HTMLElement>("[data-atlas]");
            if (!surface || !root) throw new Error("Missing atlas");
            let start: number | null = null;
            let previous = 0;
            let initial = 0;
            const intervals: number[] = [];
            const step = (now: number) => {
              if (start === null) {
                start = now;
                previous = now;
                initial = Number(root.dataset.atlasFrames);
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
                });
              }
            };
            requestAnimationFrame(step);
          }),
        mobile,
      );
      if (!mobile) {
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
      const gpu = environment.gpu ?? "";
      const softwareGpu =
        /SwiftShader|llvmpipe|softpipe|software (?:rasterizer|renderer)|Microsoft Basic Render Driver/i.test(
          gpu,
        );
      const renderingMode = mobile
        ? "native"
        : softwareGpu
          ? "software"
          : /Apple (?:M\d|GPU)|NVIDIA|GeForce|AMD|Radeon|Intel|Adreno|Mali|PowerVR/i.test(gpu)
            ? "hardware"
            : "unknown";
      const targets = {
        readinessMs: mobile ? 6000 : 2000,
        fps: mobile ? 30 : 60,
        minimumFps: mobile ? 29 : 57,
      };
      const enforceNumericTargets = mobile || renderingMode !== "software";
      if (!enforceNumericTargets)
        testInfo.annotations.push({
          type: "software-rendering",
          description: "Hardware speed targets are recorded; behavior and resource limits apply.",
        });
      const report = {
        profile: mobile ? "mobile" : "desktop",
        mode: mobile ? "grid" : "3D table",
        renderingMode,
        browser: browser.version(),
        browserName,
        cache: "Fresh browser and context; OS and GPU driver caches uncontrolled",
        throttle: {
          latencyMs: mobile ? 150 : 40,
          downloadKbps: mobile ? 1638.4 : 10240,
          cpu: mobile ? 4 : 1,
        },
        readinessMs: readiness,
        targets,
        targetComparison: {
          enforced: enforceNumericTargets,
          readinessMet: readiness <= targets.readinessMs,
          minimumFpsMet: movement.fps >= targets.minimumFps,
        },
        movement,
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
      expect(movement.frames).toBeGreaterThan(0);
      expect(environment.initialTransfer).toBeLessThanOrEqual(1.5 * 1024 * 1024);
      if (mobile) {
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
      if (enforceNumericTargets) {
        expect(readiness).toBeLessThanOrEqual(targets.readinessMs);
        expect(movement.fps).toBeGreaterThanOrEqual(targets.minimumFps);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
