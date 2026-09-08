import { AtlasScene, loadAtlasTexture } from "../../src/features/bookshelf/client/atlas-scene";
import { ATLAS, type AtlasBook } from "../../src/features/bookshelf/lib/atlas-layout";

declare global {
  interface Window {
    renderAtlasPreview: (book: AtlasBook) => Promise<string>;
  }
}

const canvas = document.createElement("canvas");
document.body.append(canvas);
const scene = new AtlasScene(canvas, false);
scene.resize(640, 640, 640 / ATLAS.sprite, 1, true);

window.renderAtlasPreview = async (book) => {
  const texture = book.cover.src ? await loadAtlasTexture(book.cover.src) : null;
  const volume = scene.createVolume(book, texture);
  await scene.renderer.compileAsync(scene.scene, scene.camera);
  scene.render();
  const url = canvas.toDataURL("image/png");
  volume.dispose();
  texture?.texture.dispose();
  return url;
};
