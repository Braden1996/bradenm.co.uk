layout(location = 0) out vec4 fragColor;

uniform vec4 uGrid; // supersampled pitch x/y, reserved, reserved
uniform vec4 uWash; // white point, darkness gamma, navy separation, reserved
uniform vec4 uGlyph; // highlight threshold, shadow threshold, gradient gain, opacity floor
uniform vec4 uAtmosphere; // fragment density, fragment alpha, warm probability, warm mix
uniform vec4 uInk; // deep ink RGB, deep-tone desaturation
uniform vec4 uFace; // highlight ink RGB, fixed red variation
uniform vec4 uCarrier; // threshold exponent, antialiasing, opacity exponent, reserved
uniform vec4 uComposition; // zoom, source x/y offset, reserved

// Input 0: cropped source video, input 1: packed mattes (dynamic R, stable G),
// input 2: fixed 8x8 atmosphere atlas, input 3: fixed 32x32 portrait atlas.
// TouchDesigner supplies the samplers, texture information and vUV automatically.

float luma(vec3 value) {
  return dot(value, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sampleLuma(vec2 uv) {
  return luma(texture(sTD2DInputs[0], clamp(uv, vec2(0.0), vec2(1.0))).rgb);
}

float sampleLumaRing(vec2 uv, vec2 texel, float radius) {
  vec2 stepUv = texel * radius;
  return 0.125 * (
    sampleLuma(uv + vec2(stepUv.x, 0.0)) +
    sampleLuma(uv - vec2(stepUv.x, 0.0)) +
    sampleLuma(uv + vec2(0.0, stepUv.y)) +
    sampleLuma(uv - vec2(0.0, stepUv.y)) +
    sampleLuma(uv + stepUv) +
    sampleLuma(uv - stepUv) +
    sampleLuma(uv + vec2(stepUv.x, -stepUv.y)) +
    sampleLuma(uv + vec2(-stepUv.x, stepUv.y))
  );
}

float sampleMatteRing(vec2 uv, vec2 texel, float radius) {
  vec2 stepUv = texel * radius / uComposition.x;
  return 0.125 * (
    texture(sTD2DInputs[1], uv + vec2(stepUv.x, 0.0)).r +
    texture(sTD2DInputs[1], uv - vec2(stepUv.x, 0.0)).r +
    texture(sTD2DInputs[1], uv + vec2(0.0, stepUv.y)).r +
    texture(sTD2DInputs[1], uv - vec2(0.0, stepUv.y)).r +
    texture(sTD2DInputs[1], uv + stepUv).r +
    texture(sTD2DInputs[1], uv - stepUv).r +
    texture(sTD2DInputs[1], uv + vec2(stepUv.x, -stepUv.y)).r +
    texture(sTD2DInputs[1], uv + vec2(-stepUv.x, stepUv.y)).r
  );
}

float sampleSubjectMatte(vec2 uv) {
  vec4 packedMattes = texture(sTD2DInputs[1], uv);
  return smoothstep(0.018, 0.91, max(packedMattes.r, packedMattes.g));
}

void main() {
  vec2 uv = vUV.st;
  vec2 sourceUv =
    (uv - vec2(0.5)) / uComposition.x + vec2(0.5) + uComposition.yz;
  vec2 outputSize = uTDOutputInfo.res.zw;
  vec2 pixel = uv * outputSize;
  vec2 texel = uTD2DInfos[0].res.xy;

  float matte = sampleSubjectMatte(sourceUv);

  // The shader renders at 2x. A single high-quality downsample turns the
  // heterogeneous atlas marks into the reference's fine printed carrier while
  // preserving a real transparent paper channel around every cell.
  vec2 pitch = uGrid.xy;
  vec2 cell = floor(pixel / pitch);
  vec2 within = fract(pixel / pitch);
  vec2 cellStageUv = ((cell + 0.5) * pitch) / outputSize;
  vec2 cellSourceUv =
    (cellStageUv - vec2(0.5)) / uComposition.x + vec2(0.5) + uComposition.yz;
  float cellMatte = sampleSubjectMatte(cellSourceUv);
  float cellY = sampleLuma(cellSourceUv);
  // Analyse the source once at each cell centre. Every pixel inside a glyph
  // receives the same tone, so the photograph is reconstructed by changing
  // printed marks rather than by revealing a greyscale image below them.
  vec2 gradientStep = texel * 3.25;
  float n = sampleLuma(cellSourceUv + vec2(0.0, gradientStep.y));
  float s = sampleLuma(cellSourceUv - vec2(0.0, gradientStep.y));
  float e = sampleLuma(cellSourceUv + vec2(gradientStep.x, 0.0));
  float w = sampleLuma(cellSourceUv - vec2(gradientStep.x, 0.0));
  float gradient = length(vec2(e - w, n - s));
  float nearLocal = sampleLumaRing(cellSourceUv, texel, 2.1);
  float farLocal = sampleLumaRing(cellSourceUv, texel, 10.5);
  float formLocal = sampleLumaRing(cellSourceUv, texel, 34.0);
  // Three signed spatial scales carry facial planes, beard/hair detail and
  // navy-shirt folds. They only change the printed marks; no greyscale source
  // image or continuous wash is present beneath the carrier.
  float base = 1.0 - pow(clamp(cellY / uWash.x, 0.0, 1.0), uWash.y);
  float detail =
    1.12 * (nearLocal - cellY) +
    0.76 * (farLocal - cellY) +
    0.38 * (formLocal - cellY);
  float navySeparation =
    (1.0 - smoothstep(0.18, 0.31, cellY)) * smoothstep(0.022, 0.15, cellY);
  float tone = clamp(
    base + detail + uGlyph.z * gradient - uWash.z * navySeparation,
    0.0,
    1.0
  );
  // Each cell selects one of 936 marks extracted from the approved texture.
  // Identity, mirroring, sub-cell offset and gutter width are stage-locked;
  // only threshold, opacity and ink depth respond to the moving source.
  float identity = hash12(cell + 56.7);
  float glyphIndex = floor(identity * 936.0);
  vec2 glyphCell = vec2(mod(glyphIndex, 32.0), floor(glyphIndex / 32.0));
  bool flipX = hash12(cell + 61.1) < 0.34;
  bool flipY = hash12(cell + 67.8) < 0.17;
  vec2 atlasWithin = vec2(
    flipX ? 1.0 - within.x : within.x,
    flipY ? 1.0 - within.y : within.y
  );
  atlasWithin += vec2(
    (hash12(cell + 71.4) - 0.5) * 0.075,
    (hash12(cell + 76.3) - 0.5) * 0.06
  );
  atlasWithin = clamp(atlasWithin, vec2(0.0), vec2(1.0));
  vec2 atlasUv =
    (vec2(glyphCell.x, 31.0 - glyphCell.y) + atlasWithin) / 32.0;
  float atlasSample = texture(sTD2DInputs[3], atlasUv).r;
  float marginX = mix(-0.02, 0.026, hash12(cell + 81.2));
  float marginY = mix(-0.018, 0.024, hash12(cell + 86.7));
  float paperChannel =
    smoothstep(marginX, marginX + 0.043, within.x) *
    smoothstep(marginX, marginX + 0.043, 1.0 - within.x) *
    smoothstep(marginY, marginY + 0.041, within.y) *
    smoothstep(marginY, marginY + 0.041, 1.0 - within.y);
  float hierarchy = smoothstep(0.1, 0.9, tone);
  float threshold = mix(uGlyph.x, uGlyph.y, pow(hierarchy, uCarrier.x));
  float carrier = smoothstep(
    threshold - uCarrier.y,
    threshold + uCarrier.y,
    atlasSample
  );
  float opacity = mix(uGlyph.w, 0.995, pow(hierarchy, uCarrier.z));
  float alpha = min(cellMatte, matte) * carrier * paperChannel * opacity;

  // Three progressively sparse bands replace the old contour-like outline.
  // Their identities are stage-locked, so the silhouette appears to dissolve
  // into printed debris without boiling as the source loop moves.
  float outside = 1.0 - smoothstep(0.01, 0.22, matte);
  float ring8 = outside * smoothstep(0.035, 0.40, sampleMatteRing(sourceUv, texel, 8.0));
  float ring18 = outside * smoothstep(0.025, 0.31, sampleMatteRing(sourceUv, texel, 18.0));
  float ring34 = outside * smoothstep(0.018, 0.23, sampleMatteRing(sourceUv, texel, 34.0));
  float bandInner = ring8;
  float bandMiddle = clamp(ring18 - 0.52 * ring8, 0.0, 1.0);
  float bandOuter = clamp(ring34 - 0.6 * ring18, 0.0, 1.0);
  vec2 stageTopUv = vec2(uv.x, 1.0 - uv.y);
  float hairCloud = 1.0 - smoothstep(
    0.44,
    1.0,
    length((stageTopUv - vec2(0.41, 0.19)) / vec2(0.2, 0.24))
  );
  float leftShoulderCloud = 1.0 - smoothstep(
    0.38,
    1.0,
    length((stageTopUv - vec2(0.18, 0.47)) / vec2(0.24, 0.2))
  );
  float rightShoulderCloud = 1.0 - smoothstep(
    0.4,
    1.0,
    length((stageTopUv - vec2(0.79, 0.48)) / vec2(0.25, 0.22))
  );
  float cloudLobes = clamp(
    max(hairCloud, max(0.88 * leftShoulderCloud, 0.72 * rightShoulderCloud)),
    0.0,
    1.0
  );
  float cloudField = 0.1 + 0.9 * cloudLobes;
  float exterior = clamp(
    0.42 * bandInner + 0.82 * bandMiddle * cloudField + 0.62 * bandOuter * cloudField,
    0.0,
    1.0
  );
  float fragmentChance = clamp(
    uAtmosphere.x * (
      0.4 * bandInner +
      0.58 * bandMiddle * cloudField +
      0.24 * bandOuter * cloudField
    ),
    0.0,
    0.88
  );
  float fragmentTier = floor(1.0 + hash12(cell + 912.4) * 4.0);
  float fragmentVariant = floor(hash12(cell + 127.9) * 8.0);
  float fragmentScalePick = hash12(cell + 447.8);
  float fragmentScale =
    fragmentScalePick < 0.18 ? 0.62 : (fragmentScalePick > 0.86 ? 1.05 : 0.92);
  vec2 fragmentWithin = (within - 0.5) / fragmentScale + 0.5;
  vec2 fragmentUv =
    (vec2(fragmentVariant, 7.0 - fragmentTier) + fragmentWithin) / 8.0;
  float fragmentGlyph = texture(sTD2DInputs[2], fragmentUv).r;
  fragmentGlyph = smoothstep(
    0.32 - fwidth(fragmentGlyph),
    0.58 + fwidth(fragmentGlyph),
    fragmentGlyph
  );
  float fragment = step(hash12(cell + 341.7), fragmentChance) * fragmentGlyph;
  float fragmentAlpha = fragment * exterior * uAtmosphere.y;

  // Break the contour itself as well as printing outside it. This restrained,
  // stage-locked dropout prevents the added bands reading as a conventional
  // glow around an otherwise perfectly cut-out photograph.
  float edgeInterior =
    smoothstep(0.018, 0.18, matte) * (1.0 - smoothstep(0.32, 0.68, matte));
  float edgeDrop = step(hash12(cell + 1551.9), 0.1 * edgeInterior);
  alpha *= 1.0 - edgeDrop * 0.5;

  float inkDepth = pow(tone, 0.76);
  vec3 colour = mix(uFace.rgb, uInk.rgb, inkDepth);
  float desaturation = uInk.w * smoothstep(0.45, 0.82, tone);
  float inkLuma = luma(colour);
  colour = mix(colour, vec3(inkLuma), desaturation);
  float umberVariation = hash12(cell + 103.9) - 0.5;
  colour.r += umberVariation * uFace.w * (1.0 - desaturation);
  colour.g += umberVariation * uFace.w * 0.4 * (1.0 - desaturation);
  vec3 clay = vec3(0.48, 0.34, 0.245);

  // No continuous outline: even the lowest-opacity atmosphere is carried by
  // actual atlas marks. Three independent occupancies keep long contour runs
  // from revealing the matte's geometry.
  float haloCarrier = fragmentGlyph;
  float haloInner =
    step(hash12(cell + 2017.3), 0.42 * bandInner) * bandInner * haloCarrier * 0.027;
  float haloMiddle =
    step(hash12(cell + 2021.1), 0.58 * bandMiddle * cloudField) *
    bandMiddle * cloudField * haloCarrier * 0.021;
  float haloOuter =
    step(hash12(cell + 2024.8), 0.24 * bandOuter * cloudField) *
    bandOuter * cloudField * haloCarrier * 0.012;
  float haloAlpha = outside * clamp(haloInner + haloMiddle + haloOuter, 0.0, 0.04);
  float combinedAlpha =
    1.0 - (1.0 - alpha) * (1.0 - fragmentAlpha) * (1.0 - haloAlpha);
  // Exterior dust should inherit the archive's warm clay rather than cooling
  // toward the portrait ink as its alpha falls away.
  float clayMix = (fragmentAlpha + 0.68 * haloAlpha) / max(combinedAlpha, 0.0001);
  vec3 straightColour = mix(colour, clay, clamp(clayMix, 0.0, 0.38));
  // PNG and the web alpha-video encoders expect straight colour. Keeping the
  // premultiplication out of the stored master also prevents dark edge fringes.
  fragColor = TDOutputSwizzle(vec4(straightColour, combinedAlpha));
}
