import {
  BasicShadowMap,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ATLAS, type AtlasBook } from "../lib/atlas-layout";
import { AtlasContact, softenAtlasShadow } from "./atlas-lighting";

export type AtlasTexture = {
  texture: Texture;
  edge: Color;
  image: HTMLImageElement;
  region?: { u: number; v: number; du: number; dv: number };
};

export async function loadAtlasTexture(src: string): Promise<AtlasTexture> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  const sampler = document.createElement("canvas");
  sampler.width = 1;
  sampler.height = 1;
  const context = sampler.getContext("2d");
  let edge = new Color(0x554c3e);
  if (context) {
    context.drawImage(image, 0, 0, Math.max(1, image.width * 0.04), image.height, 0, 0, 1, 1);
    const pixels = context.getImageData(0, 0, 1, 1).data;
    edge = new Color().setRGB(
      (pixels[0] ?? 80) / 255,
      (pixels[1] ?? 75) / 255,
      (pixels[2] ?? 65) / 255,
      SRGBColorSpace,
    );
  }
  return { texture, edge, image };
}

function fibreTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const data = context.createImageData(128, 128);
    let seed = 71;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = Math.imul(seed, 1_664_525) + 1_013_904_223;
      const noise = ((seed >>> 24) / 255 - 0.5) * 22;
      data.data.set([128 + noise, 128 - noise * 0.6, 253, 255], i);
    }
    context.putImageData(data, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(5, 7);
  return texture;
}

function pageTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#eee8da";
    context.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 256; y++) {
      const alpha = y % 3 === 0 ? 0.2 : y % 2 === 0 ? 0.075 : 0.025;
      context.fillStyle = `rgba(84, 67, 45, ${alpha})`;
      context.fillRect(0, y, 128, 0.65);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export class AtlasVolume {
  readonly book: AtlasBook;
  readonly group = new Group();
  readonly face: Mesh<PlaneGeometry, MeshPhysicalMaterial>;
  private parts: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  private binding: MeshStandardMaterial;
  private pages: MeshStandardMaterial;
  readonly compact: boolean;
  private faceUV: Float32Array;

  constructor(
    book: AtlasBook,
    texture: AtlasTexture | null,
    fibres: Texture,
    paper: Texture,
    soft: boolean,
    compact = false,
  ) {
    this.book = book;
    this.compact = compact;
    const { width, height, depth, hardback, coated, rotation } = book.profile;
    const board = hardback ? 0.035 : 0.016;
    this.binding = new MeshStandardMaterial({
      color: texture?.edge ?? 0x60584b,
      roughness: coated ? 0.45 : 0.78,
      normalMap: fibres,
      normalScale: new Vector2(0.09, 0.09),
    });
    this.pages = new MeshStandardMaterial({
      map: paper,
      bumpMap: paper,
      bumpScale: 0.006,
      roughness: 0.95,
      color: 0xe6e0d4,
    });
    const addPart = (
      w: number,
      d: number,
      h: number,
      y: number,
      material: MeshStandardMaterial,
    ) => {
      const geometry = compact
        ? new BoxGeometry(w, d, h)
        : new RoundedBoxGeometry(w, d, h, 2, Math.min(0.022, d / 3));
      const mesh = new Mesh(geometry, material);
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.parts.push(mesh);
      this.group.add(mesh);
      return mesh;
    };
    addPart(width - 0.07, depth - board * 2, height - 0.07, depth / 2, this.pages);
    addPart(width, board, height, board / 2, this.binding);
    addPart(width, board, height, depth - board / 2, this.binding);
    const spine = addPart(0.07, depth, height, depth / 2, this.binding);
    spine.position.x = -width / 2 + 0.035;
    // A shallow joint catches light where the cover bends away from the spine.
    const crease = addPart(0.026, 0.009, height - 0.055, depth + 0.002, this.binding);
    crease.position.x = -width / 2 + 0.09;
    const square = book.cover.width > 0 && book.cover.height / book.cover.width < 1.15;
    this.face = new Mesh(
      new PlaneGeometry(width - 0.018, square ? width - 0.018 : height - 0.018),
      new MeshPhysicalMaterial({
        map: texture?.texture ?? null,
        color: texture ? 0xffffff : 0xd8cbb6,
        roughness: coated ? 0.48 : 0.76,
        clearcoat: coated ? 0.12 : 0,
        clearcoatRoughness: 0.55,
        normalMap: fibres,
        normalScale: new Vector2(0.025, 0.025),
        metalness: 0,
      }),
    );
    this.faceUV = new Float32Array(this.face.geometry.attributes.uv?.array ?? []);
    if (compact) {
      const boards = this.parts.filter((part) => part.material === this.binding);
      const merged = mergeGeometries(
        boards.map((part) => {
          part.updateMatrix();
          return part.geometry.clone().applyMatrix4(part.matrix);
        }),
      );
      if (merged) {
        for (const part of boards) {
          part.removeFromParent();
          part.geometry.dispose();
        }
        this.parts = this.parts.filter((part) => part.material !== this.binding);
        const mesh = new Mesh(merged, this.binding);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.parts.push(mesh);
        this.group.add(mesh);
      }
    }
    this.face.rotation.x = -Math.PI / 2;
    this.face.position.y = depth + 0.006;
    this.face.receiveShadow = true;
    this.group.add(this.face);
    this.group.rotation.y = rotation;
    if (texture) this.setTexture(texture);
    if (soft) {
      for (const material of [this.binding, this.pages, this.face.material]) {
        softenAtlasShadow(material);
      }
    }
  }

  setTexture(texture: AtlasTexture) {
    const uv = this.face.geometry.attributes.uv;
    const region = texture.region ?? { u: 0, v: 0, du: 1, dv: 1 };
    if (uv) {
      for (let index = 0; index < uv.count; index++)
        uv.setXY(
          index,
          region.u + (this.faceUV[index * 2] ?? 0) * region.du,
          region.v + (this.faceUV[index * 2 + 1] ?? 0) * region.dv,
        );
      uv.needsUpdate = true;
    }
    this.face.material.map = texture.texture;
    this.face.material.color.set(0xffffff);
    this.face.material.needsUpdate = true;
    this.binding.color.copy(texture.edge);
  }

  dispose() {
    this.group.removeFromParent();
    for (const part of this.parts) part.geometry.dispose();
    this.binding.dispose();
    this.pages.dispose();
    this.face.geometry.dispose();
    this.face.material.dispose();
  }
}

export class AtlasScene {
  readonly lightTier: boolean;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 150);
  private light = new DirectionalLight(0xfff8ee, 3.2);
  private floor: Mesh<PlaneGeometry, ShadowMaterial>;
  private environment: WebGLRenderTarget;
  private fibres = fibreTexture();
  private paper = pageTexture();
  private contact: AtlasContact;
  private width = 1;
  private height = 1;
  private unit = 1;
  private left = 0;
  private top = 0;
  private centered = false;

  constructor(canvas: HTMLCanvasElement, lightTier: boolean) {
    this.lightTier = lightTier;
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = lightTier ? PCFShadowMap : BasicShadowMap;
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(room, 0.06);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.4;
    room.dispose();
    generator.dispose();
    this.scene.add(new HemisphereLight(0xfffbf4, 0xb8aea0, 0.6));
    this.light.castShadow = true;
    this.light.shadow.mapSize.setScalar(lightTier ? 1024 : 2048);
    this.light.shadow.bias = -0.00012;
    this.light.shadow.normalBias = 0.015;
    this.light.shadow.radius = 3;
    this.scene.add(this.light, this.light.target);
    const floorMaterial = new ShadowMaterial({ color: 0x51483e, opacity: 0.32 });
    if (!lightTier) softenAtlasShadow(floorMaterial);
    this.floor = new Mesh(new PlaneGeometry(1, 1), floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.contact = new AtlasContact(lightTier ? 512 : 1024);
    this.scene.add(this.contact.plane);
  }

  createVolume(book: AtlasBook, texture: AtlasTexture | null = null, compact = false) {
    const volume = new AtlasVolume(
      book,
      texture,
      this.fibres,
      this.paper,
      !this.lightTier,
      compact,
    );
    this.scene.add(volume.group);
    return volume;
  }

  resize(width: number, height: number, unit: number, dpr: number, centered = false) {
    const sizeChanged =
      width !== this.width || height !== this.height || dpr !== this.renderer.getPixelRatio();
    this.width = width;
    this.height = height;
    this.unit = unit;
    this.centered = centered;
    if (sizeChanged) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
    }
    this.camera.left = -width / unit / 2;
    this.camera.right = width / unit / 2;
    this.camera.top = height / unit / 2;
    this.camera.bottom = -height / unit / 2;
    this.camera.updateProjectionMatrix();
    this.scroll(this.left, this.top);
  }

  scroll(left: number, top = 0) {
    this.left = left;
    this.top = top;
    const x = this.centered ? 0 : (left + this.width / 2) / this.unit;
    const z = this.centered
      ? 0
      : ((this.top + this.height / 2) / this.unit - ATLAS.insetY) / Math.sin(ATLAS.pitch);
    this.camera.position.set(x, Math.sin(ATLAS.pitch) * 60, z + Math.cos(ATLAS.pitch) * 60);
    this.camera.lookAt(x, 0, z);
    this.light.position.set(x - 9, 13, z - 12);
    this.light.target.position.set(x, 0, z);
    const width = this.width / this.unit + 8;
    const length = this.height / this.unit / Math.sin(ATLAS.pitch) + 6;
    this.floor.position.set(x, 0, z);
    this.floor.scale.set(width, length, 1);
    const shadow = this.light.shadow.camera;
    const extent = Math.max(width, length) / 2;
    shadow.left = -extent;
    shadow.right = extent;
    shadow.top = extent;
    shadow.bottom = -extent;
    shadow.near = 1;
    shadow.far = 50;
    shadow.updateProjectionMatrix();
    // Keep the penumbra in world units as the shadow camera follows the viewport.
    this.light.shadow.radius = this.lightTier
      ? 2
      : ((shadow.far - shadow.near) * 0.2 * 2048) / (extent * 2);
  }

  render(contacts = true) {
    if (contacts) {
      this.floor.visible = false;
      const x = this.centered ? 0 : (this.left + this.width / 2) / this.unit;
      const z = this.centered
        ? 0
        : ((this.top + this.height / 2) / this.unit - ATLAS.insetY) / Math.sin(ATLAS.pitch);
      this.contact.update(
        this.renderer,
        this.scene,
        x,
        z,
        this.width / this.unit + 6,
        this.height / this.unit / Math.sin(ATLAS.pitch) + 6,
      );
      this.floor.visible = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  showGround(visible: boolean) {
    this.floor.visible = visible;
    this.contact.plane.visible = visible;
  }

  dispose() {
    this.contact.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.environment.dispose();
    this.light.shadow.dispose();
    this.fibres.dispose();
    this.paper.dispose();
    this.renderer.dispose();
  }
}
