// cspell:words uvec

import { MAX_BRUSH_SEGMENTS } from "../lib/about-brush-path";

// GLSL shared by the live typogravure portrait and its poster bake. Per-pixel
// tone modulation (uDetailGain) preserves sub-cell detail such as teeth, beard
// strands and fabric folds in the printed marks. The detail fields use mip
// levels of a dedicated luma texture regenerated when the source frame changes.
//
// The carrier is drawn as ~83k instanced quads — one rigid dot per halftone
// cell — so the cursor can stir the dots as physical particles (spring +
// velocity state on the GPU) without ever bending a glyph. At rest every dot
// sits exactly at its home cell, which keeps the printed output equal to the
// original fullscreen-fragment recipe.

// 16-bit fixed point split across two 8-bit channels, so particle state fits
// core-WebGL2 RGBA8 render targets (no float-target extension). The 65534
// scale is even, so zero encodes exactly: a resting particle round-trips to
// precisely zero displacement and velocity.
const PACKING_GLSL = `
const float D_RANGE = 96.0;
const float V_RANGE = 900.0;

vec2 pack16(float value, float range) {
  float scaled = round(clamp(value / (2.0 * range) + 0.5, 0.0, 1.0) * 65534.0);
  float hi = floor(scaled / 256.0);
  return vec2(hi, scaled - hi * 256.0) / 255.0;
}

float unpack16(vec2 bytes, float range) {
  float scaled = bytes.x * 255.0 * 256.0 + bytes.y * 255.0;
  return (scaled / 65534.0 - 0.5) * 2.0 * range;
}
`;

// Stage-to-matte plumbing shared by every pass that must agree on where the
// subject is: the mark recipe below AND the block pass, whose rectangles the
// live matte occludes. One chunk, so their registration can never drift.
const MATTE_GLSL = `
// The canvas stage (1440x800) is wider than the media (1200x800); the portrait
// media sits in the central band.
const float STAGE_TO_MEDIA_SCALE = 1440.0 / 1200.0;
const float STAGE_TO_MEDIA_OFFSET = -120.0 / 1200.0;

// Stage uv (top-left origin) to source uv in the colour half of uPacked.
vec2 stageToSource(vec2 stageUv) {
  vec2 mediaUv = vec2(stageUv.x * STAGE_TO_MEDIA_SCALE + STAGE_TO_MEDIA_OFFSET, stageUv.y);
  return (mediaUv - 0.5) / uFraming.x + 0.5 + uFraming.yz;
}

float matteAt(vec2 sourceUv) {
  vec2 clamped = clamp(sourceUv, vec2(0.001), vec2(0.999));
  float dynamic = texture(uPacked, vec2(0.5 + clamped.x * 0.5, clamped.y)).r;
  float support = texture(uProp, clamped).r;
  return smoothstep(0.04, 0.92, max(dynamic, support));
}
`;

// Mark recipe shared by the particle vertex pass (per-cell values) and the
// particle fragment pass (per-pixel values). Kept as one chunk so the two
// stages can never drift apart.
const MARK_MATH_GLSL = `
${MATTE_GLSL}
float hash12(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Per-frame exposure normalization: the loop's frames drift ~2% in mean luma,
// which the steep tone curve amplifies into visible flicker while scrubbing.
// The top mip of the luma pyramid IS the frame mean; scale toward the poster
// frame's mean (0.378) so every frame prints at the same weight.
float gExposure = 1.0;

float frameExposure() {
  float frameMean = textureLod(uLuma, vec2(0.5), 12.0).r;
  return mix(1.0, 0.378 / max(frameMean, 0.05), 0.8);
}

float lumaAt(vec2 sourceUv, float level) {
  return textureLod(uLuma, clamp(sourceUv, vec2(0.001), vec2(0.999)), level).r * gExposure;
}

float toneAt(vec2 stageUv) {
  vec2 sourceUv = stageToSource(stageUv);
  float luma = lumaAt(sourceUv, 0.0);
  float near = lumaAt(sourceUv, uDetailLevels.x);
  float far = lumaAt(sourceUv, uDetailLevels.y);
  float form = lumaAt(sourceUv, uDetailLevels.z);
  vec2 step = vec2(3.25) / vec2(1200.0, 800.0);
  float gradientX = lumaAt(sourceUv + vec2(step.x, 0.0), 0.0) - lumaAt(sourceUv - vec2(step.x, 0.0), 0.0);
  float gradientY = lumaAt(sourceUv + vec2(0.0, step.y), 0.0) - lumaAt(sourceUv - vec2(0.0, step.y), 0.0);
  float base = 1.0 - pow(clamp(luma, 0.0, 1.0), 0.56);
  float detail = 1.12 * (near - luma) + 0.76 * (far - luma) + 0.52 * (form - luma);
  float navySeparation = (1.0 - smoothstep(0.2, 0.44, luma)) * smoothstep(0.022, 0.15, luma);
  float gradient = length(vec2(gradientX, gradientY));
  return clamp((base + detail + 0.22 * gradient - 0.2 * navySeparation) * 0.84, 0.0, 1.0);
}
`;

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Pass 1: extract gamma-encoded luma from the colour half of the packed source
// into a mipmapped single-channel target.
export const LUMA_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uPacked;
in vec2 vUv;
out vec4 outLuma;

void main() {
  // Stay a texel and a half inside the colour half so bilinear filtering never
  // mixes the matte half across the packed seam.
  float x = min(vUv.x * 0.5, 0.5 - 1.5 / 2400.0);
  vec3 rgb = texture(uPacked, vec2(x, vUv.y)).rgb;
  outLuma = vec4(vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722))), 1.0);
}
`;

// A bristled capsule parts the dots. Coordinates are top-left stage pixels.
const BRUSH_FOOTPRINT_GLSL = `
float hash12(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float brushContact(vec2 point, vec4 segment, float radius, out vec2 direction, out float depth) {
  vec2 travel = segment.zw - segment.xy;
  float length2 = dot(travel, travel);
  vec2 tangent = length2 > 0.01 ? travel / sqrt(length2) : normalize(vec2(1.0, 0.35));
  vec2 normal = vec2(-tangent.y, tangent.x);
  float t = clamp(dot(point - segment.xy, travel) / max(length2, 0.0001), 0.0, 1.0);
  vec2 radial = point - (segment.xy + travel * t);
  float distance = length(radial);
  direction = distance > 0.001 ? radial / distance : normal * (hash12(point) > 0.5 ? 1.0 : -1.0);
  float edge = mix(0.88, 1.06, hash12(floor(point / 9.0)));
  float separation = length(vec2(dot(radial, tangent) / 0.72, dot(radial, normal))) / edge;
  depth = max(0.0, radius - separation);
  return smoothstep(0.0, 1.0, depth / max(radius, 0.001));
}
`;

// The dark rigid marks part under the brush, then their damped springs
// close the print behind it.
export const PHYSICS_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform float uDt;
uniform float uFrameDt;
uniform int uSegmentCount;
uniform vec4 uSegments[${MAX_BRUSH_SEGMENTS}];
uniform float uWeights[${MAX_BRUSH_SEGMENTS}];
uniform float uBlockRadius;

layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;
${PACKING_GLSL}${BRUSH_FOOTPRINT_GLSL}
const float STIFFNESS = 225.0;
const float DAMPING = 25.5;
const vec2 PITCH_STAGE = vec2(3.6, 3.87);

void main() {
  ivec2 cellId = ivec2(gl_FragCoord.xy);
  vec4 posState = texelFetch(uPos, cellId, 0);
  vec4 velState = texelFetch(uVel, cellId, 0);
  vec2 displacement = vec2(unpack16(posState.rg, D_RANGE), unpack16(posState.ba, D_RANGE));
  vec2 velocity = vec2(unpack16(velState.rg, V_RANGE), unpack16(velState.ba, V_RANGE));
  velocity += (-STIFFNESS * displacement - DAMPING * velocity) * uDt;
  displacement += velocity * uDt;

  if (uBlockRadius > 0.0 && uSegmentCount > 0) {
    vec2 position = (vec2(cellId) + 0.5) * PITCH_STAGE + displacement;
    float contact = 0.0;
    float depth = 0.0;
    vec2 direction = vec2(0.0);
    vec2 sweepVelocity = vec2(0.0);
    for (int i = 0; i < ${MAX_BRUSH_SEGMENTS}; i++) {
      if (i >= uSegmentCount) break;
      vec2 outward;
      float nextDepth;
      float nextContact = brushContact(position, uSegments[i], uBlockRadius, outward, nextDepth);
      if (nextContact > 0.0 && nextContact >= contact) {
        contact = nextContact;
        depth = nextDepth;
        direction = outward;
        sweepVelocity = (uSegments[i].zw - uSegments[i].xy) /
          (max(uFrameDt, 0.004) * max(uWeights[i], 0.000001));
      }
    }
    if (contact > 0.0) {
      vec2 shove = direction * depth * contact * (1.0 - exp(-75.0 * uDt));
      displacement += shove;
      float speed = length(sweepVelocity);
      vec2 drag = sweepVelocity * min(1.0, 1600.0 / max(speed, 0.001));
      velocity += shove * 18.0 + drag * contact * (1.0 - exp(-7.0 * uDt));
    }
  }

  velocity *= min(1.0, 600.0 / max(length(velocity), 0.001));
  displacement = clamp(displacement, vec2(-D_RANGE), vec2(D_RANGE));
  if (dot(displacement, displacement) < 0.0004 && dot(velocity, velocity) < 0.25) {
    displacement = vec2(0.0);
    velocity = vec2(0.0);
  }
  outPos = vec4(pack16(displacement.x, D_RANGE), pack16(displacement.y, D_RANGE));
  outVel = vec4(pack16(velocity.x, V_RANGE), pack16(velocity.y, V_RANGE));
}
`;

// Pass 2b: the carrier, drawn as one rigid quad per halftone cell. The vertex
// stage owns everything constant across a dot (home tone, matte, glyph seed,
// displacement fetch, culling); the fragment stage owns the per-pixel mark
// recipe, sampled in the HOME frame so a displaced dot carries its ink with
// it rather than re-inking from whatever it slides across.
// Keep the complete original print recipe for each endpoint. Only the sampler
// selection changes; neither endpoint is approximated by one colour per cell.
const PAIR_MARK_MATH_GLSL = `
int gEndpoint = 0;
vec4 packedAt(vec2 uv) {
  return gEndpoint == 0 ? texture(uPacked, uv) : texture(uPackedB, uv);
}
vec4 lumaLevel(vec2 uv, float level) {
  return gEndpoint == 0 ? textureLod(uLuma, uv, level) : textureLod(uLumaB, uv, level);
}
${MARK_MATH_GLSL.replaceAll("texture(uPacked,", "packedAt(").replaceAll("textureLod(uLuma,", "lumaLevel(")}
`;

export const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 aCorner;
uniform sampler2D uPacked;
uniform sampler2D uPackedB;
uniform sampler2D uLuma;
uniform sampler2D uLumaB;
uniform sampler2D uProp;
uniform sampler2D uPos;
uniform sampler2D uCorrespondence;
uniform vec3 uFraming;
uniform vec3 uDetailLevels;
uniform float uPhase;
uniform int uPairIndex;
uniform int uUsePair;
uniform int uPass;
out vec2 vWithin;
out vec2 vStageUvHomeA;
out vec2 vStageUvHomeB;
flat out vec2 vCellA;
flat out vec2 vCellB;
flat out vec2 vToneMatteA;
flat out vec2 vToneMatteB;
flat out vec2 vExposure;
flat out vec2 vEndpointWeights;
flat out float vMotionPriority;
${PACKING_GLSL}${PAIR_MARK_MATH_GLSL}
const vec2 PITCH_STAGE = vec2(3.6, 3.87);
const int STATE_COLUMNS = 400;
const int PARTICLE_COUNT = 82800;
vec2 cellForIndex(int index) {
  return vec2(float(index % STATE_COLUMNS), float(index / STATE_COLUMNS));
}
vec2 displacementAt(vec2 cell) {
  vec4 packed = texelFetch(uPos, ivec2(cell), 0);
  return vec2(unpack16(packed.rg, D_RANGE), unpack16(packed.ba, D_RANGE));
}
vec2 toneMatteAt(vec2 cell, int endpoint, out float exposure) {
  gEndpoint = endpoint;
  gExposure = frameExposure();
  exposure = gExposure;
  vec2 homeUv = ((cell + 0.5) * PITCH_STAGE) / vec2(1440.0, 800.0);
  float mediaX = homeUv.x * STAGE_TO_MEDIA_SCALE + STAGE_TO_MEDIA_OFFSET;
  float matte = matteAt(stageToSource(homeUv));
  if (mediaX < -0.002 || mediaX > 1.002 || matte < 0.002) return vec2(0.0);
  return vec2(toneAt(homeUv), matte);
}
void main() {
  int index = gl_InstanceID;
  vec2 cellA = cellForIndex(index);
  vec2 cellB = cellA;
  bool matched = false;
  bool incoming = false;
  if (uUsePair == 1) {
    ivec2 tile = ivec2(uPairIndex % 8, uPairIndex / 8) * ivec2(400, 207);
    uvec3 bytes = uvec3(round(texelFetch(uCorrespondence, tile + ivec2(cellA), 0).rgb * 255.0));
    uint code = bytes.r | (bytes.g << 8) | (bytes.b << 16);
    int target = int(code & 131071u) - 1;
    matched = target >= 0 && target < PARTICLE_COUNT;
    incoming = (code & 131072u) != 0u;
    if (matched) cellB = cellForIndex(target);
  }
  vec2 weights = vec2(1.0, 0.0);
  float travel = 0.0;
  if (uUsePair == 1) {
    if (uPass == 0) {
      weights = vec2(1.0 - uPhase, matched ? uPhase : 0.0);
      travel = matched ? uPhase : 0.0;
    } else {
      cellB = cellA;
      weights = vec2(0.0, incoming ? 0.0 : uPhase);
      travel = 1.0;
    }
  }
  if (uUsePair == 2) { weights = vec2(0.0, 1.0); travel = 1.0; }
  vCellA = cellA;
  vCellB = cellB;
  vWithin = aCorner;
  vStageUvHomeA = ((cellA + aCorner) * PITCH_STAGE) / vec2(1440.0, 800.0);
  vStageUvHomeB = ((cellB + aCorner) * PITCH_STAGE) / vec2(1440.0, 800.0);
  vToneMatteA = toneMatteAt(cellA, 0, vExposure.x);
  vToneMatteB = toneMatteAt(cellB, 1, vExposure.y);
  vEndpointWeights = weights;
  vMotionPriority = matched && uPass == 0 ? min(16.0, exp(0.2 * length((cellB - cellA) * PITCH_STAGE))) : 1.0;
  if (dot(weights, vec2(vToneMatteA.y, vToneMatteB.y)) < 0.000001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 positionA = (cellA + aCorner) * PITCH_STAGE + displacementAt(cellA);
  vec2 positionB = (cellB + aCorner) * PITCH_STAGE + displacementAt(cellB);
  vec2 stageUv = mix(positionA, positionB, travel) / vec2(1440.0, 800.0);
  gl_Position = vec4(stageUv.x * 2.0 - 1.0, 1.0 - stageUv.y * 2.0, 0.0, 1.0);
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uPacked;
uniform sampler2D uPackedB;
uniform sampler2D uLuma;
uniform sampler2D uLumaB;
uniform sampler2D uAtlas;
uniform sampler2D uProp;
uniform vec2 uPitch;
uniform vec3 uFraming;
uniform float uDetailGain;
uniform vec3 uDetailLevels;
uniform vec2 uPitchPerceived;
in vec2 vWithin;
in vec2 vStageUvHomeA;
in vec2 vStageUvHomeB;
flat in vec2 vCellA;
flat in vec2 vCellB;
flat in vec2 vToneMatteA;
flat in vec2 vToneMatteB;
flat in vec2 vExposure;
flat in vec2 vEndpointWeights;
flat in float vMotionPriority;
out vec4 outColour;
const float GLYPH_COUNT = 936.0;
const float ATLAS_COLUMNS = 32.0;
${PAIR_MARK_MATH_GLSL}
vec4 endpointInk(int endpoint, vec2 cell, vec2 stageUvHome, float cellTone, float cellMatte, float exposure) {
  if (cellMatte < 0.002) return vec4(0.0);
  gEndpoint = endpoint;
  float toneBand = floor(clamp(cellTone, 0.0, 0.999) * 5.0);
  vec2 seed = cell + toneBand * vec2(13.7, 7.9);

  gExposure = exposure;
  float pixelTone = toneAt(stageUvHome);
  float tone = clamp(mix(cellTone, pixelTone, uDetailGain), 0.0, 1.0);

  float glyphIndex = floor(hash12(seed + 56.7) * GLYPH_COUNT);
  bool flipX = hash12(seed + 61.1) < 0.34;
  bool flipY = hash12(seed + 67.8) < 0.17;
  vec2 local = vec2(flipX ? 1.0 - vWithin.x : vWithin.x, flipY ? 1.0 - vWithin.y : vWithin.y);
  // Each cell carries a fixed offset through both endpoints. The glyph atlas
  // has a shared low-ink border; staggering its phase breaks the continuous
  // rows and columns without changing particle positions or source sampling.
  vec2 phase = vec2(hash12(cell + 191.2), hash12(cell + 229.4));
  vec2 sampleLocal = fract(local + phase);
  vec2 glyphCell = vec2(mod(glyphIndex, ATLAS_COLUMNS), floor(glyphIndex / ATLAS_COLUMNS));
  // Inset half a texel so bilinear filtering never bleeds neighbouring glyphs.
  vec2 atlasUv = (glyphCell + mix(vec2(0.5 / 32.0), vec2(31.5 / 32.0), sampleLocal)) / ATLAS_COLUMNS;
  // Explicit-gradient sample: atlasUv jumps at every cell border (hash-seeded
  // glyph choice, flips, fract wrap), so implicit derivatives in a quad that
  // straddles two cells would select a deep mip and print the atlas-wide
  // average instead of the glyph. The true footprint is cell-uniform: one
  // carrier pixel spans 1/uPitch of a cell's (31/32)-of-a-tile sweep.
  vec2 atlasFootprint = (31.0 / 32.0) / (ATLAS_COLUMNS * uPitch);
  float carrier = textureGrad(
    uAtlas,
    atlasUv,
    vec2(atlasFootprint.x, 0.0),
    vec2(0.0, atlasFootprint.y)
  ).r;

  vec2 margin = 0.6 * vec2(
    mix(-0.02, 0.026, hash12(cell + 81.2)),
    mix(-0.018, 0.024, hash12(cell + 86.7))
  );
  // Preserve the average paper coverage of the old cell gutters without
  // drawing their aligned edges. A smoothstep edge removes half its feather
  // width on each side, giving this separable cell-area estimate.
  vec2 feather = max(vec2(0.043, 0.041), vec2(0.75) / uPitch);
  vec2 retained = clamp(vec2(1.0) - 2.0 * margin - feather, vec2(0.0), vec2(1.0));
  float gutterVisibility = smoothstep(1.0, 5.0, min(uPitchPerceived.x, uPitchPerceived.y));
  float paperChannel = mix(1.0, retained.x * retained.y, gutterVisibility);

  float hierarchy = smoothstep(0.1, 0.9, tone);
  float threshold = mix(0.56, 0.14, pow(hierarchy, 0.95));
  float carrierAa = 0.085 * max(1.0, 4.8 / min(uPitch.x, uPitch.y));
  float thickness = smoothstep(threshold - carrierAa, threshold + carrierAa, carrier);
  float mark = thickness * paperChannel * mix(0.48, 0.85, pow(hierarchy, 1.05));
  float edgeMatte = matteAt(stageToSource(stageUvHome));
  // At narrow CSS sizes, dense marks merge into darker ink than the downsampled
  // poster. Ease shadow density while keeping the lighter skin marks legible.
  float sourceScale = smoothstep(1.8, 3.6, min(uPitchPerceived.x, uPitchPerceived.y));
  float densityCorrection = mix(mix(1.0, 0.90, hierarchy), 1.0, sourceScale);
  float alpha = clamp(mark * min(cellMatte, edgeMatte), 0.0, 1.0) * densityCorrection;
  if (alpha <= 0.001) {
    return vec4(0.0);
  }

  // Warm umber ramp: midtones (skin, beard) keep their brown hue and only the
  // deepest shadow marks drift toward neutral ink.
  float inkTone = clamp(mix(cellTone, pixelTone, uDetailGain), 0.0, 1.0);
  float depth = pow(inkTone, 0.76);
  vec3 colour = mix(vec3(124.0, 84.0, 52.0), vec3(52.0, 38.0, 27.0), depth) / 255.0;
  float desaturation = 0.3 * smoothstep(0.5, 0.85, inkTone);
  float neutral = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  float umber = hash12(cell + 103.9) - 0.5;
  float variation = 1.0 - desaturation;
  colour = mix(colour, vec3(neutral), desaturation);
  colour.r += (7.0 / 255.0) * umber * variation;
  colour.g += (3.0 / 255.0) * umber * variation;

  return vec4(colour * alpha, alpha);

}
void main() {
  vec4 a = vec4(0.0);
  vec4 b = vec4(0.0);
  if (vEndpointWeights.x > 0.0) a = endpointInk(0, vCellA, vStageUvHomeA, vToneMatteA.x, vToneMatteA.y, vExposure.x);
  if (vEndpointWeights.y > 0.0) b = endpointInk(1, vCellB, vStageUvHomeB, vToneMatteB.x, vToneMatteB.y, vExposure.y);
  // Appearance follows the same shared phase as every dot's position.
  outColour = a * vEndpointWeights.x + b * vEndpointWeights.y;
  if (outColour.a <= 0.001) discard;
}
`;

// Intermediate positions can place several complete printed cells over a
// pixel. Average their ink by geometric support, not source-over alpha.
export const NORMALIZED_PARTICLE_FRAGMENT_SHADER = PARTICLE_FRAGMENT_SHADER.replace(
  "out vec4 outColour;",
  "layout(location = 0) out vec4 outColour;\nlayout(location = 1) out vec4 outSupport;",
)
  .replace(
    "outColour = a * vEndpointWeights.x + b * vEndpointWeights.y;",
    "outColour = (a * vEndpointWeights.x + b * vEndpointWeights.y) * vMotionPriority;\n  outSupport = vec4((vEndpointWeights.x + vEndpointWeights.y) * vMotionPriority, 0.0, 0.0, 0.0);",
  )
  .replace("  if (outColour.a <= 0.001) discard;", "");

export const NORMALIZE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform highp sampler2D uAccumulatedInk;
uniform highp sampler2D uAccumulatedSupport;
uniform sampler2D uFallbackA;
uniform sampler2D uFallbackB;
uniform float uPhase;
in vec2 vUv;
out vec4 outColour;
void main() {
  vec4 ink = texture(uAccumulatedInk, vUv);
  float support = texture(uAccumulatedSupport, vUv).r;
  vec4 fallback = mix(texture(uFallbackA, vUv), texture(uFallbackB, vUv), uPhase);
  vec4 normalized = support > 0.00001 ? ink / support : fallback;
  // Moving cells can change pixel coverage immediately at an endpoint.
  // Ease in their normalized ink over the first/last 6% of this pair so
  // those tiny edge changes remain continuous with its exact source prints.
  float endpointDistance = min(uPhase, 1.0 - uPhase);
  outColour = mix(fallback, normalized, smoothstep(0.0, 0.06, endpointDistance));
}
`;

// Final composite: the one clean minification of the supersampled, mipmapped
// carrier onto the canvas, over the persistent background smears.
export const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uPortrait;
uniform sampler2D uSmear;
in vec2 vUv;
out vec4 outColour;

void main() {
  // Favour a finer mip blend so minification preserves the printed marks.
  // Trilinear weights remain continuous through resize; native output stays
  // on level zero, matching the poster bake.
  vec4 portrait = texture(uPortrait, vUv, -0.75);
  // The framebuffer carrier has bottom-left UVs; uploaded canvas rows keep
  // their top-left origin. Only the smear lookup needs its vertical flip.
  vec4 smear = texture(uSmear, vec2(vUv.x, 1.0 - vUv.y));
  smear.rgb *= smear.a;
  outColour = portrait + smear * (1.0 - portrait.a);
}
`;

// Pass 2c prologue: the collage blocks, drawn into the carrier BEFORE the
// dots so the ink physically prints over them. One quad per block, placed by
// a stage-px rect uniform.
export const BLOCK_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner; // unit quad corner in [0, 1]

uniform vec4 uRect; // block rect in stage px: origin.xy, size.xy

out vec2 vStagePx;

void main() {
  vec2 stagePx = uRect.xy + aCorner * uRect.zw;
  vStagePx = stagePx;
  vec2 stageUv = stagePx / vec2(1440.0, 800.0);
  gl_Position = vec4(stageUv.x * 2.0 - 1.0, 1.0 - stageUv.y * 2.0, 0.0, 1.0);
}
`;

// A block is masked around the subject by the LIVE matte, dilated: the cut
// follows whatever pose is on screen (a static union cut pinches against
// poses near its envelope), and the dilation pushes it out by a steady
// margin so the collage gap between block and figure holds at every frame.
// The concealment is deliberately absolute — scattering the ink with the
// cursor uncovers paper, never the block.
export const BLOCK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uPacked; // colour (left half) | matte (right half)
uniform sampler2D uPackedB;
uniform float uPhase;
uniform sampler2D uProp; // fixed matte for cup and utensils
uniform sampler2D uPaint; // this block's painted texture, straight alpha
uniform vec3 uFraming; // zoom, offset x, offset y (top-left convention)

in vec2 vStagePx;
out vec4 outColour;
${MATTE_GLSL.replace("return smoothstep(0.04, 0.92, max(dynamic, support));", "float first = smoothstep(0.04, 0.92, max(dynamic, support)); float second = smoothstep(0.04, 0.92, max(texture(uPackedB, vec2(0.5 + clamped.x * 0.5, clamped.y)).r, support)); return mix(first, second, uPhase);")}
uniform vec4 uRect; // block rect in stage px: origin.xy, size.xy

// The gap between block and figure, in stage px. The poster bake runs this
// same block pass, preserving its framing, gap and shadow before interaction.
// An alpha fade over the ivory page can only LIGHTEN, so
// the graded intersection is a SHADOW instead: the block deepens toward the
// figure — the cut-out casting onto the paper behind it — and the cut then
// lands on the matte's own skirt. A single dilation is a step in space, so
// the shadow's depth comes from FOUR rings at increasing radii, a quarter
// each: a staircase distance field the matte skirt blends into a gradient.
const float GAP_RADIUS = 12.0;
const float SHADOW_REACH = 24.0;
const float SHADOW_DEPTH = 0.2;
const vec2 STAGE_SIZE = vec2(1440.0, 800.0);

// Morphological dilation, approximated with a centre tap and an 8-point
// ring: the max matte within radius of this pixel. The matte's own soft
// skirt smooths the ring's chord gaps.
float dilatedMatte(vec2 stagePx, float radius) {
  float matte = matteAt(stageToSource(stagePx / STAGE_SIZE));

  for (int index = 0; index < 8; index += 1) {
    float angle = 6.28318 * float(index) / 8.0;
    vec2 offset = radius * vec2(cos(angle), sin(angle));
    matte = max(matte, matteAt(stageToSource((stagePx + offset) / STAGE_SIZE)));
  }

  return matte;
}

void main() {
  // The widest ring gates everything: beyond SHADOW_REACH of the figure
  // there is no cut and no shadow, and the inner rings never sample.
  float dFar = dilatedMatte(vStagePx, SHADOW_REACH);
  float visibility = 1.0;
  float shade = 0.0;

  if (dFar > 0.05) {
    float dNear = dilatedMatte(vStagePx, 6.0);
    float dGap = dilatedMatte(vStagePx, GAP_RADIUS);
    float dMid = dilatedMatte(vStagePx, 18.0);
    visibility = 1.0 - smoothstep(0.05, 0.55, dGap);
    shade =
      (smoothstep(0.05, 0.7, dNear) +
        smoothstep(0.05, 0.7, dGap) +
        smoothstep(0.05, 0.7, dMid) +
        smoothstep(0.05, 0.7, dFar)) *
      0.25;
  }

  // The paint bake owns colour AND coverage; where its alpha thins, the page
  // behind the canvas shows through — the ground continuing under the paint.
  vec4 paint = texture(uPaint, (vStagePx - uRect.xy) / uRect.zw);
  float alpha = paint.a * visibility;
  outColour = vec4(paint.rgb * (1.0 - SHADOW_DEPTH * shade) * alpha, alpha);
}
`;
