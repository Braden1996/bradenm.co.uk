// WebGL2 renderer for the original typogravure print. Adjacent photographic
// frames retain separate luma pyramids and exact endpoint ink. Between them,
// corresponding cells move and their ink is normalized by geometric support
// so overlaps cannot darken the print. The resulting carrier is cached.
// Per displayed frame: the cached carrier is composited, premultiplied, over
// a persistent smear layer. A small physics pass advances per-dot spring
// state so the brush parts the dark dots and lets them spring back into place.
import type { EnhancementTier } from "../../../components/lib/enhancement-policy";
import { MAX_BRUSH_SEGMENTS, type BrushSegment } from "../lib/about-brush-path";
import {
  BLOCK_FRAGMENT_SHADER,
  BLOCK_VERTEX_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
  LUMA_FRAGMENT_SHADER,
  NORMALIZED_PARTICLE_FRAGMENT_SHADER,
  NORMALIZE_FRAGMENT_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  PHYSICS_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "./typogravure-shaders";

export type TypogravureTextures = {
  atlas: TexImageSource;
  propSupport: TexImageSource;
  correspondence?: TexImageSource;
};

/** The brush footprint for one frame: where it swept and how wide. */
type TypogravureBrush = {
  /** Ordered pieces of the pointer path. */
  segments: readonly BrushSegment[];
  /** Scales the block radius — the press/release pulse. */
  scale: number;
};

/** A collage block the carrier prints behind the ink. */
export type TypogravureBlock = {
  /** The block's unique painted texture, straight-alpha RGBA at rect size. */
  paint: TexImageSource;
  /** Stage-space rect: left, top, width, height in stage px. */
  rect: readonly [number, number, number, number];
};

export type TypogravureRenderer = {
  /** Keep the context reusable when switching to the static motion policy. */
  destroy: (releaseContext?: boolean) => void;
  /**
   * True once the dot field has fully relaxed AND the rest print is cached.
   * Keyed to simulated physics time, not wall clock, so a throttled tab that
   * starves the loop still finishes its spring motion instead of freezing it.
   */
  isSettled: () => boolean;
  render: () => void;
  /** Return every dot to its original cell and clear the background smears. */
  reset: () => void;
  resize: () => boolean;
  /**
   * Advance the per-dot physics one frame. With no brush the field relaxes.
   */
  updatePhysics: (dtSeconds: number, brush?: TypogravureBrush) => void;
  /** Upload a changed 1440x800, top-left-origin background smear canvas. */
  uploadSmear: (source: TexImageSource) => void;
  uploadSource: (source: TexImageSource) => void;
  uploadPair: (sourceA: TexImageSource, sourceB: TexImageSource, pairIndex: number) => void;
  setInterpolation: (phase: number) => void;
};

// The canvas stage is wider than the portrait media and crops responsively.
const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 800;
// Media (packed video, luma, prop matte) stays 1200x800 and maps into the
// central band of the stage; the shaders hold the same 1440/1200 constants.
const MEDIA_WIDTH = 1200;
const MEDIA_HEIGHT = 800;
const PITCH_X = 3.6;
const PITCH_Y = 3.87;
const FRAMING = [1.03, -0.008, 0] as const;
const DETAIL_GAIN = 0.6;
const DETAIL_LEVELS = [2.1, 4.4, 6.1] as const;
// Keep the print recipe at a canonical resolution so resizing the portrait or
// changing DPR or enhancement tier cannot re-ink its marks. Both tiers share
// the same bounded carrier; only the final canvas follows device pixels.
const PRINT_PITCH = [PITCH_X * 0.4, PITCH_Y * 0.4] as const;
// One particle per halftone cell. Columns must match STATE_COLUMNS in the
// particle vertex shader: 1440 / 3.6 = 400 exactly; 800 / 3.87 rounds up to
// 207 rows (the last row is a partial cell, same as the fullscreen recipe).
const STATE_COLUMNS = 400;
const STATE_ROWS = 207;
const PARTICLE_COUNT = STATE_COLUMNS * STATE_ROWS;
// Source-specific confidence audit for portrait-packed.mp4 (48 frames).
// Re-audit these indices whenever the photographic source is replaced.
// These generated frame pairs disagree too strongly for reliable dot matching;
// retain their original sharp decoder boundary instead of inventing motion.
const SHARP_SOURCE_PAIRS = new Set([20, 23, 24, 25]);
// The brush footprint in stage pixels, with a readable minimum on screen.
const BLOCK_RADIUS = 22;
const MIN_BRUSH_CSS_RADIUS = 7;
const MAX_BRUSH_STAGE_RADIUS = 32;
// Rest state for both packed state textures: 16-bit fixed point encodes zero
// as exactly round(0.5 * 65534) = 32767 = (127, 255) across the byte pair.
const STATE_REST: [number, number, number, number] = [127 / 255, 1, 127 / 255, 1];
// This physical settle window outlasts the damped spring even after the
// largest impulse. It is simulated time, independent of tab throttling.
export const SETTLE_SECONDS = 2;

type PendingProgram = { program: WebGLProgram; shaders: WebGLShader[] };
type ParallelCompile = { COMPLETION_STATUS_KHR: number };
type ProgramContext = Pick<
  WebGL2RenderingContext,
  | "VERTEX_SHADER"
  | "FRAGMENT_SHADER"
  | "LINK_STATUS"
  | "isContextLost"
  | "shaderSource"
  | "compileShader"
  | "attachShader"
  | "detachShader"
  | "linkProgram"
  | "getProgramParameter"
  | "deleteProgram"
  | "deleteShader"
> & {
  // Keep allocation failure explicit even when a DOM declaration omits null.
  createShader: (type: number) => WebGLShader | null;
  createProgram: () => WebGLProgram | null;
  getExtension: (name: "KHR_parallel_shader_compile") => ParallelCompile | null;
};

const yieldInitialization = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function startProgram(gl: ProgramContext, vertexSource: string, fragmentSource: string) {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    return undefined;
  }
  gl.shaderSource(vertex, vertexSource);
  gl.shaderSource(fragment, fragmentSource);
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return { program, shaders: [vertex, fragment] };
}

async function completePrograms(
  gl: ProgramContext,
  programs: PendingProgram[],
  parallel: ParallelCompile | null,
  signal?: AbortSignal,
) {
  if (parallel) {
    const poll = (): Promise<void> => {
      if (
        signal?.aborted ||
        gl.isContextLost() ||
        programs.every(({ program }) =>
          gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR),
        )
      )
        return Promise.resolve();
      return new Promise<void>((resolve) => setTimeout(resolve, 16)).then(poll);
    };
    await poll();
  }
  for (const { program } of programs) {
    // Without completion polling, LINK_STATUS can block the main thread. Give
    // pending input and paint a chance between each program's driver work.
    // eslint-disable-next-line no-await-in-loop -- Status checks must run in separate tasks to avoid one blocking initialization task.
    if (!parallel) await yieldInitialization();
    if (signal?.aborted || gl.isContextLost() || !gl.getProgramParameter(program, gl.LINK_STATUS))
      return false;
  }
  return true;
}

export async function createPortraitPrograms(gl: ProgramContext, signal?: AbortSignal) {
  const parallel: ParallelCompile | null = gl.getExtension("KHR_parallel_shader_compile");
  const sources = [
    [VERTEX_SHADER, LUMA_FRAGMENT_SHADER],
    [PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER],
    [VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER],
    [VERTEX_SHADER, PHYSICS_FRAGMENT_SHADER],
    [BLOCK_VERTEX_SHADER, BLOCK_FRAGMENT_SHADER],
    [PARTICLE_VERTEX_SHADER, NORMALIZED_PARTICLE_FRAGMENT_SHADER],
    [VERTEX_SHADER, NORMALIZE_FRAGMENT_SHADER],
  ] as const;
  const programs: PendingProgram[] = [];
  let ready = false;
  try {
    for (const [vertex, fragment] of sources) {
      // Drivers with parallel compilation get the entire batch before polling.
      // Other drivers may compile synchronously, so split setup into tasks.
      // eslint-disable-next-line no-await-in-loop -- Each synchronous driver compilation must yield before the next program starts.
      if (!parallel) await yieldInitialization();
      if (signal?.aborted || gl.isContextLost()) return undefined;
      const pending = startProgram(gl, vertex, fragment);
      if (!pending) return undefined;
      programs.push(pending);
    }
    ready = await completePrograms(gl, programs, parallel, signal);
    return ready ? programs : undefined;
  } finally {
    for (const { program, shaders } of programs) {
      for (const shader of shaders) {
        gl.detachShader(program, shader);
        gl.deleteShader(shader);
      }
      if (!ready) gl.deleteProgram(program);
    }
  }
}

/** Preserve device-pixel backing while sharing one print resolution across tiers. */
export function portraitBackingSize(
  width: number,
  height: number,
  ratio: number,
  _tier: EnhancementTier,
) {
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
  const backingWidth = Math.max(1, Math.round(STAGE_WIDTH * scale * ratio));
  const backingHeight = Math.max(1, Math.round(STAGE_HEIGHT * scale * ratio));
  const carrierScale = 1.5;
  return {
    width: backingWidth,
    height: backingHeight,
    carrierWidth: STAGE_WIDTH * carrierScale,
    carrierHeight: STAGE_HEIGHT * carrierScale,
  };
}

function createTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  minFilter: number = gl.LINEAR,
  magFilter: number = gl.LINEAR,
) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  return texture;
}

export function getPortraitContext(canvas: HTMLCanvasElement) {
  return canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
    // Look-dev hook: ?portrait-debug makes canvas.toDataURL() capture real
    // pixels for A/B against the offline renderer.
    preserveDrawingBuffer: window.location.search.includes("portrait-debug"),
    stencil: false,
  });
}

export async function createTypogravureRenderer(
  canvas: HTMLCanvasElement,
  textures: TypogravureTextures,
  blocks: readonly TypogravureBlock[] = [],
  tier: EnhancementTier = "full",
  signal?: AbortSignal,
): Promise<TypogravureRenderer | undefined> {
  const context = getPortraitContext(canvas);
  if (!context) {
    return undefined;
  }
  return buildRenderer(canvas, context, textures, blocks, tier, signal);
}

async function buildRenderer(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  textures: TypogravureTextures,
  blocks: readonly TypogravureBlock[],
  tier: EnhancementTier,
  signal?: AbortSignal,
): Promise<TypogravureRenderer | undefined> {
  if (!gl.getExtension("EXT_color_buffer_float")) return undefined;
  gl.getExtension("EXT_float_blend");
  const programs = await createPortraitPrograms(gl, signal);
  if (!programs) return undefined;
  const [luma, particle, composite, physics, blockPass, accumulation, normalization] = programs;
  if (!luma || !particle || !composite || !physics || !blockPass) return undefined;
  if (!accumulation || !normalization) return undefined;

  const lumaProgram = luma.program;
  const particleProgram = particle.program;
  const compositeProgram = composite.program;
  const physicsProgram = physics.program;
  const blockProgram = blockPass.program;
  const accumulationProgram = accumulation.program;
  const normalizationProgram = normalization.program;

  const fullscreenArray = gl.createVertexArray();
  gl.bindVertexArray(fullscreenArray);
  const fullscreenBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Shared unit quad for the instanced dots; the instance id supplies the
  // cell, so no per-instance attributes are needed.
  const quadArray = gl.createVertexArray();
  gl.bindVertexArray(quadArray);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(fullscreenArray);

  // Unit 0: packed colour|matte source, refreshed per frame.
  const packedTexture = createTexture(gl, 0);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    MEDIA_WIDTH * 2,
    MEDIA_HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );

  // Unit 1: mipmapped luma of the colour half.
  const lumaTexture = createTexture(gl, 1, gl.LINEAR_MIPMAP_LINEAR);
  gl.texStorage2D(gl.TEXTURE_2D, 11, gl.R8, MEDIA_WIDTH, MEDIA_HEIGHT);
  const lumaFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lumaFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lumaTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Adjacent source B and its own complete luma pyramid. Never mix sources
  // before applying the original tone/detail recipe.
  const packedTextureB = createTexture(gl, 9);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    MEDIA_WIDTH * 2,
    MEDIA_HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  const lumaTextureB = createTexture(gl, 10, gl.LINEAR_MIPMAP_LINEAR);
  gl.texStorage2D(gl.TEXTURE_2D, 11, gl.R8, MEDIA_WIDTH, MEDIA_HEIGHT);
  const lumaFramebufferB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lumaFramebufferB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lumaTextureB, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const correspondenceTexture = createTexture(gl, 11, gl.NEAREST, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (textures.correspondence) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, textures.correspondence);
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
  }
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);

  // Unit 2: glyph atlas. Mipmapped for non-retina minification.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const atlasTexture = createTexture(gl, 2, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, textures.atlas);
  gl.generateMipmap(gl.TEXTURE_2D);

  // Unit 3: fixed prop-support matte.
  const propTexture = createTexture(gl, 3);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, textures.propSupport);

  // Allocate the bounded final carrier once, at the current settled CSS geometry.
  const portraitTexture = createTexture(gl, 4, gl.LINEAR_MIPMAP_LINEAR);
  const portraitFramebuffer = gl.createFramebuffer();
  const initialRect = canvas.getBoundingClientRect();
  const initialSize = portraitBackingSize(
    initialRect.width,
    initialRect.height,
    window.devicePixelRatio || 1,
    tier,
  );
  canvas.width = initialSize.width;
  canvas.height = initialSize.height;
  let carrierWidth = initialSize.carrierWidth;
  let carrierHeight = initialSize.carrierHeight;
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    carrierWidth,
    carrierHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, portraitFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, portraitTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Units 5-6: per-dot displacement and velocity, packed into core RGBA8 targets.
  function createStateTexture(unit: number) {
    const texture = createTexture(gl, unit, gl.NEAREST, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      STATE_COLUMNS,
      STATE_ROWS,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return texture;
  }
  function createStateTarget() {
    const position = createStateTexture(5);
    const velocity = createStateTexture(6);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, position, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocity, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, STATE_REST);
    gl.clearBufferfv(gl.COLOR, 1, STATE_REST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, position, velocity };
  }
  let stateRead = createStateTarget();
  let stateWrite = createStateTarget();

  function bindStateRead() {
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, stateRead.position);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, stateRead.velocity);
  }
  bindStateRead();

  // Unit 7: the blocks' painted textures — one per block, each a unique
  // non-tiled bake at rect size, rebound per draw. Mipmapped because the
  // carrier renders supersampled and minifies.
  const blockTextures = blocks.map((block) => {
    const texture = createTexture(gl, 7, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, block.paint);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  });

  // Unit 8: a fixed stage-space canvas, uploaded only when a smear changes.
  // Linear filtering needs no mip chain, including before the first upload.
  const smearTexture = createTexture(gl, 8);
  function clearSmear() {
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, smearTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      STAGE_WIDTH,
      STAGE_HEIGHT,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }
  clearSmear();

  const accumulatedInk = createTexture(gl, 12, gl.NEAREST, gl.NEAREST);
  const accumulatedSupport = createTexture(gl, 13, gl.NEAREST, gl.NEAREST);
  const fallbackA = createTexture(gl, 14, gl.NEAREST, gl.NEAREST);
  const fallbackB = createTexture(gl, 15, gl.NEAREST, gl.NEAREST);
  const accumulationFramebuffer = gl.createFramebuffer();
  const fallbackFramebufferA = gl.createFramebuffer();
  const fallbackFramebufferB = gl.createFramebuffer();
  function allocateInterpolationTargets() {
    for (const [unit, texture, format] of [
      [12, accumulatedInk, gl.RGBA16F],
      [13, accumulatedSupport, gl.R16F],
      [14, fallbackA, gl.RGBA8],
      [15, fallbackB, gl.RGBA8],
    ] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        format,
        carrierWidth,
        carrierHeight,
        0,
        format === gl.R16F ? gl.RED : gl.RGBA,
        format === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT,
        null,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumulationFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumulatedInk, 0);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D,
      accumulatedSupport,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Incomplete particle accumulation framebuffer");
    for (const [framebuffer, texture] of [
      [fallbackFramebufferA, fallbackA],
      [fallbackFramebufferB, fallbackB],
    ] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Incomplete portrait endpoint framebuffer");
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  allocateInterpolationTargets();

  gl.useProgram(lumaProgram);
  gl.uniform1i(gl.getUniformLocation(lumaProgram, "uPacked"), 0);

  gl.useProgram(particleProgram);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uPacked"), 0);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uLuma"), 1);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uAtlas"), 2);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uProp"), 3);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uPos"), 5);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uPackedB"), 9);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uLumaB"), 10);
  gl.uniform1i(gl.getUniformLocation(particleProgram, "uCorrespondence"), 11);
  const pairIndexLocation = gl.getUniformLocation(particleProgram, "uPairIndex");
  const pairEnabledLocation = gl.getUniformLocation(particleProgram, "uUsePair");
  const pairPhaseLocation = gl.getUniformLocation(particleProgram, "uPhase");
  const pairPassLocation = gl.getUniformLocation(particleProgram, "uPass");
  gl.uniform3f(gl.getUniformLocation(particleProgram, "uFraming"), ...FRAMING);
  gl.uniform1f(gl.getUniformLocation(particleProgram, "uDetailGain"), DETAIL_GAIN);
  gl.uniform3f(gl.getUniformLocation(particleProgram, "uDetailLevels"), ...DETAIL_LEVELS);
  const pitchLocation = gl.getUniformLocation(particleProgram, "uPitch");
  const pitchPerceivedLocation = gl.getUniformLocation(particleProgram, "uPitchPerceived");

  gl.useProgram(accumulationProgram);
  for (const [name, unit] of [
    ["uPacked", 0],
    ["uLuma", 1],
    ["uAtlas", 2],
    ["uProp", 3],
    ["uPos", 5],
    ["uPackedB", 9],
    ["uLumaB", 10],
    ["uCorrespondence", 11],
  ] as const)
    gl.uniform1i(gl.getUniformLocation(accumulationProgram, name), unit);
  gl.uniform3f(gl.getUniformLocation(accumulationProgram, "uFraming"), ...FRAMING);
  gl.uniform1f(gl.getUniformLocation(accumulationProgram, "uDetailGain"), DETAIL_GAIN);
  gl.uniform3f(gl.getUniformLocation(accumulationProgram, "uDetailLevels"), ...DETAIL_LEVELS);
  gl.useProgram(normalizationProgram);
  for (const [name, unit] of [
    ["uAccumulatedInk", 12],
    ["uAccumulatedSupport", 13],
    ["uFallbackA", 14],
    ["uFallbackB", 15],
  ] as const) {
    gl.uniform1i(gl.getUniformLocation(normalizationProgram, name), unit);
  }

  gl.useProgram(compositeProgram);
  gl.uniform1i(gl.getUniformLocation(compositeProgram, "uPortrait"), 4);
  gl.uniform1i(gl.getUniformLocation(compositeProgram, "uSmear"), 8);

  gl.useProgram(physicsProgram);
  gl.uniform1i(gl.getUniformLocation(physicsProgram, "uPos"), 5);
  gl.uniform1i(gl.getUniformLocation(physicsProgram, "uVel"), 6);
  const physicsDtLocation = gl.getUniformLocation(physicsProgram, "uDt");
  const physicsFrameDtLocation = gl.getUniformLocation(physicsProgram, "uFrameDt");
  const physicsSegmentLocation = gl.getUniformLocation(physicsProgram, "uSegments[0]");
  const physicsSegmentCountLocation = gl.getUniformLocation(physicsProgram, "uSegmentCount");
  const physicsWeightLocation = gl.getUniformLocation(physicsProgram, "uWeights[0]");
  const physicsBlockRadiusLocation = gl.getUniformLocation(physicsProgram, "uBlockRadius");
  const brushSegments = new Float32Array(MAX_BRUSH_SEGMENTS * 4);
  const brushWeights = new Float32Array(MAX_BRUSH_SEGMENTS);

  gl.useProgram(blockProgram);
  gl.uniform1i(gl.getUniformLocation(blockProgram, "uPacked"), 0);
  gl.uniform1i(gl.getUniformLocation(blockProgram, "uProp"), 3);
  gl.uniform1i(gl.getUniformLocation(blockProgram, "uPackedB"), 9);
  const blockPhaseLocation = gl.getUniformLocation(blockProgram, "uPhase");
  gl.uniform1i(gl.getUniformLocation(blockProgram, "uPaint"), 7);
  gl.uniform3f(gl.getUniformLocation(blockProgram, "uFraming"), ...FRAMING);
  const blockRectLocation = gl.getUniformLocation(blockProgram, "uRect");

  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  let hasSource = false;
  let hasPair = false;
  let pairIndex = 0;
  let interpolation = 0;
  let portraitDirty = false;
  let fallbackDirty = true;
  let destroyed = false;
  // CPU envelope of the physics settle: the carrier must re-print while any
  // dot can still be displaced, then once more to restore the rest print.
  let settleRemaining = 0;
  let brushRadius = BLOCK_RADIUS;

  // The brush keeps its readable CSS footprint independently of print density.
  function readBrushRadius() {
    const boxWidth = canvas.offsetWidth || 1;
    const boxHeight = canvas.offsetHeight || 1;
    const containScale = Math.min(boxWidth / STAGE_WIDTH, boxHeight / STAGE_HEIGHT);
    brushRadius = Math.min(
      MAX_BRUSH_STAGE_RADIUS,
      Math.max(BLOCK_RADIUS, MIN_BRUSH_CSS_RADIUS / containScale),
    );
  }

  function resize() {
    const rectangle = canvas.getBoundingClientRect();
    if (rectangle.width === 0 || rectangle.height === 0) {
      return false;
    }
    const size = portraitBackingSize(
      rectangle.width,
      rectangle.height,
      window.devicePixelRatio || 1,
      tier,
    );
    const {
      width,
      height,
      carrierWidth: targetCarrierWidth,
      carrierHeight: targetCarrierHeight,
    } = size;
    const sizeChanged =
      canvas.width !== width ||
      canvas.height !== height ||
      carrierWidth !== targetCarrierWidth ||
      carrierHeight !== targetCarrierHeight;
    if (sizeChanged) {
      canvas.width = width;
      canvas.height = height;
      carrierWidth = targetCarrierWidth;
      carrierHeight = targetCarrierHeight;
      allocateInterpolationTargets();
      fallbackDirty = true;
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, portraitTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        carrierWidth,
        carrierHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, portraitFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        portraitTexture,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    readBrushRadius();
    if (sizeChanged) {
      fallbackDirty = true;
      portraitDirty = true;
      return true;
    }
    return false;
  }

  function clearParticleState() {
    for (const state of [stateRead, stateWrite]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
      gl.clearBufferfv(gl.COLOR, 0, STATE_REST);
      gl.clearBufferfv(gl.COLOR, 1, STATE_REST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function updatePhysics(dtSeconds: number, brush?: TypogravureBrush) {
    if (destroyed || gl.isContextLost()) return;
    const dt = Math.min(Math.max(dtSeconds, 0.001), 0.05);
    const count = Math.min(brush?.segments.length ?? 0, MAX_BRUSH_SEGMENTS);
    const radius = brush ? brushRadius * brush.scale : 0;
    gl.bindVertexArray(fullscreenArray);
    gl.disable(gl.BLEND);
    gl.useProgram(physicsProgram);
    gl.uniform1f(physicsFrameDtLocation, dt);
    gl.uniform1i(physicsSegmentCountLocation, count);
    gl.uniform1f(physicsBlockRadiusLocation, radius);
    for (let index = 0; index < count; index += 1) {
      const segment = brush?.segments[index];
      if (!segment) continue;
      brushSegments.set(segment.segment, index * 4);
      brushWeights[index] = segment.weight;
    }
    gl.uniform4fv(physicsSegmentLocation, brushSegments);
    gl.uniform1fv(physicsWeightLocation, brushWeights);

    // Semi-implicit springs stay stable at low display rates. Shorter steps
    // share frame velocity and use time-normalised brush contact.
    const steps = Math.ceil(dt / (1 / 120));
    gl.uniform1f(physicsDtLocation, dt / steps);
    gl.viewport(0, 0, STATE_COLUMNS, STATE_ROWS);
    for (let step = 0; step < steps; step += 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateWrite.framebuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const swap = stateRead;
      stateRead = stateWrite;
      stateWrite = swap;
      bindStateRead();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const wasLive = settleRemaining > 0;
    settleRemaining = count > 0 ? SETTLE_SECONDS : Math.max(0, settleRemaining - dt);
    if (settleRemaining > 0 || wasLive) {
      portraitDirty = true;
      fallbackDirty = true;
    }
    if (wasLive && settleRemaining === 0) clearParticleState();
  }

  function isSettled() {
    return settleRemaining <= 0 && !portraitDirty;
  }

  function reset() {
    if (destroyed || gl.isContextLost()) return;
    clearParticleState();
    clearSmear();
    fallbackDirty = true;
    settleRemaining = 0;
    portraitDirty = true;
    render();
  }

  function uploadSmear(source: TexImageSource) {
    if (destroyed || gl.isContextLost()) return;
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, smearTexture);
    // Keep canvas rows in their native order; the composite flips its UV.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function uploadFrame(source: TexImageSource, endpoint: 0 | 1) {
    const packedUnit = endpoint === 0 ? 0 : 9;
    const lumaUnit = endpoint === 0 ? 1 : 10;
    const packedTarget = endpoint === 0 ? packedTexture : packedTextureB;
    const lumaTarget = endpoint === 0 ? lumaTexture : lumaTextureB;
    const framebuffer = endpoint === 0 ? lumaFramebuffer : lumaFramebufferB;
    gl.activeTexture(gl.TEXTURE0 + packedUnit);
    gl.bindTexture(gl.TEXTURE_2D, packedTarget);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, MEDIA_WIDTH, MEDIA_HEIGHT);
    gl.useProgram(lumaProgram);
    gl.uniform1i(gl.getUniformLocation(lumaProgram, "uPacked"), packedUnit);
    gl.bindVertexArray(fullscreenArray);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0 + lumaUnit);
    gl.bindTexture(gl.TEXTURE_2D, lumaTarget);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function uploadSource(source: TexImageSource) {
    if (destroyed || gl.isContextLost()) return;
    fallbackDirty = true;
    uploadFrame(source, 0);
    uploadFrame(source, 1);
    hasSource = true;
    hasPair = false;
    interpolation = 0;
    portraitDirty = true;
  }

  function uploadPair(sourceA: TexImageSource, sourceB: TexImageSource, index: number) {
    if (destroyed || gl.isContextLost()) return;
    if (!textures.correspondence)
      throw new Error("Adjacent frames require the correspondence atlas");
    if (!Number.isInteger(index) || index < 0 || index >= 48)
      throw new RangeError("Invalid portrait pair index");
    fallbackDirty = true;
    uploadFrame(sourceA, 0);
    uploadFrame(sourceB, 1);
    pairIndex = index;
    interpolation = 0;
    hasSource = true;
    hasPair = true;
    portraitDirty = true;
  }

  function setInterpolation(phase: number) {
    if (destroyed || gl.isContextLost()) return;
    if (!Number.isFinite(phase)) throw new RangeError("Invalid portrait interpolation phase");
    // Briefly bridge intact source prints, moving all dots and their ink
    // together instead of dissolving separate patches at different times.
    const transition = Math.max(0, Math.min(1, (phase - 0.3) / 0.4));
    const next = transition * transition * (3 - 2 * transition);
    if (next === interpolation) return;
    interpolation = next;
    portraitDirty = true;
  }

  function setParticleUniforms(program: WebGLProgram, mode: number, phase: number, pass: number) {
    gl.useProgram(program);
    gl.uniform2f(
      gl.getUniformLocation(program, "uPitch"),
      (PITCH_X * carrierWidth) / STAGE_WIDTH,
      (PITCH_Y * carrierHeight) / STAGE_HEIGHT,
    );
    gl.uniform2f(gl.getUniformLocation(program, "uPitchPerceived"), ...PRINT_PITCH);
    gl.uniform1i(gl.getUniformLocation(program, "uPairIndex"), pairIndex);
    gl.uniform1i(gl.getUniformLocation(program, "uUsePair"), mode);
    gl.uniform1f(gl.getUniformLocation(program, "uPhase"), phase);
    gl.uniform1i(gl.getUniformLocation(program, "uPass"), pass);
  }
  function accumulateInterpolatedInk() {
    gl.bindVertexArray(quadArray);
    gl.viewport(0, 0, carrierWidth, carrierHeight);
    gl.enable(gl.BLEND);
    if (fallbackDirty) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const [framebuffer, mode] of [
        [fallbackFramebufferA, 0],
        [fallbackFramebufferB, 2],
      ] as const) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
        setParticleUniforms(particleProgram, mode, 0, 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, PARTICLE_COUNT);
      }
      fallbackDirty = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumulationFramebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE);
    setParticleUniforms(accumulationProgram, 1, interpolation, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, PARTICLE_COUNT);
    gl.uniform1i(gl.getUniformLocation(accumulationProgram, "uPass"), 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, PARTICLE_COUNT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
  }

  function renderPortraitPass() {
    const phase =
      hasPair && SHARP_SOURCE_PAIRS.has(pairIndex) ? (interpolation < 0.5 ? 0 : 1) : interpolation;
    const normalized = hasPair && phase > 0 && phase < 1;
    if (normalized) accumulateInterpolatedInk();
    gl.bindFramebuffer(gl.FRAMEBUFFER, portraitFramebuffer);
    gl.viewport(0, 0, carrierWidth, carrierHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(quadArray);
    // Everything in the carrier is premultiplied ink; overlaps (dots shoved
    // onto one another, ink over the blocks) composite like wet ink rather
    // than adding to black.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (blocks.length > 0) {
      // Authored collage first; its original cut-out still follows the footage.
      gl.useProgram(blockProgram);
      gl.uniform1f(blockPhaseLocation, hasPair ? phase : 0);
      gl.activeTexture(gl.TEXTURE7);
      for (const [index, block] of blocks.entries()) {
        gl.bindTexture(gl.TEXTURE_2D, blockTextures[index] ?? null);
        gl.uniform4f(blockRectLocation, ...block.rect);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    if (normalized) {
      gl.bindVertexArray(fullscreenArray);
      gl.useProgram(normalizationProgram);
      gl.uniform1f(gl.getUniformLocation(normalizationProgram, "uPhase"), phase);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.useProgram(particleProgram);
      gl.uniform2f(
        pitchLocation,
        (PITCH_X * carrierWidth) / STAGE_WIDTH,
        (PITCH_Y * carrierHeight) / STAGE_HEIGHT,
      );
      gl.uniform2f(pitchPerceivedLocation, ...PRINT_PITCH);
      gl.uniform1i(pairIndexLocation, pairIndex);
      gl.uniform1i(pairEnabledLocation, hasPair ? (phase === 1 ? 2 : 1) : 0);
      gl.uniform1f(pairPhaseLocation, phase);
      gl.uniform1i(pairPassLocation, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, PARTICLE_COUNT);
      if (hasPair && phase > 0 && phase < 1) {
        gl.uniform1i(pairPassLocation, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, PARTICLE_COUNT);
      }
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(fullscreenArray);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, portraitTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
    portraitDirty = false;
  }

  function render() {
    if (destroyed || !hasSource || gl.isContextLost()) {
      return;
    }
    if (portraitDirty) {
      renderPortraitPass();
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(compositeProgram);
    gl.bindVertexArray(fullscreenArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy(releaseContext = true) {
    if (destroyed) {
      return;
    }
    destroyed = true;
    gl.deleteTexture(packedTexture);
    gl.deleteTexture(lumaTexture);
    gl.deleteTexture(packedTextureB);
    gl.deleteTexture(lumaTextureB);
    gl.deleteTexture(correspondenceTexture);
    for (const texture of [accumulatedInk, accumulatedSupport, fallbackA, fallbackB])
      gl.deleteTexture(texture);
    gl.deleteTexture(atlasTexture);
    gl.deleteTexture(propTexture);
    gl.deleteTexture(portraitTexture);
    gl.deleteTexture(smearTexture);
    gl.deleteTexture(stateRead.position);
    gl.deleteTexture(stateRead.velocity);
    gl.deleteTexture(stateWrite.position);
    gl.deleteTexture(stateWrite.velocity);
    for (const texture of blockTextures) {
      gl.deleteTexture(texture);
    }
    gl.deleteFramebuffer(lumaFramebuffer);
    gl.deleteFramebuffer(lumaFramebufferB);
    for (const framebuffer of [accumulationFramebuffer, fallbackFramebufferA, fallbackFramebufferB])
      gl.deleteFramebuffer(framebuffer);
    gl.deleteFramebuffer(portraitFramebuffer);
    gl.deleteFramebuffer(stateRead.framebuffer);
    gl.deleteFramebuffer(stateWrite.framebuffer);
    gl.deleteProgram(lumaProgram);
    gl.deleteProgram(particleProgram);
    gl.deleteProgram(compositeProgram);
    gl.deleteProgram(physicsProgram);
    gl.deleteProgram(blockProgram);
    gl.deleteProgram(accumulationProgram);
    gl.deleteProgram(normalizationProgram);
    gl.deleteBuffer(fullscreenBuffer);
    gl.deleteBuffer(quadBuffer);
    gl.deleteVertexArray(fullscreenArray);
    gl.deleteVertexArray(quadArray);
    if (releaseContext) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }

  return {
    destroy,
    isSettled,
    render,
    reset,
    resize,
    updatePhysics,
    uploadSmear,
    uploadSource,
    uploadPair,
    setInterpolation,
  };
}
