// Developer preview: renders the valley from a camera given in the URL, for screenshots while building.
//   preview.html?cam=x,y,z&look=x,y,z&hour=16.5
import * as THREE from 'three';
import { generateWorld } from '../world/WorldGen.js';
import { World } from '../world/World.js';
import { Renderer } from '../render/Renderer.js';
import { TerrainRenderer } from '../render/Terrain.js';

const q = new URLSearchParams(location.search);
const vec = (s, d) => (s ? s.split(',').map(Number) : d);
const info = document.getElementById('info');
const t0 = performance.now();
const data = await generateWorld({ onProgress: (f, l) => { info.textContent = `${l} ${(f * 100).toFixed(0)}%`; } });
const world = new World(data);
window.world = world;
const r = new Renderer(document.getElementById('app'));
r.setTime(Number(q.get('hour') || 16.5));
const terrain = new TerrainRenderer(world, r.scene);
terrain.budget = 4000;
const [cx, cy, cz] = vec(q.get('cam'), [-60, 140, 620]);
const [lx, ly, lz] = vec(q.get('look'), [-60, 70, 430]);
r.camera.position.set(cx, cy, cz);
r.camera.lookAt(lx, ly, lz);
window.extra = [];
const mods = (q.get('mods') || '').split(',').filter(Boolean);
for (const m of mods) {
  const mod = await import(`../render/${m}.js`);
  if (mod.preview) window.extra.push(await mod.preview(world, r));
}
terrain.update(r.camera.position);
r.updateSun(new THREE.Vector3(lx, ly, lz));
for (const e of window.extra) e?.update?.(r.camera, 0.016);
r.render();
info.textContent = `gen ${data.genMs} ms, total ${(performance.now() - t0).toFixed(0)} ms, patches ${terrain.visibleCount}, tris ${r.renderer.info.render.triangles}, calls ${r.renderer.info.render.calls}`;
window.__ready = true;
