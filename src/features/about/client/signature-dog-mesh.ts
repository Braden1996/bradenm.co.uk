const COLUMNS = 16;
const ROWS = 19;
const VERTICES = COLUMNS * ROWS;

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aUv;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPosition.x * 2.0 - 1.0, 1.0 - aPosition.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec4 uTile;
uniform vec2 uInset;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 uv = clamp(uTile.xy + vUv * uTile.zw,
    uTile.xy + uInset, uTile.xy + uTile.zw - uInset);
  outColor = texture(uImage, uv);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return undefined;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return undefined;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return undefined;
  }
  const program = gl.createProgram();
  if (program) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!program) return undefined;
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return undefined;
  }
  return program;
}

/** Render one cel through a shared triangle mesh, then copy canvas immediately. */
export function createSignatureDogMesh(images: readonly HTMLImageElement[]) {
  if (!images.length || images.some((image) => !image.naturalWidth || !image.naturalHeight)) {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 360;
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (!context) {
    reportWebGLFailure();
    return undefined;
  }
  const gl = context;

  const program = createProgram(gl);
  const positionsBuffer = gl.createBuffer();
  const textureBuffer = gl.createBuffer();
  const indicesBuffer = gl.createBuffer();
  const textures: WebGLTexture[] = [];
  let destroyed = false;

  canvas.addEventListener("webglcontextlost", (event) => {
    // Deliberate disposal also loses the context; only report a live failure.
    if (destroyed) return;
    event.preventDefault();
    reportWebGLFailure();
  });

  function destroy() {
    if (destroyed) return;
    const contextWasLost = gl.isContextLost();
    destroyed = true;
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteBuffer(positionsBuffer);
    gl.deleteBuffer(textureBuffer);
    gl.deleteBuffer(indicesBuffer);
    gl.deleteProgram(program ?? null);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (contextWasLost) reportWebGLFailure();
  }

  if (!program || !positionsBuffer || !textureBuffer || !indicesBuffer) {
    destroy();
    return undefined;
  }
  const position = gl.getAttribLocation(program, "aPosition");
  const uv = gl.getAttribLocation(program, "aUv");
  const tile = gl.getUniformLocation(program, "uTile");
  const inset = gl.getUniformLocation(program, "uInset");
  const sampler = gl.getUniformLocation(program, "uImage");
  if (position < 0 || uv < 0 || !tile || !inset || !sampler) {
    destroy();
    return undefined;
  }

  const coordinates = new Float32Array(VERTICES * 2);
  const indices = new Uint16Array((COLUMNS - 1) * (ROWS - 1) * 6);
  let index = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const vertex = row * COLUMNS + column;
      coordinates[vertex * 2] = column / (COLUMNS - 1);
      coordinates[vertex * 2 + 1] = row / (ROWS - 1);
      if (column === COLUMNS - 1 || row === ROWS - 1) continue;
      indices[index++] = vertex;
      indices[index++] = vertex + 1;
      indices[index++] = vertex + COLUMNS;
      indices[index++] = vertex + 1;
      indices[index++] = vertex + COLUMNS + 1;
      indices[index++] = vertex + COLUMNS;
    }
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionsBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, coordinates.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, coordinates, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(sampler, 0);
  // Both the texture and drawing buffer contain premultiplied colour. Shared
  // triangle edges rasterize once, preserving translucent watercolor ink.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  for (const image of images) {
    const texture = gl.createTexture();
    if (!texture) {
      destroy();
      return undefined;
    }
    textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch {
      destroy();
      return undefined;
    }
  }
  if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
    destroy();
    return undefined;
  }
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DITHER);
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);

  function draw(
    imageIndex: number,
    column: number,
    row: number,
    columns: number,
    rows: number,
    positions: Float32Array,
  ) {
    const image = images[imageIndex];
    const texture = textures[imageIndex];
    if (
      destroyed ||
      gl.isContextLost() ||
      !image ||
      !texture ||
      positions.length !== VERTICES * 2 ||
      columns <= 0 ||
      rows <= 0 ||
      column < 0 ||
      column >= columns ||
      row < 0 ||
      row >= rows
    )
      return false;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionsBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(tile, column / columns, row / rows, 1 / columns, 1 / rows);
    gl.uniform2f(inset, 0.5 / image.naturalWidth, 0.5 / image.naturalHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    return !gl.isContextLost();
  }

  return { canvas, draw, destroy };
}
import { reportWebGLFailure } from "../../../components/lib/enhancement-policy";
