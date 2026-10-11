// Imports the first-person driver's arms: rigged hands in black leather riding gloves (hard knuckles) and
// jacket sleeves (CC BY 4.0, Sketchfab), textures re-encoded as WebP and geometry compressed. The game poses
// the bones onto the steering wheel rim at runtime (src/vehicles/Driver.js, FPArms).
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-hands.mjs     (download is cached in .cache/props/fp_gloves)
//   node tools/import-hands.mjs --src path/to/hands.glb      (a copy you downloaded yourself)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { stampModels } from './carimport/stamp.mjs';

export const HANDS_SOURCE = { site: 'Sketchfab', uid: '5a6a434b8ec943ffacc581358781eecb', title: 'Hand With Gloves', author: 'teenjust500', license: 'CC-BY-4.0' };
HANDS_SOURCE.url = `https://sketchfab.com/3d-models/${HANDS_SOURCE.uid}`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const srcArg = args.includes('--src') ? args[args.indexOf('--src') + 1] : null;
const cache = path.join(ROOT, '.cache/props/fp_gloves/model.glb');

async function source() {
  if (srcArg) return path.resolve(srcArg);
  if (fs.existsSync(cache)) return cache;
  const token = process.env.SKETCHFAB_API_TOKEN;
  if (!token) throw new Error('no SKETCHFAB_API_TOKEN; or pass --src <file> with the model you downloaded');
  const res = await fetch(`https://api.sketchfab.com/v3/models/${HANDS_SOURCE.uid}/download`, { headers: { Authorization: `Token ${token}` } });
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
// (the source's animations are no use: the game poses the bones itself; nor its crosshair and the static
// reference shape: only the skinned gloves and sleeves)
for (const a of doc.getRoot().listAnimations()) a.dispose();
for (const node of doc.getRoot().listNodes()) if (node.getMesh() && !node.getSkin()) node.setMesh(null);
for (const mat of doc.getRoot().listMaterials()) mat.setExtension('KHR_materials_specular', null);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  prune(), dedup(),
  // (seen close up, filling the bottom of the screen: the leather keeps its full 1K detail)
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const out = path.join(ROOT, 'public/assets/models/fp_hands.glb');
const glb = await io.writeBinary(doc);
fs.writeFileSync(out, glb);
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.fpHands = { file: 'fp_hands.glb', source: HANDS_SOURCE };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
// credits: next to the rider's line in cars/CREDITS.md
const credits = path.join(ROOT, 'public/assets/models/cars/CREDITS.md');
const line = `- **Driver's gloved hands (first person)** — "${HANDS_SOURCE.title}" by ${HANDS_SOURCE.author}, ${HANDS_SOURCE.url} (CC BY 4.0), modified.`;
const text = fs.readFileSync(credits, 'utf8').split('\n').filter((l) => !/\*\*Driver's (gloved )?hands \(first person\)\*\*/.test(l));
while (text.length && text.at(-1) === '') text.pop();
fs.writeFileSync(credits, [...text, line, ''].join('\n'));
stampModels(ROOT); // cache-busting fingerprints for the game
console.log(`wrote ${path.relative(ROOT, out)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
