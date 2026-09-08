import {
  readEnhancementTier,
  watchEnhancementPolicy,
} from "../../../components/lib/enhancement-policy";
import {
  advanceSignatureDogMotion,
  signatureDogGaze,
  signatureDogFrame,
  type DogGaze,
} from "../lib/signature-dog";
import {
  createSignatureDogVertices,
  decodeSignatureDogMotion,
  signatureDogVertices,
} from "../lib/signature-dog-morph";
import { createSignatureDogMesh } from "./signature-dog-mesh";

const BUTTON = "[data-signature-dog]";
const LYING_POSE = 6;
const controllers = new Map<HTMLButtonElement, () => void>();
let bound = false;

type DogPose = "seated" | "transition" | "lying";

function bindDog(button: HTMLButtonElement) {
  const element = button.querySelector<HTMLCanvasElement>("[data-dog-canvas]");
  if (!element) {
    return;
  }

  const canvas = element;
  let painter: CanvasRenderingContext2D | null | undefined;
  const events = new AbortController();
  let tier = readEnhancementTier();
  let roomActive = !button.closest("[inert]");
  const hoverPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const configuredRadius = Number(button.dataset.dogRadius);
  const radius = configuredRadius > 0 ? configuredRadius : 180;
  const atlases = {
    seated: button.dataset.dogSeated ?? "/about/signature/dog-seated.webp",
    lying: button.dataset.dogLying ?? "/about/signature/dog-lying.webp",
    transition: button.dataset.dogTransition ?? "/about/signature/dog-sprites.webp",
  };
  const images = { seated: new Image(), lying: new Image(), transition: new Image() };
  const ready = new Set<DogPose>();
  const vertices = createSignatureDogVertices();
  let motion: Int16Array | undefined;
  let mesh: ReturnType<typeof createSignatureDogMesh>;
  let meshAttempted = false;
  let visible = false;
  const started = new Set<DogPose>();
  let motionStarted = false;
  let assetsFailed = false;
  let pose = button.getAttribute("aria-pressed") === "true" ? LYING_POSE : 0;
  let targetPose = pose;
  let gaze: DogGaze = { column: 1, row: 2 };
  let targetGaze: DogGaze = { column: 1, row: 2 };
  let drawnGaze: DogGaze = { column: 1, row: 2 };
  let drawnPose = -1;
  let pointer: { x: number; y: number } | undefined;
  let pointerDirty = false;
  let frame = 0;
  let previousTime = 0;

  function canMove() {
    return (
      !assetsFailed &&
      visible &&
      roomActive &&
      !document.hidden &&
      tier !== "static" &&
      !button.closest("[inert]")
    );
  }

  function setState() {
    button.dataset.dogStaticPose = pose === LYING_POSE ? "lying" : "seated";
    button.dataset.dogPose = pose === 0 ? "seated" : pose === LYING_POSE ? "lying" : "transition";
    button.dataset.dogReady = ready.size === 3 ? "true" : "false";
    button.dataset.dogProgress = pose.toFixed(3);
    button.dataset.dogYaw = gaze.column.toFixed(3);
    button.dataset.dogPitch = gaze.row.toFixed(3);
    button.dataset.dogState =
      pose === targetPose
        ? pose === 0
          ? "seated"
          : "lying"
        : targetPose === LYING_POSE
          ? "lowering"
          : "rising";
    button.setAttribute("aria-pressed", targetPose === LYING_POSE ? "true" : "false");
    button.setAttribute(
      "aria-label",
      targetPose === LYING_POSE ? "Ask the dog to sit up" : "Ask the dog to lie down",
    );
  }

  function drawTile(dogPose: DogPose, column: number, row: number) {
    const image = images[dogPose];
    const columns = dogPose === "transition" ? 5 : 7;
    const rows = dogPose === "transition" ? 3 : 5;
    const width = image.naturalWidth / columns;
    const height = image.naturalHeight / rows;

    painter?.drawImage(
      image,
      column * width,
      row * height,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  function drawPose(index: number) {
    if (mesh && motion) {
      signatureDogVertices(vertices, motion, pose, index, gaze, drawnGaze);
      const transitioning = index > 0 && index < LYING_POSE;
      const drawn = mesh.draw(
        transitioning ? 2 : index === 0 ? 0 : 1,
        transitioning ? index - 1 : drawnGaze.column,
        transitioning ? 1 : drawnGaze.row,
        transitioning ? 5 : 7,
        transitioning ? 3 : 5,
        vertices,
      );
      if (drawn) {
        painter?.drawImage(mesh.canvas, 0, 0);
        button.dataset.dogRender = "mesh";
        return;
      }
    }
    button.dataset.dogRender = "sprites";
    if (index > 0 && index < LYING_POSE) {
      drawTile("transition", index - 1, 1);
      return;
    }

    const dogPose = index === 0 ? "seated" : "lying";
    drawTile(dogPose, drawnGaze.column, drawnGaze.row);
  }

  function poseReady() {
    if (pose !== targetPose) return ready.size === 3;
    return ready.has(pose === LYING_POSE ? "lying" : "seated");
  }

  function paint() {
    if (tier === "static" || !poseReady() || !roomActive || document.hidden || !visible) {
      delete button.dataset.dogCanvas;
      return;
    }

    painter ??= canvas.getContext("2d");
    if (!painter) return;
    const nextGaze = signatureDogFrame(gaze, drawnGaze);
    const nextPose = Math.round(pose);
    if (
      !mesh &&
      drawnPose === nextPose &&
      nextGaze.column === drawnGaze.column &&
      nextGaze.row === drawnGaze.row &&
      button.dataset.dogCanvas === "ready"
    )
      return;

    drawnGaze = nextGaze;
    drawnPose = nextPose;
    painter.clearRect(0, 0, canvas.width, canvas.height);
    // Move one complete drawing through its intermediate geometry. Never
    // superimpose heads: that creates doubled eyes, noses, and fur.
    drawPose(drawnPose);
    button.dataset.dogFrameColumn = String(drawnGaze.column);
    button.dataset.dogFrameRow = String(drawnGaze.row);
    button.dataset.dogCanvas = "ready";
  }

  function moving() {
    return pose !== targetPose || gaze.column !== targetGaze.column || gaze.row !== targetGaze.row;
  }

  function updateTargetGaze() {
    pointerDirty = false;
    if (!pointer) {
      targetGaze = { column: 1, row: 2 };
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const lowered = pose / LYING_POSE;
    // Eye-line centres measured in the registered 300 x 360 artwork:
    // seated (150, 111), lying (129, 195). Depth scales with the drawn head,
    // independently of the circle in which the dog notices the cursor.
    const headX = rect.left + rect.width * ((150 - lowered * 21) / 300);
    const headY = rect.top + rect.height * ((111 + lowered * 84) / 360);
    const headDepth = Math.max(1, rect.width * 0.3);
    targetGaze = signatureDogGaze(pointer.x - headX, pointer.y - headY, radius, headDepth);
  }

  function suspend() {
    cancelAnimationFrame(frame);
    frame = 0;
    pointer = undefined;
    pointerDirty = false;
    gaze = { column: 1, row: 2 };
    targetGaze = gaze;
    pose = targetPose;
    setState();
    paint();
  }

  function tick(now: number) {
    frame = 0;
    if (!canMove()) {
      suspend();
      return;
    }

    if (tier === "light" && now - previousTime < 1000 / 30 - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const elapsed = Math.min(50, Math.max(0, now - previousTime));
    previousTime = now;
    const previousPose = pose;
    const previousGaze = gaze;
    if (pointerDirty) {
      updateTargetGaze();
    }
    const next = advanceSignatureDogMotion(pose, targetPose, gaze, targetGaze, elapsed);
    pose = next.pose;
    gaze = next.gaze;
    if (previousPose !== pose) {
      updateTargetGaze();
    }
    if (
      pose !== previousPose ||
      gaze.column !== previousGaze.column ||
      gaze.row !== previousGaze.row ||
      button.dataset.dogCanvas !== "ready"
    ) {
      setState();
      paint();
    }

    if (moving()) {
      frame = requestAnimationFrame(tick);
    }
  }

  function wake() {
    if (!poseReady()) {
      return;
    }
    if (!canMove()) {
      suspend();
      return;
    }
    prepareMesh();
    if (!frame && (moving() || pointerDirty)) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!frame && button.dataset.dogCanvas !== "ready") {
      paint();
    }
  }

  function returnGaze() {
    pointer = undefined;
    pointerDirty = false;
    targetGaze = { column: 1, row: 2 };
    wake();
  }

  function preloadAtlas(dogPose: DogPose) {
    if (started.has(dogPose) || tier === "static") return;
    started.add(dogPose);
    const image = images[dogPose];
    image.decoding = "async";
    image.src = atlases[dogPose];
    void image.decode().then(
      () => {
        if (!events.signal.aborted) {
          ready.add(dogPose);
          prepareMesh();
          setState();
          wake();
        }
        return undefined;
      },
      () => {
        if (!events.signal.aborted) {
          assetsFailed = true;
          pose = targetPose;
          setState();
          delete button.dataset.dogCanvas;
        }
        return undefined;
      },
    );
  }

  function prepareMesh() {
    if (tier !== "full" || !canMove() || meshAttempted || ready.size !== 3 || !motion) return;
    meshAttempted = true;
    mesh = createSignatureDogMesh([images.seated, images.lying, images.transition]);
    if (mesh) {
      drawnPose = -1;
      paint();
    }
  }

  function preloadMotion() {
    const url = button.dataset.dogMotion;
    if (!url || tier !== "full" || motionStarted) return;
    motionStarted = true;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    void image
      .decode()
      .then(() => {
        if (
          events.signal.aborted ||
          tier !== "full" ||
          image.naturalWidth !== 512 ||
          image.naturalHeight !== 455
        )
          return undefined;
        const surface = document.createElement("canvas");
        surface.width = image.naturalWidth;
        surface.height = image.naturalHeight;
        const reader = surface.getContext("2d", { willReadFrequently: true });
        if (!reader) return undefined;
        reader.drawImage(image, 0, 0);
        motion = decodeSignatureDogMotion(
          reader.getImageData(0, 0, surface.width, surface.height).data,
        );
        prepareMesh();
        return undefined;
      })
      .catch(() => {
        // Missing motion data keeps the decoded sharp-sprite fallback usable.
      });
  }

  function preparePose() {
    if (document.hidden || tier === "static" || assetsFailed) return;
    preloadAtlas("seated");
    preloadAtlas("transition");
    preloadAtlas("lying");
    preloadMotion();
  }

  const observer = new IntersectionObserver((entries) => {
    visible = entries.at(-1)?.isIntersecting ?? false;
    if (visible) {
      wake();
    } else {
      suspend();
    }
  });
  observer.observe(button);

  // Keep keyboard focus for navigation while showing its marker only during
  // keyboard use. Resuming pointer tracking should not leave that marker behind.
  button.addEventListener(
    "pointerdown",
    () => {
      button.dataset.dogPointerFocus = "";
    },
    { signal: events.signal },
  );
  const clearPointerFocus = () => {
    delete button.dataset.dogPointerFocus;
  };
  button.addEventListener("keydown", clearPointerFocus, { signal: events.signal });
  button.addEventListener("blur", clearPointerFocus, { signal: events.signal });
  button.addEventListener(
    "focus",
    () => {
      if (!document.hidden && roomActive && !assetsFailed) {
        preloadAtlas(pose === LYING_POSE ? "lying" : "seated");
      }
    },
    { signal: events.signal },
  );
  button.addEventListener(
    "click",
    () => {
      // Keyboard and reduced-motion presses work even before an observer's
      // first delivery; the requested pose waits for its drawings to decode.
      preparePose();
      targetPose = targetPose === 0 ? LYING_POSE : 0;
      if (tier === "static" || assetsFailed) pose = targetPose;
      setState();
      wake();
    },
    { signal: events.signal },
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (document.activeElement === button) {
        button.dataset.dogPointerFocus = "";
      }
      if (event.pointerType === "touch" || !canMove()) {
        return;
      }
      if (!ready.has(pose === LYING_POSE ? "lying" : "seated")) {
        const rect = canvas.getBoundingClientRect();
        if (
          Math.hypot(
            event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2,
          ) > radius
        )
          return;
        preloadAtlas(pose === LYING_POSE ? "lying" : "seated");
      }
      pointer = { x: event.clientX, y: event.clientY };
      pointerDirty = true;
      wake();
    },
    { passive: true, signal: events.signal },
  );
  document.addEventListener("pointerleave", returnGaze, { signal: events.signal });
  window.addEventListener("pointercancel", returnGaze, { signal: events.signal });
  window.addEventListener("blur", returnGaze, { signal: events.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        suspend();
      } else if (visible) {
        wake();
      }
    },
    { signal: events.signal },
  );
  watchEnhancementPolicy(() => {
    tier = readEnhancementTier();
    if (tier !== "full") {
      mesh?.destroy();
      mesh = undefined;
      meshAttempted = false;
      motion = undefined;
      motionStarted = false;
    }
    suspend();
  }, events.signal);
  document.addEventListener(
    "site:room-change",
    (event) => {
      roomActive = event.detail.room === "letter";
      if (!roomActive) suspend();
      else if (event.detail.phase === "settled") wake();
    },
    { signal: events.signal },
  );
  hoverPointer.addEventListener(
    "change",
    () => {
      if (!hoverPointer.matches) returnGaze();
    },
    { signal: events.signal },
  );

  setState();
  controllers.set(button, () => {
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    mesh?.destroy();
  });
}

function initialize() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(BUTTON)) {
    if (!controllers.has(button)) {
      bindDog(button);
    }
  }
}

/** Safe to call from a bundled Astro component on initial load and navigation. */
export function bindSignatureDogLifecycle() {
  initialize();
  if (bound) {
    return;
  }
  bound = true;

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    for (const destroy of controllers.values()) {
      destroy();
    }
    controllers.clear();
  });
}
