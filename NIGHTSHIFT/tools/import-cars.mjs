// Imports the licensed real-car models listed in src/vehicles/VehicleCatalog.js (CARS[*].source):
// downloads them from Sketchfab, converts them to NIGHTSHIFT's vehicle layout (tools/carimport/process.mjs),
// compresses textures (WebP) and geometry (meshopt), writes public/assets/models/cars/<id>.glb and
// registers them in public/assets/models/manifest.json + CREDITS.md.
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-cars.mjs            # everything not imported yet
//   node tools/import-cars.mjs --only bmw_m3_e30,audi_r8_v10 --force
//   node tools/import-cars.mjs --traffic                              # the realistic traffic models
//   node tools/import-cars.mjs --src bmw_m3_e30=path/to/model.glb   # use a file you downloaded yourself
//   node tools/import-cars.mjs --src bmw_m3_e30=x.glb --out /tmp/test --no-manifest   # dry run
//   node tools/import-cars.mjs --traffic --only kl_lorry --out /tmp/test --no-manifest --materials   # where each material sits
//
// The token is on https://sketchfab.com/settings/password (API token). Downloads are cached in .cache/cars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { CARS, TRAFFIC_MODELS } from '../src/vehicles/VehicleCatalog.js';
import { processCar } from './carimport/process.mjs';
import { stampModels } from './carimport/stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const only = opt('only') ? String(opt('only')).split(',') : null;
const force = !!opt('force');
const outDir = path.resolve(opt('out') || path.join(ROOT, 'public/assets/models/cars'));
const writeManifest = !args.includes('--no-manifest');
const maxTex = +(opt('max-texture') || 2048);
const token = opt('token') || process.env.SKETCHFAB_API_TOKEN;
const srcOverrides = Object.fromEntries(args.flatMap((a, i) => (a === '--src' ? [args[i + 1].split('=')] : [])));
// Models downloaded by hand from Sketchfab can simply be dropped into incoming-cars/ (any file name:
// '<car id>.zip' or Sketchfab's own 'model-title.zip' / .glb / .gltf folder). Each file is matched to
// the car whose source model title shares the most words with the file name.
const incomingDir = path.join(ROOT, 'incoming-cars');
if (fs.existsSync(incomingDir)) {
  const words = (t) => new Set(String(t).toLowerCase().replace(/\.(zip|glb|gltf)$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['free', 'model', 'the', '3d', 'low', 'poly', 'lowpoly'].includes(w)));
  const reals = Object.values(CARS).filter((c) => c.real && c.source);
  for (const f of fs.readdirSync(incomingDir)) {
    if (!/\.(zip|glb|gltf)$/i.test(f) && !fs.statSync(path.join(incomingDir, f)).isDirectory()) continue;
    const base = f.replace(/\.(zip|glb|gltf)$/i, '');
    let car = CARS[base]?.real ? CARS[base] : null;
    if (!car) {
      const fw = words(f); let best = 0;
      for (const c of reals) {
        const tw = words(`${c.source.title} ${c.brand} ${c.model}`);
        const hit = [...fw].filter((w) => tw.has(w)).length / Math.max(1, fw.size);
        if (hit > best) { best = hit; car = c; }
      }
      if (best < 0.5) car = null;
    }
    if (!car) { console.log(`incoming-cars/${f}: could not tell which car this is (rename it to <car id>.zip)`); continue; }
    if (!srcOverrides[car.id]) { srcOverrides[car.id] = path.join(incomingDir, f); console.log(`incoming-cars/${f} -> ${car.id}`); }
  }
}
const cacheRoot = path.join(ROOT, '.cache/cars');
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;

async function download(car) {
  const dir = path.join(cacheRoot, car.id);
  fs.mkdirSync(dir, { recursive: true });
  const existing = findModel(dir);
  if (existing) return existing;
  if (!token) throw new Error('no SKETCHFAB_API_TOKEN (or --token); or pass --src <id>=<file> with a model you downloaded');
  const res = await fetch(`https://api.sketchfab.com/v3/models/${car.source.uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Sketchfab download API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const links = await res.json();
  const pickLink = links.glb || links.gltf;
  if (!pickLink) throw new Error(`no glTF download offered (formats: ${Object.keys(links).join(', ')})`);
  console.log(`   downloading ${links.glb ? 'GLB' : 'glTF zip'} ${(pickLink.size / 1048576).toFixed(1)} MB...`);
  const file = await fetch(pickLink.url);
  if (!file.ok) throw new Error(`download failed ${file.status}`);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (links.glb) fs.writeFileSync(path.join(dir, 'model.glb'), buf);
  else for (const [name, data] of Object.entries(unzipSync(buf))) { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!name.endsWith('/')) fs.writeFileSync(p, data); }
  const found = findModel(dir);
  if (!found) throw new Error('downloaded archive contains no .glb/.gltf');
  return found;
}
function findModel(dir) {
  if (!fs.existsSync(dir)) return null;
  const all = fs.readdirSync(dir, { recursive: true }).map(String);
  const f = all.find((n) => n.endsWith('.glb')) || all.find((n) => n.endsWith('.gltf'));
  return f ? path.join(dir, f) : null;
}
async function resolveSource(car) {
  const o = srcOverrides[car.id];
  if (!o) return download(car);
  if (o.endsWith('.zip')) {
    const dir = path.join(cacheRoot, car.id, 'zip');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(unzipSync(fs.readFileSync(o)))) { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!name.endsWith('/')) fs.writeFileSync(p, data); }
    return findModel(dir);
  }
  return path.resolve(o);
}

// windows painted into a body texture, opaque (import.windows): the dark glass inside the window faces' texture
// triangles gets a low alpha (the frames, stickers and lettering round it stay), the material blends
async function seeThrough(doc, { material, tris, dark = 70, alpha = 80 }) {
  const mat = doc.getRoot().listMaterials().find((m) => m.getName() === material), tex = mat?.getBaseColorTexture();
  if (!tex) return;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, done = new Uint8Array(W * H);
  let n = 0;
  for (const t of tris) {
    // (texture coordinates may run past 0-1: repeat)
    const ou = Math.floor(Math.min(t[0], t[2], t[4])), ov = Math.floor(Math.min(t[1], t[3], t[5]));
    const P = [0, 1, 2].map((k) => [(t[k * 2] - ou) * W, (t[k * 2 + 1] - ov) * H]);
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-6) continue;
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((P[2][0] - P[0][0]) * (py - P[0][1]) - (px - P[0][0]) * (P[2][1] - P[0][1])) / -area;
      const w2 = ((px - P[0][0]) * (P[1][1] - P[0][1]) - (P[1][0] - P[0][0]) * (py - P[0][1])) / -area;
      if (w1 < 0 || w2 < 0 || w1 + w2 > 1 || done[y * W + x]) continue;
      done[y * W + x] = 1;
      const i = (y * W + x) * 4;
      if (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] < dark) { data[i + 3] = Math.min(data[i + 3], alpha); n++; }
    }
  }
  tex.setImage(new Uint8Array(await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer())).setMimeType('image/png');
  mat.setAlphaMode('BLEND');
  console.log(`   windows: ${n} texels of glass made see-through`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const report = {};
// --traffic: the realistic traffic models (TRAFFIC_MODELS) instead of the player cars
const pool = args.includes('--traffic') ? Object.values(TRAFFIC_MODELS) : Object.values(CARS);
const targets = pool.filter((c) => c.real && c.source && (!only || only.includes(c.id)) && (!srcOverrides || !Object.keys(srcOverrides).length || srcOverrides[c.id] || only));
for (const car of targets) {
  const outFile = path.join(outDir, `${car.id}.glb`);
  if (!force && writeManifest && manifest.cars[car.id]?.imported && fs.existsSync(outFile)) { console.log(`= ${car.id} already imported (--force to redo)`); continue; }
  console.log(`> ${car.id}  ${car.name}  [${car.source.title} by ${car.source.author}]`);
  try {
    const src = await resolveSource(car);
    const doc = await io.read(src);
    await doc.transform(metalRough()); // older models store colour as specular-glossiness: convert it, or the textures are lost
    const { log, info, windowUV } = processCar(doc, car, { verbose: true, budget: car.budget, materials: args.includes('--materials') });
    if (windowUV?.tris.length) await seeThrough(doc, windowUV);
    doc.createExtension(EXTTextureWebP).setRequired(true);
    await doc.transform(
      dedup(), prune({ keepLeaves: true, keepAttributes: false }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 86 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const glb = await io.writeBinary(doc);
    fs.writeFileSync(outFile, glb);
    console.log(`   wrote ${path.relative(ROOT, outFile)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
    report[car.id] = { ok: true, bytes: glb.byteLength, ...info, log };
    if (writeManifest) {
      manifest.cars[car.id] = {
        file: `cars/${car.id}.glb`, imported: true, name: car.name, class: car.class,
        length: info.length, width: info.width, height: info.height, wheels: info.wheels, tris: info.tris,
        source: car.source,
      };
    }
  } catch (e) {
    console.log(`   FAILED: ${e.message}`);
    report[car.id] = { ok: false, error: e.message };
  }
}
if (writeManifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const imported = Object.entries(manifest.cars).filter(([, c]) => c.imported);
  const lines = ['# Vehicle model credits', '', 'Real car and motorcycle 3D models are used under the Creative Commons Attribution 4.0 license (https://creativecommons.org/licenses/by/4.0/).',
    'They were converted for real-time use (re-scaled, wheels separated, simplified, textures re-encoded). Vehicle names and badges are trademarks of their respective manufacturers; NIGHTSHIFT is a non-commercial fan project and is not endorsed by them.', ''];
  for (const [id, c] of imported) lines.push(`- **${CARS[id]?.name || c.name}** — "${c.source.title}" by ${c.source.author}, ${c.source.url} (CC BY 4.0), modified.`);
  if (!imported.length) lines.push('_No real-car models imported yet — run `node tools/import-cars.mjs`._');
  const rs = manifest.rider?.source; // written by tools/import-rider.mjs
  if (rs) lines.push(`- **Motorcycle rider** — "${rs.title}" by ${rs.author}, ${rs.url} (CC BY 4.0), modified.`);
  const hs = manifest.fpHands?.source; // written by tools/import-hands.mjs
  if (hs) lines.push(`- **Driver's gloved hands (first person)** — "${hs.title}" by ${hs.author}, ${hs.url} (CC BY 4.0), modified.`);
  fs.writeFileSync(path.join(ROOT, 'public/assets/models/cars/CREDITS.md'), lines.join('\n') + '\n');
}
stampModels(ROOT); // cache-busting fingerprints for the game
fs.mkdirSync(cacheRoot, { recursive: true });
fs.writeFileSync(path.join(cacheRoot, 'report.json'), JSON.stringify(report, null, 2));
const ok = Object.values(report).filter((r) => r.ok).length;
console.log(`done: ${ok}/${Object.keys(report).length} converted${writeManifest ? ', manifest updated' : ''}`);
