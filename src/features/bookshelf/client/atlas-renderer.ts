// cspell:ignore slerp
import { Color, Euler, Quaternion, SRGBColorSpace, Vector3, type Object3D } from "three";
import { ATLAS, atlasCoverSource, type AtlasBook } from "../lib/atlas-layout";
import type { AtlasView } from "../lib/atlas-camera";
import { atlasCoverRegion } from "../lib/atlas-sheet";
import { AtlasScene, loadAtlasTexture, type AtlasTexture, type AtlasVolume } from "./atlas-scene";

export type AtlasElements = {
  atlas: HTMLElement;
  stage: HTMLElement;
  scroll: HTMLElement;
  canvas: HTMLCanvasElement;
  frozen: HTMLCanvasElement;
  dialog: HTMLDialogElement;
  inspectorCanvas: HTMLElement;
  anchor: HTMLElement;
  sheet: string;
  sheetCount: number;
};
type TextureEntry = {
  pending: Promise<AtlasTexture | null>;
  value: AtlasTexture | null;
  touched: number;
};
type Pose = {
  x: number;
  y: number;
  scale: number;
  centered: number;
  rotation: Quaternion;
};
type Inspection = {
  volume: AtlasVolume;
  browsingTexture: AtlasTexture;
  from: Pose;
  current: Pose;
  table: Pose;
  phase: "opening" | "open" | "closing";
  started: number;
  yaw: number;
  pitch: number;
  resolve: (() => void) | null;
};

export class AtlasRenderer {
  private scene: AtlasScene;
  private volumes = new Map<string, AtlasVolume>();
  private textures = new Map<string, TextureEntry>();
  private baseTextures = new Map<string, AtlasTexture>();
  private sheetPromise: Promise<void>;
  private preparing: Promise<Object3D> | null = null;
  private sheet: AtlasTexture | null = null;
  private frame = 0;
  private unit = 1;
  private disposed = false;
  private active = true;
  private inspection: Inspection | null = null;
  private inspectionGeneration = 0;
  private rangeKey = "";
  private requests = 0;
  private ready = false;
  private frames = 0;
  private cards = new Map<string, HTMLElement>();
  private categoryMatches: Set<string> | null = null;
  private elements: AtlasElements;
  private books: AtlasBook[];
  private view: AtlasView;
  private lightTier: boolean;
  private failed: () => void;
  private inspectionOnly: boolean;

  constructor(
    elements: AtlasElements,
    books: AtlasBook[],
    view: AtlasView,
    lightTier: boolean,
    failed: () => void,
    inspectionOnly = false,
  ) {
    this.elements = elements;
    this.books = books;
    this.view = view;
    this.lightTier = lightTier;
    this.failed = failed;
    this.inspectionOnly = inspectionOnly;
    for (const card of elements.atlas.querySelectorAll<HTMLElement>("[data-book-card]"))
      this.cards.set(card.dataset.bookId ?? "", card);
    this.scene = new AtlasScene(elements.canvas, lightTier);
    this.sheetPromise = loadAtlasTexture(elements.sheet).then((sheet) => {
      if (this.disposed) {
        sheet.texture.dispose();
        return;
      }
      this.sheet = sheet;
      return;
    });
    if (inspectionOnly) {
      this.unit = view.unit;
      this.scene.resize(view.width, view.height, this.unit, 1, true);
    } else this.resize();
  }

  private baseTexture(book: AtlasBook): AtlasTexture | null {
    const existing = this.baseTextures.get(book.id);
    if (existing) return existing;
    if (!this.sheet) return null;
    const region = atlasCoverRegion(book, this.elements.sheetCount);
    const sampler = document.createElement("canvas");
    sampler.width = 1;
    sampler.height = 1;
    const context = sampler.getContext("2d");
    const edge = new Color(0x655b4c);
    if (context) {
      context.drawImage(
        this.sheet.image,
        region.x,
        region.y,
        Math.max(1, region.width * 0.04),
        region.height,
        0,
        0,
        1,
        1,
      );
      const pixel = context.getImageData(0, 0, 1, 1).data;
      edge.setRGB(
        (pixel[0] ?? 80) / 255,
        (pixel[1] ?? 75) / 255,
        (pixel[2] ?? 65) / 255,
        SRGBColorSpace,
      );
    }
    const texture = { ...this.sheet, edge, region };
    this.baseTextures.set(book.id, texture);
    return texture;
  }
  private texture(src: string) {
    const existing = this.textures.get(src);
    if (existing) {
      existing.touched = performance.now();
      return existing.pending;
    }
    const entry: TextureEntry = {
      pending: Promise.resolve(null),
      value: null,
      touched: performance.now(),
    };
    entry.pending = loadAtlasTexture(src)
      .then((value) => {
        if (this.disposed || this.textures.get(src) !== entry) {
          value.texture.dispose();
          return null;
        }
        entry.value = value;
        return value;
      })
      .catch(() => null);
    this.textures.set(src, entry);
    this.evict();
    return entry.pending;
  }
  private source(book: AtlasBook) {
    const pixels =
      book.profile.width * this.unit * Math.min(window.devicePixelRatio, this.lightTier ? 1.5 : 2);
    return atlasCoverSource(book.cover, pixels <= 256 ? 256 : pixels <= 512 ? 512 : 768);
  }
  private visibleIndexes() {
    const { camera, width, height, layout } = this.view;
    return layout.positions.flatMap((position, index) => {
      const x = position.x * this.unit + camera.x;
      const y = (ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) * this.unit + camera.y;
      const padding = Math.max(position.width, position.length) * this.unit;
      return x + padding >= 0 && x - padding <= width && y + padding >= 0 && y - padding <= height
        ? [index]
        : [];
    });
  }
  private place(volume: AtlasVolume) {
    const index = this.books.findIndex((book) => book.id === volume.book.id);
    const position = this.view.layout.positions[index];
    if (position) volume.group.position.set(position.x, 0, position.z);
    volume.group.rotation.set(0, position?.rotation ?? volume.book.profile.rotation, 0);
    volume.group.scale.setScalar(position?.scale ?? 1);
    volume.group.visible =
      !!position && (!this.categoryMatches || this.categoryMatches.has(volume.book.id));
  }
  private upgradeIndexes(indexes: number[]) {
    if (this.view.camera.zoom <= 1.4 && this.books.length >= this.elements.sheetCount) return [];
    return indexes
      .toSorted((a, b) => {
        const distance = (index: number) => {
          const position = this.view.layout.positions[index];
          const x = position ? position.x * this.unit + this.view.camera.x : Infinity;
          const y = position
            ? (ATLAS.insetY + position.z * Math.sin(ATLAS.pitch)) * this.unit + this.view.camera.y
            : Infinity;
          return Math.hypot(x - this.view.width / 2, y - this.view.height / 2);
        };
        return distance(a) - distance(b);
      })
      .slice(0, this.lightTier ? 18 : 40);
  }
  private async updateVisible() {
    // Three's async compiler continues polling the original materials. Keep them
    // alive until it finishes, including when search or pickup changes the scene.
    if (this.preparing) await this.preparing;
    if (this.inspection || this.disposed || !this.active) return;
    const indexes = this.visibleIndexes();
    const upgrades = this.upgradeIndexes(indexes);
    const sources = upgrades.map((index) => {
      const book = this.books[index];
      return book ? `${index}:${this.source(book)}` : "";
    });
    const key = `${indexes.join(",")}:${Math.round(this.unit)}:${sources.join(",")}:${this.books.map((book) => book.id).join(",")}`;
    if (key === this.rangeKey) return;
    this.rangeKey = key;
    const request = ++this.requests;
    await this.sheetPromise;
    if (this.disposed || this.inspection || request !== this.requests) return;
    const ids = new Set(indexes.map((index) => this.books[index]?.id));
    for (const [id, volume] of this.volumes) {
      if (!ids.has(id)) {
        volume.dispose();
        this.volumes.delete(id);
        this.cards.get(id)?.removeAttribute("data-live-cover");
      }
    }
    const upgradeIndexes = new Set(upgrades);
    for (const index of indexes) {
      const book = this.books[index];
      if (!book) continue;
      const base = this.baseTexture(book);
      if (!base) continue;
      let volume = this.volumes.get(book.id);
      if (!volume) {
        volume = this.scene.createVolume(book, base, true);
        this.volumes.set(book.id, volume);
      }
      this.place(volume);
      if (
        upgradeIndexes.has(index) &&
        book.profile.width * this.unit * window.devicePixelRatio > 135
      ) {
        const current = volume;
        void this.texture(this.source(book)).then((texture) => {
          // Loading may finish after pickup, filtering, disposal or a different zoom level.
          if (
            !texture ||
            this.disposed ||
            this.inspection ||
            this.volumes.get(book.id) !== current ||
            request !== this.requests
          )
            return;
          if (current.face.material.map === texture.texture) return;
          current.setTexture(texture);
          this.invalidate();
          return;
        });
      } else if (volume.face.material.map !== base.texture) volume.setTexture(base);
    }
    if (!this.ready) {
      this.preparing = this.scene.renderer.compileAsync(this.scene.scene, this.scene.camera);
      await this.preparing;
      this.preparing = null;
      if (this.disposed || !this.active || this.inspection || request !== this.requests) return;
      this.ready = true;
      this.scene.render();
      this.publishFrame();
      this.elements.atlas.dataset.atlasReady = "true";
      this.elements.atlas.dataset.atlasReadyAt = performance.now().toFixed(1);
      performance.mark("bookshelf:atlas-ready");
    }
    this.invalidate();
    this.evict();
  }
  private evict() {
    const used = new Set([...this.volumes.values()].map((volume) => volume.face.material.map));
    if (this.inspection) used.add(this.inspection.browsingTexture.texture);
    for (const [src, entry] of [...this.textures].toSorted((a, b) => a[1].touched - b[1].touched)) {
      if (this.textures.size <= (this.lightTier ? 36 : 72)) break;
      if (entry.value && used.has(entry.value.texture)) continue;
      entry.value?.texture.dispose();
      this.textures.delete(src);
    }
    this.elements.atlas.dataset.atlasTextures = String(this.textures.size + 1);
    this.elements.atlas.dataset.atlasModels = String(this.volumes.size);
  }
  setBooks(books: AtlasBook[]) {
    this.books = books;
    this.rangeKey = "";
    this.requests++;
  }
  setCategoryMatches(matches: Set<string> | null) {
    this.categoryMatches = matches;
    // Muted books use the same printed geometry under the canvas, where CSS
    // can wash out the cover without altering shared artwork textures.
    if (!this.inspection) {
      for (const volume of this.volumes.values()) this.place(volume);
      this.invalidate();
    }
  }
  setView(view: AtlasView) {
    const movedLayout = view.layout !== this.view.layout;
    this.view = view;
    if (movedLayout) {
      this.rangeKey = "";
      if (!this.inspection) for (const volume of this.volumes.values()) this.place(volume);
    }
    this.resize();
  }
  resize(origin?: DOMRect) {
    if (this.disposed) return;
    const oldUnit = this.unit;
    this.unit = this.view.unit * this.view.camera.zoom;
    if (!Number.isFinite(this.unit) || this.unit <= 0 || this.view.width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio, this.lightTier ? 1.5 : 2);
    if (this.inspection) {
      if (oldUnit !== this.unit) {
        this.inspection.from.scale *= oldUnit / this.unit;
        this.inspection.current.scale *= oldUnit / this.unit;
      }
      if (origin) {
        this.inspection.table.x = origin.x + origin.width / 2;
        this.inspection.table.y = origin.y + origin.height / 2;
        if (this.inspectionOnly) {
          const { width, height } = this.inspection.volume.book.profile;
          this.inspection.table.scale =
            Math.min(origin.width / width, origin.height / height) / this.unit;
        }
      }
      this.scene.resize(window.innerWidth, window.innerHeight, this.unit, dpr, true);
      this.invalidate();
      return;
    }
    this.scene.resize(this.view.width, this.view.height, this.unit, dpr);
    this.scene.scroll(-this.view.camera.x, -this.view.camera.y);
    void this.updateVisible().catch(() => {
      if (!this.disposed) this.failed();
    });
    this.invalidate();
  }
  private invalidate() {
    if ((!this.ready && !this.inspection) || this.frame || this.disposed || !this.active) return;
    this.frame = requestAnimationFrame((time) => this.draw(time));
  }
  private publishFrame() {
    const root = this.elements.atlas;
    root.dataset.atlasGpuTextures = String(this.scene.renderer.info.memory.textures);
    root.dataset.atlasGpuGeometries = String(this.scene.renderer.info.memory.geometries);
    root.dataset.atlasFrames = String(++this.frames);
    if (!this.inspection)
      for (const [id, volume] of this.volumes) {
        if (volume.group.visible) this.cards.get(id)?.setAttribute("data-live-cover", "true");
        else this.cards.get(id)?.removeAttribute("data-live-cover");
      }
  }
  private draw(time: number) {
    this.frame = 0;
    if (!this.active || this.disposed) return;
    const moving = this.inspection ? this.drawInspection(time) : false;
    this.scene.render(!this.inspection);
    this.publishFrame();
    if (moving) this.invalidate();
  }

  async inspect(id: string, origin: DOMRect) {
    if (this.disposed || this.inspection) return;
    const request = ++this.inspectionGeneration;
    await this.sheetPromise;
    if (this.preparing) await this.preparing;
    if (this.disposed || request !== this.inspectionGeneration || !this.elements.dialog.open)
      return;
    const book = this.books.find((candidate) => candidate.id === id);
    const base = book ? this.baseTexture(book) : null;
    if (!book || !base) return;
    this.requests++;
    let volume = this.volumes.get(id);
    const browsingTexture = this.textures.get(this.source(book))?.value ?? base;
    if (!volume) {
      volume = this.scene.createVolume(book, browsingTexture);
      this.place(volume);
    } else if (volume.compact) {
      const old = volume;
      volume = this.scene.createVolume(book, browsingTexture);
      volume.group.position.copy(old.group.position);
      volume.group.quaternion.copy(old.group.quaternion);
      volume.group.scale.copy(old.group.scale);
      old.dispose();
    }
    this.volumes.set(id, volume);
    const bounds = this.elements.stage.getBoundingClientRect();
    const projected = volume.group.position.clone().project(this.scene.camera);
    const pose: Pose = this.inspectionOnly
      ? {
          x: origin.x + origin.width / 2,
          y: origin.y + origin.height / 2,
          centered: 0,
          scale:
            Math.min(origin.width / book.profile.width, origin.height / book.profile.height) /
            this.unit,
          rotation: new Quaternion().setFromEuler(new Euler(Math.PI / 2 - ATLAS.pitch, 0, 0)),
        }
      : {
          x: bounds.left + ((projected.x + 1) * bounds.width) / 2,
          y: bounds.top + ((1 - projected.y) * bounds.height) / 2,
          centered: 0,
          scale: volume.group.scale.x,
          rotation: volume.group.quaternion.clone(),
        };
    const placement = this.view.layout.positions[this.books.indexOf(book)];
    const table: Pose = this.inspectionOnly
      ? { ...pose, rotation: pose.rotation.clone() }
      : {
          x: origin.x + origin.width / 2,
          y: origin.y + origin.height / 2,
          centered: 0,
          scale: placement?.scale ?? 1,
          rotation: new Quaternion().setFromEuler(
            new Euler(0, placement?.rotation ?? book.profile.rotation, 0),
          ),
        };
    const { canvas, frozen, inspectorCanvas, dialog } = this.elements;
    volume.group.visible = false;
    this.scene.render();
    frozen.width = canvas.width;
    frozen.height = canvas.height;
    frozen.getContext("2d")?.drawImage(canvas, 0, 0);
    frozen.hidden = false;
    for (const candidate of this.volumes.values()) candidate.group.visible = candidate === volume;
    this.inspection = {
      volume,
      browsingTexture,
      from: pose,
      current: { ...pose, rotation: pose.rotation.clone() },
      table,
      phase: "opening",
      started: performance.now(),
      yaw: 0.1,
      pitch: -0.025,
      resolve: null,
    };
    inspectorCanvas.append(canvas);
    this.scene.showGround(false);
    this.resize();
    dialog.dataset.inspectorReady = "true";
    this.drawInspection(performance.now());
    this.scene.render(false);
    this.invalidate();
    const texture = await this.texture(book.cover.src);
    if (texture && this.inspection?.volume === volume && !this.disposed) {
      volume.setTexture(texture);
      this.invalidate();
    }
  }
  private facing(state: Inspection) {
    const rotation = new Quaternion().setFromEuler(
      new Euler(Math.PI / 2 - ATLAS.pitch + state.pitch, 0, 0),
    );
    rotation.premultiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, Math.cos(ATLAS.pitch), -Math.sin(ATLAS.pitch)),
        state.yaw,
      ),
    );
    return rotation;
  }
  private drawInspection(time: number) {
    const state = this.inspection;
    if (!state) return false;
    const bounds = this.elements.anchor.getBoundingClientRect();
    const profile = state.volume.book.profile;
    const target: Pose =
      state.phase === "closing"
        ? state.table
        : {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            centered: 1,
            scale:
              (Math.min(bounds.width / profile.width, bounds.height / profile.height) / this.unit) *
              0.96,
            rotation: this.facing(state),
          };
    const progress =
      state.phase === "open" ? 1 : Math.min(1, (time - state.started) / ATLAS.pickupDuration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const pose = state.current;
    pose.x = state.from.x + (target.x - state.from.x) * eased;
    pose.y = state.from.y + (target.y - state.from.y) * eased;
    pose.scale = state.from.scale + (target.scale - state.from.scale) * eased;
    pose.centered = state.from.centered + (target.centered - state.from.centered) * eased;
    pose.rotation.copy(state.from.rotation).slerp(target.rotation, eased);
    const group = state.volume.group;
    group.scale.setScalar(pose.scale);
    group.quaternion.copy(pose.rotation);
    group.position.set(
      (pose.x - innerWidth / 2) / this.unit,
      0,
      (pose.y - innerHeight / 2) / this.unit / Math.sin(ATLAS.pitch),
    );
    // Table models pivot at the bottom board. Inspection centers the physical
    // volume, including its thickness, and blends back to the table's pivot.
    group.position.sub(
      new Vector3(0, (profile.depth + 0.006) / 2, 0)
        .applyQuaternion(pose.rotation)
        .multiplyScalar(pose.scale * pose.centered),
    );
    if (progress === 1) {
      if (state.phase === "closing") this.finishInspection();
      else state.phase = "open";
      return false;
    }
    return true;
  }
  rotate(x: number, y: number) {
    const state = this.inspection;
    if (!state || state.phase !== "open") return;
    state.yaw += x;
    state.pitch = Math.max(-Math.PI / 5, Math.min(Math.PI / 5, state.pitch + y));
    this.invalidate();
  }
  refreshInspection() {
    if (this.inspection) this.invalidate();
  }
  resetRotation() {
    if (this.inspection) {
      this.inspection.yaw = 0.1;
      this.inspection.pitch = -0.025;
      this.invalidate();
    }
  }
  closeInspection(animate = true): Promise<void> {
    this.inspectionGeneration++;
    const state = this.inspection;
    if (!state) return Promise.resolve();
    if (!animate || !this.active) {
      this.finishInspection();
      return Promise.resolve();
    }
    if (state.phase === "closing") return Promise.resolve();
    state.from = { ...state.current, rotation: state.current.rotation.clone() };
    state.phase = "closing";
    state.started = performance.now();
    this.invalidate();
    return new Promise((resolve) => {
      state.resolve = resolve;
    });
  }
  private finishInspection() {
    const state = this.inspection;
    if (!state) return;
    this.inspection = null;
    const { canvas, stage, dialog, frozen } = this.elements;
    stage.append(canvas);
    delete dialog.dataset.inspectorReady;
    // Inspection geometry is temporary; repeated pickup must not make the fitted table heavier.
    if (this.inspectionOnly) {
      state.volume.dispose();
      this.volumes.delete(state.volume.book.id);
      frozen.hidden = true;
      state.resolve?.();
      return;
    }
    if (!this.disposed) {
      const restored = this.scene.createVolume(state.volume.book, state.browsingTexture, true);
      this.volumes.set(state.volume.book.id, restored);
      state.volume.dispose();
    }
    for (const volume of this.volumes.values()) {
      volume.group.visible = true;
      this.place(volume);
    }
    const source = state.volume.book.cover.src;
    const entry = this.textures.get(source);
    if (entry && entry.value?.texture !== state.browsingTexture.texture) {
      entry.value?.texture.dispose();
      // Deleting a pending entry also makes its eventual load dispose itself.
      this.textures.delete(source);
    }
    this.scene.showGround(true);
    this.rangeKey = "";
    if (!this.disposed) {
      this.resize();
      this.scene.render();
      this.publishFrame();
    }
    frozen.hidden = true;
    state.resolve?.();
    this.evict();
  }
  suspend(suspended: boolean) {
    this.active = !suspended;
    if (suspended) {
      if (this.inspection?.phase === "closing") this.finishInspection();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else {
      this.resize();
      this.invalidate();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.inspectionGeneration++;
    this.requests++;
    this.finishInspection();
    cancelAnimationFrame(this.frame);
    const release = () => {
      for (const volume of this.volumes.values()) volume.dispose();
      for (const texture of this.textures.values()) texture.value?.texture.dispose();
      this.sheet?.texture.dispose();
      this.volumes.clear();
      this.textures.clear();
      this.baseTextures.clear();
      this.scene.dispose();
      return undefined;
    };
    if (this.preparing) void this.preparing.then(release, release);
    else release();
    delete this.elements.atlas.dataset.atlasReady;
    for (const card of this.cards.values()) card.removeAttribute("data-live-cover");
  }
}
