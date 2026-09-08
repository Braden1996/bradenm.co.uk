type Point = { x: number; y: number; z: number };
type Facet = { element: HTMLElement; vertices: [number, number, number] };

/** A connected paper mesh made from inert copies of the actual, typeset note. */
export function crumpleNote(note: HTMLElement) {
  const bounds = note.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "book-note-crumple";
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  const target = {
    x: bounds.width / 2,
    y: Math.max(28, Math.min(bounds.height / 2, innerHeight - bounds.top - 48)),
  };
  layer.style.perspectiveOrigin = `${target.x}px ${target.y}px`;
  const columns = 4;
  const rows = 3;
  const original: Point[] = [];
  const folded: Point[] = [];
  const facets: Facet[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const v = row / rows;
      original.push({ x: u * bounds.width, y: v * bounds.height, z: 0 });
      const longitude = u * Math.PI * 3.6 + v * 0.7;
      const latitude = (v - 0.5) * Math.PI * 1.65;
      const radius = 27 + Math.sin(row * 7 + column * 11) * 4;
      folded.push({
        x: target.x + radius * Math.cos(latitude) * Math.sin(longitude),
        y: target.y + radius * Math.sin(latitude),
        z: radius * Math.cos(latitude) * Math.cos(longitude),
      });
    }
  }
  function addFacet(vertices: Facet["vertices"]) {
    const element = document.createElement("div");
    element.className = "book-note-crumple__facet";
    const points = vertices.map((index) => original[index]);
    if (points.some((point) => !point)) return;
    element.style.clipPath = `polygon(${points.map((point) => `${point?.x}px ${point?.y}px`).join(",")})`;
    const copy = note.cloneNode(true);
    if (!(copy instanceof HTMLElement)) return;
    copy.removeAttribute("id");
    for (const item of copy.querySelectorAll("[id]")) item.removeAttribute("id");
    element.append(copy);
    layer.append(element);
    facets.push({ element, vertices });
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const d = a + columns + 1;
      const c = d + 1;
      addFacet([a, b, c]);
      addFacet([a, c, d]);
    }
  }
  const core = document.createElement("div");
  core.className = "book-note-crumple__core";
  core.style.left = `${target.x - 26}px`;
  core.style.top = `${target.y - 26}px`;
  layer.prepend(core);
  note.closest("dialog")?.append(layer);
  note.dataset.crumpling = "true";
  let frame = 0;
  const started = performance.now();
  const { promise: finished, resolve } = Promise.withResolvers<void>();
  function cancel() {
    cancelAnimationFrame(frame);
    layer.remove();
    delete note.dataset.crumpling;
    resolve();
  }
  function draw(time: number) {
    const progress = Math.min(1, (time - started) / 720);
    const fold = Math.min(1, progress / 0.8);
    const eased = fold * fold * (3 - 2 * fold);
    const crease = Math.sin(fold * Math.PI) * Math.min(70, bounds.height * 0.2);
    const points = original.map((point, index) => {
      const end = folded[index] ?? point;
      return {
        x: point.x + (end.x - point.x) * eased,
        y: point.y + (end.y - point.y) * eased,
        z: end.z * eased + Math.sin(index * 2.3) * crease,
      };
    });
    for (const facet of facets) {
      const [i, j, k] = facet.vertices;
      const a = original[i];
      const b = original[j];
      const c = original[k];
      const p = points[i];
      const q = points[j];
      const r = points[k];
      if (!a || !b || !c || !p || !q || !r) continue;
      const bx = b.x - a.x;
      const by = b.y - a.y;
      const cx = c.x - a.x;
      const cy = c.y - a.y;
      const determinant = bx * cy - cx * by;
      const x = {
        x: ((q.x - p.x) * cy - (r.x - p.x) * by) / determinant,
        y: ((q.y - p.y) * cy - (r.y - p.y) * by) / determinant,
        z: ((q.z - p.z) * cy - (r.z - p.z) * by) / determinant,
      };
      const y = {
        x: ((r.x - p.x) * bx - (q.x - p.x) * cx) / determinant,
        y: ((r.y - p.y) * bx - (q.y - p.y) * cx) / determinant,
        z: ((r.z - p.z) * bx - (q.z - p.z) * cx) / determinant,
      };
      const translation = {
        x: p.x - x.x * a.x - y.x * a.y,
        y: p.y - x.y * a.x - y.y * a.y,
        z: p.z - x.z * a.x - y.z * a.y,
      };
      facet.element.style.transform = `matrix3d(${x.x},${x.y},${x.z},0,${y.x},${y.y},${y.z},0,0,0,1,0,${translation.x},${translation.y},${translation.z},1)`;
      // The changing facet normal catches the same upper-left light as the books.
      const nx = x.y * y.z - x.z * y.y;
      const ny = x.z * y.x - x.x * y.z;
      const nz = x.x * y.y - x.y * y.x;
      const normal = Math.hypot(nx, ny, nz) || 1;
      const light = Math.abs((-nx * 0.35 - ny * 0.45 + nz * 0.82) / normal);
      facet.element.style.filter = `brightness(${1 + (0.73 + light * 0.34 - 1) * Math.sin((fold * Math.PI) / 2)})`;
    }
    core.style.opacity = String(Math.max(0, (progress - 0.6) / 0.2));
    core.style.transform = `scale(${0.75 + eased * 0.25}) rotate(${eased * 24}deg)`;
    layer.style.opacity = String(Math.min(1, (1 - progress) / 0.18));
    layer.style.translate = `0 ${-Math.max(0, progress - 0.8) * 55}px`;
    if (progress < 1) frame = requestAnimationFrame(draw);
    else cancel();
  }
  draw(started);
  return { finished, cancel };
}
