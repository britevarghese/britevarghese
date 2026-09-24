// Imports the licensed real-car models listed in src/vehicles/VehicleCatalog.js (CARS[*].source):
// downloads them from Sketchfab, converts them to NIGHTSHIFT's vehicle layout (tools/carimport/process.mjs),
// compresses textures (WebP) and geometry (meshopt), writes public/assets/models/cars/<id>.glb and
// registers them in public/assets/models/manifest.json + CREDITS.md.
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-cars.mjs            # everything not imported yet
//   node tools/import-cars.mjs --only bmw_m3_e30,audi_r8_v10 --force
//   node tools/import-cars.mjs --src bmw_m3_e30=path/to/model.glb   # use a file you downloaded yourself
//   node tools/import-cars.mjs --src bmw_m3_e30=x.glb --out /tmp/test --no-manifest   # dry run
//
// The token is on https://sketchfab.com/settings/password (API token). Downloads are cached in .cache/cars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { CARS } from '../src/vehicles/VehicleCatalog.js';
import { processCar } from './carimport/process.mjs';

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

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const report = {};
const targets = Object.values(CARS).filter((c) => c.real && c.source && (!only || only.includes(c.id)) && (!srcOverrides || !Object.keys(srcOverrides).length || srcOverrides[c.id] || only));
for (const car of targets) {
  const outFile = path.join(outDir, `${car.id}.glb`);
  if (!force && writeManifest && manifest.cars[car.id]?.imported && fs.existsSync(outFile)) { console.log(`= ${car.id} already imported (--force to redo)`); continue; }
  console.log(`> ${car.id}  ${car.name}  [${car.source.title} by ${car.source.author}]`);
  try {
    const src = await resolveSource(car);
    const doc = await io.read(src);
    const { log, info } = processCar(doc, car, { verbose: true });
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
  const lines = ['# Vehicle model credits', '', 'Real-car 3D models are used under the Creative Commons Attribution 4.0 license (https://creativecommons.org/licenses/by/4.0/).',
    'They were converted for real-time use (re-scaled, wheels separated, simplified, textures re-encoded). Car names and badges are trademarks of their respective manufacturers; NIGHTSHIFT is a non-commercial fan project and is not endorsed by them.', ''];
  for (const [id, c] of imported) lines.push(`- **${CARS[id]?.name || c.name}** — "${c.source.title}" by ${c.source.author}, ${c.source.url} (CC BY 4.0), modified.`);
  if (!imported.length) lines.push('_No real-car models imported yet — run `node tools/import-cars.mjs`._');
  fs.writeFileSync(path.join(ROOT, 'public/assets/models/cars/CREDITS.md'), lines.join('\n') + '\n');
}
fs.mkdirSync(cacheRoot, { recursive: true });
fs.writeFileSync(path.join(cacheRoot, 'report.json'), JSON.stringify(report, null, 2));
const ok = Object.values(report).filter((r) => r.ok).length;
console.log(`done: ${ok}/${Object.keys(report).length} converted${writeManifest ? ', manifest updated' : ''}`);
