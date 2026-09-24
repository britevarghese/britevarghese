// postinstall: download the default rigged soldier (three.js example asset, Mixamo) — no extra dependencies.
import fs from 'node:fs';
import path from 'node:path';

const URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb';
const dst = path.resolve('client/assets/characters/soldier_default.glb');
if (fs.existsSync(dst) && fs.statSync(dst).size > 1e6) process.exit(0);
fs.mkdirSync(path.dirname(dst), { recursive: true });
for (let i = 0; i < 4; i++) {
  try {
    const r = await fetch(URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
    console.log(`default soldier installed -> ${path.relative(process.cwd(), dst)}`);
    process.exit(0);
  } catch (e) {
    console.warn(`soldier download failed (${e.message}), retrying…`);
    await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
  }
}
console.error('Could not download the default soldier. Put your own GLB at client/assets/user/characters/soldier.glb');
