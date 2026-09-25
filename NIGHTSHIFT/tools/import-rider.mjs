// Imports the motorcycle rider: a rigged CC BY 4.0 character from Sketchfab (Ready Player Me style
// skeleton), with textures re-encoded as WebP and geometry compressed. The game poses its bones onto
// each bike's seat, bars and pegs at runtime (src/vehicles/Rider.js).
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-rider.mjs      (download is cached in .cache/rider)
//   node tools/import-rider.mjs --src path/to/biker.glb       (a copy you downloaded yourself)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

export const RIDER_SOURCE = { site: 'Sketchfab', uid: '1594447c9f2d4b618dd59fd3272b6db6', title: 'Biker', author: 'Idris.Abass', license: 'CC-BY-4.0' };
RIDER_SOURCE.url = `https://sketchfab.com/3d-models/${RIDER_SOURCE.uid}`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const srcArg = args.includes('--src') ? args[args.indexOf('--src') + 1] : null;
const cache = path.join(ROOT, '.cache/rider/biker.glb');

async function source() {
  if (srcArg) return path.resolve(srcArg);
  if (fs.existsSync(cache)) return cache;
  const token = process.env.SKETCHFAB_API_TOKEN;
  if (!token) throw new Error('no SKETCHFAB_API_TOKEN; or pass --src <file> with the model you downloaded');
  const res = await fetch(`https://api.sketchfab.com/v3/models/${RIDER_SOURCE.uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Sketchfab download API ${res.status}`);
  const { glb } = await res.json();
  if (!glb) throw new Error('no GLB download offered');
  const file = await fetch(glb.url);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, new Uint8Array(await file.arrayBuffer()));
  return cache;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(await source());
// the eyes and teeth sit inside a closed full-face helmet: nobody sees them
for (const node of doc.getRoot().listNodes()) {
  const mat = node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() || '';
  if (/Wolf3D_(Eye|Teeth)/.test(mat)) { node.setMesh(null); }
}
for (const mat of doc.getRoot().listMaterials()) mat.setExtension('KHR_materials_specular', null);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 85 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const out = path.join(ROOT, 'public/assets/models/rider.glb');
const glb = await io.writeBinary(doc);
fs.writeFileSync(out, glb);
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.rider = { file: 'rider.glb', source: RIDER_SOURCE };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
// credits: keep the line in cars/CREDITS.md (import-cars.mjs writes it too)
const credits = path.join(ROOT, 'public/assets/models/cars/CREDITS.md');
const line = `- **Motorcycle rider** — "${RIDER_SOURCE.title}" by ${RIDER_SOURCE.author}, ${RIDER_SOURCE.url} (CC BY 4.0), modified.`;
const text = fs.readFileSync(credits, 'utf8').split('\n').filter((l) => !l.includes('**Motorcycle rider**'));
while (text.length && text.at(-1) === '') text.pop();
fs.writeFileSync(credits, [...text, line, ''].join('\n'));
console.log(`wrote ${path.relative(ROOT, out)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
