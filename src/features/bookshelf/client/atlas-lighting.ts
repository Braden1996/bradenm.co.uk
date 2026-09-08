import {
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Material,
  type WebGLRenderer,
  type Texture,
  type IUniform,
} from "three";

const softShadow = `
  float blockers = 0.0;
  float blockerDepth = 0.0;
  vec2 texel = 1.0 / shadowMapSize;
  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 2.39996323;
    vec2 offset = vec2(cos(angle), sin(angle)) * sqrt((float(i) + 0.5) / 16.0);
    float depth = texture2D(shadowMap, shadowCoord.xy + offset * texel * 10.0).r;
    if (depth < shadowCoord.z) { blockers += 1.0; blockerDepth += depth; }
  }
  if (blockers > 0.0) {
    float separation = shadowCoord.z - blockerDepth / blockers;
    float radius = clamp(separation * shadowRadius, 1.0, 14.0);
    shadow = 0.0;
    float rotation = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    for (int i = 0; i < 48; i++) {
      float angle = float(i) * 2.39996323 + rotation;
      vec2 offset = vec2(cos(angle), sin(angle)) * sqrt((float(i) + 0.5) / 48.0);
      float depth = texture2D(shadowMap, shadowCoord.xy + offset * texel * radius).r;
      shadow += step(shadowCoord.z, depth);
    }
    shadow /= 48.0;
  }
`;

/** Scope the soft-shadow shader to atlas materials; other site artwork is unaffected. */
export function softenAtlasShadow(material: Material) {
  material.onBeforeCompile = (shader) => {
    const chunk = ShaderChunk.shadowmap_pars_fragment.replace(
      /float depth = texture2D\( shadowMap, shadowCoord.xy \).r;[\s\S]*?shadow = step\( shadowCoord.z, depth \);\s*#endif/,
      softShadow,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <shadowmap_pars_fragment>",
      chunk,
    );
  };
  material.customProgramCacheKey = () => "atlas-soft-shadow-v2";
}

const blurVertex = `varying vec2 uvPass;
void main(){uvPass=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const blurFragment = `uniform sampler2D source; uniform vec2 direction;
varying vec2 uvPass;
void main(){
  vec4 value=texture2D(source,uvPass)*0.227027;
  value+=texture2D(source,uvPass+direction*1.384615)*0.316216;
  value+=texture2D(source,uvPass-direction*1.384615)*0.316216;
  value+=texture2D(source,uvPass+direction*3.230769)*0.070270;
  value+=texture2D(source,uvPass-direction*3.230769)*0.070270;
  gl_FragColor=value;
}`;

/** Top-down geometry depth, softened in world space, grounds the bindings in the paper. */
export class AtlasContact {
  private sourceUniform: IUniform<Texture | null> = { value: null };
  private directionUniform = { value: new Vector2() };
  private target: WebGLRenderTarget;
  private intermediate: WebGLRenderTarget;
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 2);
  private depth = new MeshDepthMaterial();
  private blur = new ShaderMaterial({
    uniforms: { source: this.sourceUniform, direction: this.directionUniform },
    vertexShader: blurVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  private blurScene = new Scene();
  private quad = new Mesh(new PlaneGeometry(2, 2), this.blur);
  readonly plane: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor(resolution: number) {
    this.target = new WebGLRenderTarget(resolution, resolution);
    this.intermediate = new WebGLRenderTarget(resolution, resolution);
    this.depth.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "float height = (1.0-fragCoordZ)*2.0; gl_FragColor = vec4(0.19, 0.15, 0.10, exp(-pow(height / 0.65, 2.0))*0.48);",
      );
    };
    this.plane = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: this.target.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.003;
    this.camera.up.set(0, 0, -1);
    this.blurScene.add(this.quad);
  }

  update(
    renderer: WebGLRenderer,
    scene: Scene,
    x: number,
    z: number,
    width: number,
    length: number,
  ) {
    this.plane.scale.set(width, length, 1);
    this.plane.position.set(x, 0.003, z);
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = length / 2;
    this.camera.bottom = -length / 2;
    this.camera.position.set(x, 2, z);
    this.camera.lookAt(x, 0, z);
    this.camera.updateProjectionMatrix();
    const previous = scene.overrideMaterial;
    scene.overrideMaterial = this.depth;
    this.plane.visible = false;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    scene.overrideMaterial = previous;
    this.sourceUniform.value = this.target.texture;
    this.directionUniform.value.set(0.035 / width, 0);
    renderer.setRenderTarget(this.intermediate);
    renderer.render(this.blurScene, this.camera);
    this.sourceUniform.value = this.intermediate.texture;
    this.directionUniform.value.set(0, 0.035 / length);
    renderer.setRenderTarget(this.target);
    renderer.render(this.blurScene, this.camera);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = shadowUpdate;
    this.plane.visible = true;
  }

  dispose() {
    this.target.dispose();
    this.intermediate.dispose();
    this.depth.dispose();
    this.blur.dispose();
    this.quad.geometry.dispose();
    this.plane.geometry.dispose();
    this.plane.material.dispose();
  }
}
