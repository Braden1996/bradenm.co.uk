layout(location = 0) out vec4 fragColor;

// Input 0: dynamic person matte, input 1: fixed held-prop support matte.
// Packing them keeps the main renderer within the standard GLSL TOP's
// three-input limit without baking another 48-frame media asset.

void main() {
  float dynamicMatte = texture(sTD2DInputs[0], vUV.st).r;
  float propSupport = texture(sTD2DInputs[1], vUV.st).r;
  fragColor = TDOutputSwizzle(vec4(dynamicMatte, propSupport, 0.0, 1.0));
}
