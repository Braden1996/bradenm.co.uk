// Orchestrates the live typogravure portrait: a WebGL2 canvas that draws the
// printed body. Pointer travel advances the sequence with a short response;
// the cursor parts the dots as it passes through the print,
// with the SSR poster as first paint and permanent fallback.
import {
  readEnhancementTier,
  reportWebGLFailure,
  watchEnhancementPolicy,
} from "../../../components/lib/enhancement-policy";
import { MEDIA_TO_STAGE_X, rearAboutBlocks } from "../lib/about-blocks";
import { advanceBrushPath, type BrushPoint } from "../lib/about-brush-path";
import { createPortraitPaintSmear } from "../lib/about-paint-smear";
import { portraitFrameTime, portraitSourceFrame } from "../lib/portrait-motion";
import { createPortraitScrub } from "../lib/portrait-scrub";
import { createPortraitPairPlayback } from "./portrait-pair-playback";
import {
  createTypogravureRenderer,
  getPortraitContext,
  SETTLE_SECONDS,
  type TypogravureBlock,
  type TypogravureRenderer,
  type TypogravureTextures,
} from "./typogravure-renderer";

type AboutPortraitController = {
  destroy: () => void;
};

const controllers = new WeakMap<HTMLElement, AboutPortraitController>();
const activeControllers = new Set<AboutPortraitController>();
let lifecycleBound = false;

const MAX_QUEUED_POINTS = 65;
const MAX_QUEUED_STROKES = 4;

// A resting brush holds a pocket in the dots. Cache that pocket once the
// springs settle; moving or leaving wakes the simulation and seals the trail.
const TRAIL_ACTIVE_MS = Math.ceil(SETTLE_SECONDS * 1000) + 400;
const CLICK_TRAVEL = 6;
const TOUCH_MOVE_TRAVEL = 8;

function getPortraitRoots(scope: ParentNode) {
  const roots =
    scope instanceof HTMLElement && scope.matches("[data-about-portrait]") ? [scope] : [];

  if ("querySelectorAll" in scope) {
    roots.push(...scope.querySelectorAll<HTMLElement>("[data-about-portrait]"));
  }

  return roots;
}

function loadImage(src: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const abort = () => {
      image.removeAttribute("src");
      reject(new DOMException("Portrait initialization cancelled", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    image.addEventListener(
      "load",
      () => {
        signal.removeEventListener("abort", abort);
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        signal.removeEventListener("abort", abort);
        reject(new Error(`image failed to load: ${src}`));
      },
      { once: true },
    );
    image.src = src;
  });
}

// Client coordinates to top-left stage pixels of the canvas's contain box.
function clientToStage(clientX: number, clientY: number, rect: DOMRect): [number, number] {
  const scale = Math.min(rect.width / 1440, rect.height / 800) || 1;
  const offsetX = (rect.width - 1440 * scale) / 2;
  const offsetY = (rect.height - 800 * scale) / 2;
  return [(clientX - rect.left - offsetX) / scale, (clientY - rect.top - offsetY) / scale];
}

function createPortraitController(root: HTMLElement): AboutPortraitController | undefined {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-about-portrait-canvas]");
  const frame = root.querySelector<HTMLElement>(".about-portrait__frame");

  if (!canvas || !frame) {
    return undefined;
  }

  const portraitCanvas = canvas;
  const portraitFrame = frame;
  // Pointer interaction binds to the whole figure, so sweeps that start on
  // its margins still scrub the moment and part the dots.
  const pointerSurface = frame.closest<HTMLElement>(".about-portrait") ?? frame;
  const { atlasSrc, correspondenceSrc, packedSrc, propSrc, stillSrc, greenSrc, blueSrc } =
    frame.dataset;
  const footSrc = frame.querySelector<HTMLElement>(".about-portrait__block--foot")?.dataset
    .paintSrc;
  const posterTime = portraitFrameTime(
    portraitSourceFrame(Number.parseFloat(frame.dataset.posterTime ?? "0")),
  );

  if (
    !atlasSrc ||
    !correspondenceSrc ||
    !propSrc ||
    !greenSrc ||
    !blueSrc ||
    !footSrc ||
    !stillSrc ||
    !packedSrc
  ) {
    return undefined;
  }

  const atlasUrl: string = atlasSrc;
  const correspondenceUrl: string = correspondenceSrc;
  const packedUrl: string = packedSrc;
  const stillUrl: string = stillSrc;
  const propUrl: string = propSrc;
  const greenUrl: string = greenSrc;
  const blueUrl: string = blueSrc;
  const footUrl: string = footSrc;

  const abortController = new AbortController();
  let tier = readEnhancementTier();
  let roomActive = !root.closest("[inert]");
  let resourceController: AbortController | undefined;
  let renderer: TypogravureRenderer | undefined;
  let rendererPending: Promise<void> | undefined;
  let playback: ReturnType<typeof createPortraitPairPlayback> | undefined;
  let destroyed = false;
  let unavailable = false;
  let inViewport = !("IntersectionObserver" in globalThis);
  let stillShown = false;
  let intersectionObserver: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let frameLoop = 0;
  let lastTick = 0;
  let scrubTime = Number.isFinite(posterTime) ? posterTime : 0;
  const scrub = createPortraitScrub(scrubTime);
  let lastPointer: [number, number] | undefined;
  let lastBrushStage: [number, number] | undefined;
  let pendingPoints: BrushPoint[] = [];
  let completedStrokes: BrushPoint[][] = [];
  let stillImage: HTMLImageElement | undefined;
  let paintSmear: ReturnType<typeof createPortraitPaintSmear> | undefined;
  let rendererGeneration = 0;
  // Hover holds a pocket open in the dots until the pointer moves away.
  let hoverStage: [number, number] | undefined;
  // The press pulse: holding shrinks the block, releasing kicks it briefly
  // wider before it settles back — a pulse through the dots.
  let pressScale = 1;
  let pressTarget = 1;
  let releaseKick = 0;
  let pressOrigin: [number, number] | undefined;
  let touchIntent: "pending" | "interacting" | "scrolling" | undefined;
  let draggedSincePress = false;
  let trailActiveUntil = 0;
  let playbackFailed = false;
  let pairNeedsRender = false;
  let ticking = false;
  let canvasRevealed = false;
  let resizeSettleTimer = 0;
  let sourcePending: HTMLImageElement | undefined;

  function prefersStatic() {
    return tier === "static" || unavailable;
  }

  function revealPoster() {
    delete root.dataset.motionReady;
  }

  function revealCanvas() {
    if (destroyed || unavailable || prefersStatic()) {
      return;
    }
    canvasRevealed = true;
    root.dataset.motionReady = "true";
  }

  function markUnavailable() {
    unavailable = true;
    pointerSurface.dataset.enhancementUnavailable = "";
    pointerSurface.setAttribute("role", "img");
    pointerSurface.removeAttribute("tabindex");
    pointerSurface.setAttribute(
      "aria-label",
      "Braden smiling while eating gelato, rendered as a typographic portrait.",
    );
    resourceController?.abort();
    stopLoop();
    releasePlayback();
    renderer?.destroy();
    renderer = undefined;
    paintSmear = undefined;
    revealPoster();
  }

  async function ensureRenderer() {
    if (
      renderer ||
      rendererPending ||
      unavailable ||
      destroyed ||
      prefersStatic() ||
      !inViewport ||
      !roomActive ||
      document.hidden ||
      !pointerSurface.hasAttribute("data-enhancement-requested")
    )
      return rendererPending;

    // Check support on the actual canvas before acquiring enhancement-only assets.
    if (!getPortraitContext(portraitCanvas)) {
      markUnavailable();
      reportWebGLFailure();
      return undefined;
    }

    const generation = rendererGeneration;
    const resources = new AbortController();
    resourceController = resources;
    const abortResources = () => resources.abort();
    abortController.signal.addEventListener("abort", abortResources, {
      once: true,
    });
    rendererPending = (async () => {
      try {
        const [atlas, correspondence, propSupport, green, blue, foot, still] = await Promise.all([
          loadImage(atlasUrl, resources.signal),
          loadImage(correspondenceUrl, resources.signal),
          loadImage(propUrl, resources.signal),
          loadImage(greenUrl, resources.signal),
          loadImage(blueUrl, resources.signal),
          loadImage(footUrl, resources.signal),
          loadImage(stillUrl, resources.signal),
        ]);
        if (
          destroyed ||
          prefersStatic() ||
          resources.signal.aborted ||
          generation !== rendererGeneration
        )
          return;
        const blocks: TypogravureBlock[] = Object.entries(rearAboutBlocks).map(([name, block]) => ({
          paint: name === "green" ? green : blue,
          rect: [
            block.rect.left + MEDIA_TO_STAGE_X,
            block.rect.top,
            block.rect.width,
            block.rect.height,
          ],
        }));
        const rendererTextures: TypogravureTextures = {
          atlas,
          correspondence,
          propSupport,
        };
        const created = await createTypogravureRenderer(
          portraitCanvas,
          rendererTextures,
          blocks,
          tier,
          resources.signal,
        );
        if (
          destroyed ||
          prefersStatic() ||
          resources.signal.aborted ||
          generation !== rendererGeneration
        ) {
          created?.destroy(false);
          return;
        }
        if (!created) {
          markUnavailable();
          return;
        }
        renderer = created;
        paintSmear = createPortraitPaintSmear({
          green,
          blue,
          foot,
          propSupport,
        });
        renderer.resize();
        stillImage = still;
        sourcePending = still;
        // Source upload, physics and reveal share one frame; the poster stays until it is drawn.
        if (sourcePending) ensureLoop();
        ensurePlayback();
      } catch (error) {
        if (
          destroyed ||
          resources.signal.aborted ||
          prefersStatic() ||
          generation !== rendererGeneration
        )
          return;
        console.warn("about-portrait: falling back to poster", error);
        markUnavailable();
      }
    })().finally(() => {
      abortController.signal.removeEventListener("abort", abortResources);
      if (resourceController === resources) resourceController = undefined;
      rendererPending = undefined;
      if (resources.signal.aborted || generation !== rendererGeneration) syncActivity();
    });
    return rendererPending;
  }

  function releasePlayback() {
    // The matte reader is lazy: release its reference before closing cached bitmaps.
    if (stillImage) paintSmear?.updateSource(stillImage);
    playback?.destroy();
    playback = undefined;
  }

  function ensurePlayback() {
    if (
      playback ||
      !renderer ||
      !stillShown ||
      unavailable ||
      playbackFailed ||
      prefersStatic() ||
      !roomActive ||
      !inViewport ||
      document.hidden
    )
      return;
    const activeRenderer = renderer;
    playback = createPortraitPairPlayback(activeRenderer, packedUrl, {
      redraw() {
        if (destroyed || renderer !== activeRenderer || prefersStatic()) return;
        pairNeedsRender = true;
        // A phase update inside tick belongs to that frame; only asynchronous
        // pair publication needs to wake a sleeping animation loop.
        if (!ticking) ensureLoop();
      },
      onPair(pair) {
        if (renderer === activeRenderer) paintSmear?.updateSource(pair.first);
      },
      onError(error) {
        if (destroyed || renderer !== activeRenderer) return;
        playbackFailed = true;
        releasePlayback();
        console.warn("about-portrait: retaining the last complete print", error);
      },
    });
    // Warm the exact reference pair while keeping the ordinary still on screen.
    playback.reset(posterTime);
    playback.setTime(scrubTime);
  }

  function scrubStep(deltaSeconds: number) {
    if (!playback) {
      scrub.hold();
      return;
    }
    scrubTime = scrub.step(deltaSeconds);
  }

  function tick(now: number) {
    frameLoop = 0;
    if (
      destroyed ||
      unavailable ||
      !renderer ||
      prefersStatic() ||
      !roomActive ||
      !inViewport ||
      document.hidden
    ) {
      return;
    }
    if (tier === "light" && now - lastTick < 1000 / 30 - 1) {
      scheduleLoop();
      return;
    }
    ticking = true;
    if (sourcePending) {
      paintSmear?.updateSource(sourcePending);
      renderer.uploadSource(sourcePending);
      sourcePending = undefined;
      stillShown = true;
    }
    ensurePlayback();
    const deltaSeconds = Math.min(0.1, Math.max(0.001, (now - lastTick) / 1000));
    lastTick = now;
    scrubStep(deltaSeconds);
    playback?.setTime(scrubTime);
    pressScale += (pressTarget - pressScale) * (1 - Math.exp(-deltaSeconds * 18));
    releaseKick *= Math.exp(-deltaSeconds * 7);
    const completed = completedStrokes[0];
    const points =
      completed ?? (pendingPoints.length > 0 ? pendingPoints : hoverStage ? [hoverStage] : []);
    if (points.length > 0) {
      const stroke = advanceBrushPath(points);
      let smeared = false;
      for (const { segment } of stroke.segments) {
        const [x0, y0, x1, y1] = segment;
        if (paintSmear?.move([x0, y0], [x1, y1])) smeared = true;
      }
      if (smeared && paintSmear) renderer.uploadSmear(paintSmear.canvas);
      if (completed) {
        if (stroke.remainingPoints.length > 0) {
          completedStrokes[0] = [...stroke.remainingPoints];
        } else {
          completedStrokes.shift();
          paintSmear?.lift();
        }
      } else {
        pendingPoints = [...stroke.remainingPoints];
      }
      renderer.updatePhysics(deltaSeconds, {
        segments: stroke.segments,
        scale: pressScale + releaseKick,
      });
    } else {
      renderer.updatePhysics(deltaSeconds);
    }
    renderer.render();
    pairNeedsRender = false;
    ticking = false;
    if (!canvasRevealed && stillShown) revealCanvas();
    if (shouldAnimate()) {
      scheduleLoop();
    }
  }

  function shouldAnimate() {
    if (
      destroyed ||
      unavailable ||
      !renderer ||
      (!stillShown && !sourcePending) ||
      prefersStatic()
    ) {
      return false;
    }
    if (!inViewport || !roomActive || document.hidden) {
      return false;
    }
    // Only video playback and particle motion keep the loop alive;
    // a settled print costs no animation frames.
    if (
      sourcePending !== undefined ||
      pairNeedsRender ||
      !scrub.isSettled() ||
      pendingPoints.length > 0 ||
      completedStrokes.length > 0
    ) {
      return true;
    }
    if (renderer && !renderer.isSettled() && !hoverStage) {
      return true;
    }
    return performance.now() < trailActiveUntil;
  }

  function scheduleLoop() {
    if (frameLoop === 0) {
      frameLoop = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (frameLoop !== 0) {
      cancelAnimationFrame(frameLoop);
      frameLoop = 0;
    }
  }

  function ensureLoop() {
    if (shouldAnimate() && frameLoop === 0) {
      lastTick = performance.now() - (tier === "light" ? 1000 / 30 : 1);
      scheduleLoop();
    }
  }

  // Finish the last samples even when the pointer leaves before a frame, but
  // keep them separate so the next contact does not disturb the dots between.
  function finishStroke() {
    if (pendingPoints.length > 0) {
      if (completedStrokes.length === MAX_QUEUED_STROKES) {
        completedStrokes.shift();
      }
      completedStrokes.push(pendingPoints);
      pendingPoints = [];
    } else if (completedStrokes.length === 0) {
      paintSmear?.lift();
    }
  }

  function clearPointer() {
    paintSmear?.lift();
    lastPointer = undefined;
    lastBrushStage = undefined;
    pendingPoints = [];
    completedStrokes = [];
    hoverStage = undefined;
    pressScale = 1;
    pressTarget = 1;
    releaseKick = 0;
    scrub.hold();
    trailActiveUntil = 0;
    pressOrigin = undefined;
    touchIntent = undefined;
    draggedSincePress = false;
  }

  function resetPortrait() {
    stopLoop();
    clearPointer();
    sourcePending = undefined;
    paintSmear?.reset();
    renderer?.reset();
    scrubTime = Number.isFinite(posterTime) ? posterTime : 0;
    scrub.reset(scrubTime);
    playback?.reset(scrubTime);
    pairNeedsRender = false;
    if (renderer && stillImage) {
      paintSmear?.updateSource(stillImage);
      renderer.uploadSource(stillImage);
      stillShown = true;
    }
    renderer?.render();
    if (renderer && stillShown && !canvasRevealed) revealCanvas();
  }

  function syncActivity() {
    if (destroyed || unavailable) {
      return;
    }
    const nextTier = readEnhancementTier();
    if (nextTier !== tier || nextTier === "static") {
      tier = nextTier;
      resourceController?.abort();
      sourcePending = undefined;
      stopLoop();
      clearPointer();
      releasePlayback();
      rendererGeneration += 1;
      renderer?.destroy(false);
      renderer = undefined;
      paintSmear = undefined;
      stillShown = false;
      pairNeedsRender = false;
      canvasRevealed = false;
      scrubTime = Number.isFinite(posterTime) ? posterTime : 0;
      scrub.reset(scrubTime);
      revealPoster();
      if (tier === "static") return;
    }
    if (inViewport && roomActive && !document.hidden) {
      void ensureRenderer();
      ensurePlayback();
      playback?.resume();
      ensureLoop();
    } else {
      resourceController?.abort();
      playback?.pause();
      // Preserve a decoded first frame when the room or tab hides before its RAF.
      // An existing renderer will consume it when active again.
      stopLoop();
      clearPointer();
    }
  }

  pointerSurface.addEventListener(
    "site:portrait-intent",
    () => {
      const x = Number.parseFloat(pointerSurface.dataset.enhancementTouchX ?? "");
      const y = Number.parseFloat(pointerSurface.dataset.enhancementTouchY ?? "");
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pressOrigin = [x, y];
        touchIntent = "pending";
      }
      syncActivity();
    },
    { signal: abortController.signal },
  );

  pointerSurface.addEventListener(
    "pointerenter",
    (event) => {
      if (event.pointerType !== "touch" && !prefersStatic()) {
        ensurePlayback();
      }
    },
    { signal: abortController.signal },
  );
  pointerSurface.addEventListener(
    "pointermove",
    (event) => {
      if (!event.isPrimary || prefersStatic()) {
        return;
      }
      let rect: DOMRect | undefined;
      if (event.pointerType === "touch" && touchIntent !== "interacting") {
        if (touchIntent !== "pending" || !pressOrigin) {
          return;
        }
        const dx = Math.abs(event.clientX - pressOrigin[0]);
        const dy = Math.abs(event.clientY - pressOrigin[1]);
        draggedSincePress ||= Math.hypot(dx, dy) > CLICK_TRAVEL;
        if (Math.max(dx, dy) < TOUCH_MOVE_TRAVEL) {
          return;
        }
        if (dx <= dy) {
          touchIntent = "scrolling";
          return;
        }
        // The first deliberate horizontal movement starts the stroke at its
        // contact point. Vertical movement keeps native scrolling and never
        // acquires video or an animation loop for this touch.
        touchIntent = "interacting";
        rect = portraitCanvas.getBoundingClientRect();
        pressTarget = 0.78;
        hoverStage = clientToStage(pressOrigin[0], pressOrigin[1], rect);
        lastBrushStage = hoverStage;
        lastPointer = pressOrigin;
        pendingPoints.push(hoverStage);
      }
      rect ??= portraitCanvas.getBoundingClientRect();
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length > 0 ? samples : [event]) {
        const point: [number, number] = [sample.clientX, sample.clientY];
        if (
          pressOrigin &&
          Math.hypot(point[0] - pressOrigin[0], point[1] - pressOrigin[1]) > CLICK_TRAVEL
        ) {
          draggedSincePress = true;
        }
        if (lastPointer) {
          const travelled = Math.min(
            60,
            Math.hypot(point[0] - lastPointer[0], point[1] - lastPointer[1]),
          );
          // Movement during initial decoding must not become a catch-up jump.
          if (playback?.isReady()) scrub.move(travelled);
        }
        lastPointer = point;
        const stage = clientToStage(point[0], point[1], rect);
        if (pendingPoints.length === 0 && lastBrushStage) {
          pendingPoints.push(lastBrushStage);
        }
        pendingPoints.push(stage);
        lastBrushStage = stage;
        hoverStage = stage;
      }
      // Retain recent real path segments under extreme input rates; never
      // connect dropped bends with an invented straight line.
      if (pendingPoints.length > MAX_QUEUED_POINTS) {
        pendingPoints = pendingPoints.slice(-MAX_QUEUED_POINTS);
      }
      trailActiveUntil = performance.now() + TRAIL_ACTIVE_MS;
      ensurePlayback();
      ensureLoop();
    },
    { signal: abortController.signal },
  );
  pointerSurface.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button !== 0 || prefersStatic()) {
        return;
      }
      pressOrigin = [event.clientX, event.clientY];
      draggedSincePress = false;
      if (event.pointerType === "touch") {
        // A press may be a tap, a scroll, or a pinch. Only a horizontal
        // swipe should fetch the motion clip and disturb the print.
        touchIntent = "pending";
        return;
      }
      // Mouse and pen presses compress and plant the block immediately.
      touchIntent = undefined;
      pressTarget = 0.78;
      hoverStage = clientToStage(
        event.clientX,
        event.clientY,
        portraitCanvas.getBoundingClientRect(),
      );
      lastBrushStage = hoverStage;
      pendingPoints.push(hoverStage);
      ensurePlayback();
      trailActiveUntil = performance.now() + TRAIL_ACTIVE_MS;
      ensureLoop();
    },
    { signal: abortController.signal },
  );
  const releasePress = (event: PointerEvent) => {
    if (!event.isPrimary || prefersStatic()) {
      return;
    }
    if (event.pointerType === "touch" && touchIntent !== "interacting") {
      // A native scroll cancellation and an ordinary tap never disturbed the dots,
      // so neither needs the release pulse or a settling animation.
      draggedSincePress ||=
        event.type === "pointercancel" ||
        (pressOrigin !== undefined &&
          Math.hypot(event.clientX - pressOrigin[0], event.clientY - pressOrigin[1]) >
            CLICK_TRAVEL);
      pressOrigin = undefined;
      touchIntent = undefined;
      return;
    }
    touchIntent = undefined;
    // Releasing kicks the block briefly wider before it settles — the pulse.
    releaseKick = pressTarget === 1 ? 0 : 0.18;
    pressTarget = 1;
    if (event.pointerType === "touch" || event.type === "pointercancel") {
      hoverStage = undefined;
      lastBrushStage = undefined;
      lastPointer = undefined;
      if (event.type === "pointercancel") {
        pendingPoints = [];
        paintSmear?.lift();
      } else {
        finishStroke();
      }
    }
    if (event.type === "pointercancel") {
      draggedSincePress = true;
    }
    trailActiveUntil = performance.now() + TRAIL_ACTIVE_MS;
    ensureLoop();
  };
  pointerSurface.addEventListener("pointerup", releasePress, {
    signal: abortController.signal,
  });
  pointerSurface.addEventListener("pointercancel", releasePress, {
    signal: abortController.signal,
  });
  pointerSurface.addEventListener(
    "pointerleave",
    (event) => {
      if (event.pointerType === "touch" && touchIntent !== "interacting") {
        pressOrigin = undefined;
        touchIntent = undefined;
        return;
      }
      lastPointer = undefined;
      lastBrushStage = undefined;
      finishStroke();
      pressTarget = 1;
      // Let the displaced dots spring home.
      if (hoverStage) {
        hoverStage = undefined;
        trailActiveUntil = performance.now() + TRAIL_ACTIVE_MS;
        ensureLoop();
      }
    },
    { signal: abortController.signal },
  );
  pointerSurface.addEventListener(
    "click",
    (event) => {
      // Browsers emit click after a drag too. A deliberate click resets;
      // releasing a drag lets the dots spring back naturally.
      if (event.button !== 0 || draggedSincePress) {
        return;
      }
      resetPortrait();
    },
    { signal: abortController.signal },
  );
  pointerSurface.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        resetPortrait();
      }
    },
    { signal: abortController.signal },
  );
  portraitCanvas.addEventListener(
    "webglcontextlost",
    (event) => {
      if (unavailable || destroyed) return;
      event.preventDefault();
      markUnavailable();
      reportWebGLFailure();
    },
    { signal: abortController.signal },
  );
  document.addEventListener("visibilitychange", syncActivity, {
    signal: abortController.signal,
  });
  watchEnhancementPolicy(syncActivity, abortController.signal);
  document.addEventListener(
    "site:room-change",
    (event) => {
      roomActive = event.detail.room === "letter";
      if (!roomActive || event.detail.phase === "settled") syncActivity();
    },
    { signal: abortController.signal },
  );

  // Never reallocate mid-drag: rebuilding the backing store and framebuffer on
  // every resize step presents cleared frames as tearing. While the size is
  // changing, CSS scales the existing render (stable, briefly soft); one clean
  // reallocation and repaint happens once the size has settled.
  function scheduleResize() {
    window.clearTimeout(resizeSettleTimer);
    resizeSettleTimer = window.setTimeout(() => {
      if (!renderer || !roomActive || document.hidden) {
        return;
      }
      if (renderer.resize()) {
        renderer.render();
      }
    }, 150);
  }

  function watchPixelRatio() {
    if (destroyed) {
      return;
    }
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      "change",
      () => {
        scheduleResize();
        watchPixelRatio();
      },
      { once: true, signal: abortController.signal },
    );
  }

  window.addEventListener("resize", scheduleResize, {
    signal: abortController.signal,
  });
  watchPixelRatio();

  if ("ResizeObserver" in globalThis) {
    resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(portraitCanvas);
  }

  if ("IntersectionObserver" in globalThis) {
    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true;
        syncActivity();
      },
      { threshold: 0.05 },
    );
    intersectionObserver.observe(portraitFrame);
  }

  const controller: AboutPortraitController = {
    destroy() {
      destroyed = true;
      abortController.abort();
      window.clearTimeout(resizeSettleTimer);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      stopLoop();
      releasePlayback();
      renderer?.destroy();
      renderer = undefined;
      paintSmear = undefined;
      controllers.delete(root);
      activeControllers.delete(controller);
    },
  };

  controllers.set(root, controller);
  activeControllers.add(controller);
  syncActivity();

  return controller;
}

function initAboutPortraits(scope: ParentNode = document) {
  for (const root of getPortraitRoots(scope)) {
    if (!controllers.has(root) && root.querySelector("[data-enhancement-requested]")) {
      createPortraitController(root);
    }
  }
}

function destroyAboutPortraits(scope?: ParentNode) {
  if (scope) {
    for (const root of getPortraitRoots(scope)) {
      controllers.get(root)?.destroy();
    }
    return;
  }

  for (const controller of activeControllers) {
    controller.destroy();
  }
}

export function bindAboutPortraitLifecycle() {
  initAboutPortraits();

  if (lifecycleBound) {
    return;
  }

  lifecycleBound = true;
  window.addEventListener("pagehide", (event) => {
    // Cached rooms and BFCache pages retain their controllers for the return visit.
    if (!event.persisted) destroyAboutPortraits();
  });
}
