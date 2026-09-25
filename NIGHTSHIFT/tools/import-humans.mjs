// Imports the people of Port Halvern: rigged CC BY 4.0 characters from Sketchfab that share one
// humanoid skeleton (Ready Player Me style), so one procedural walk / run animation drives them all
// (src/player/Human.js). Textures are re-encoded as WebP and geometry compressed. The first one is
// the player's default look; the rest walk the sidewalks, give missions and stand in for other players.
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-humans.mjs     (downloads are cached in .cache/humans)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

export const HUMANS = [
  { id: 'pmariano', sex: 'm', uid: 'a9c1f5d2cd7c4ca3bb46272998d3e451', title: 'Avatar Full body - Ready Player Me - pmariano', author: 'patomariano' },
  { id: 'alex', sex: 'm', uid: '006dd7a2d3734387ab4ab8d92c868788', title: 'ReadyPlayerMe - Rainbow Family: Alex', author: 'anonim.user.978' },
  { id: 'arnold', sex: 'm', uid: '4cd6354f28f24ca9ab84bf182279286a', title: 'ReadyPlayerMe - Rainbow Family: Arnold', author: 'anonim.user.978' },
  { id: 'jake', sex: 'm', uid: '73c342982ea74c63b5a9bb1fc3cfb2e7', title: 'ReadyPlayerMe - Sports Couple: Jake', author: 'anonim.user.978' },
  { id: 'kenzie', sex: 'm', uid: '3c026db1453644eba3f60afc885998e7', title: 'Kenzie ready player me avatar', author: 'Kenz.makes.3D' },
  { id: 'emilius', sex: 'm', uid: '68839614ac7947a2998148892e2a0c4c', title: 'Avatar Fullbody - Ready Player Me', author: 'emiliusvgs' },
  { id: 'songbird', sex: 'f', uid: 'd739dfe5ac6d46d69886f660cdf6649c', title: 'ReadyPlayerMe - Lifestyle Series: Songbird', author: 'anonim.user.978' },
  { id: 'lucy', sex: 'f', uid: '152e5e3aed3b408085b14b7aa580d87f', title: 'ReadyPlayerMe - Sports Couple: Lucy', author: 'anonim.user.978' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(ROOT, '.cache/humans');
const outDir = path.join(ROOT, 'public/assets/models/humans');
const token = process.env.SKETCHFAB_API_TOKEN;

async function source(h) {
  const file = path.join(cacheDir, `${h.id}.glb`);
  if (fs.existsSync(file)) return file;
  if (!token) throw new Error('no SKETCHFAB_API_TOKEN');
  const res = await fetch(`https://api.sketchfab.com/v3/models/${h.uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Sketchfab download API ${res.status}`);
  const { glb } = await res.json();
  if (!glb) throw new Error('no GLB download offered');
  const data = await fetch(glb.url);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, new Uint8Array(await data.arrayBuffer()));
  return file;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(outDir, { recursive: true });
const done = [];
for (const h of HUMANS) {
  try {
    const doc = await io.read(await source(h));
    if (!doc.getRoot().listSkins().length) throw new Error('not rigged');
    // single-mesh texture-atlas avatars (material "Wolf3D_Avatar") don't survive the conversion: skip them
    if (doc.getRoot().listMaterials().some((m) => m.getName() === 'Wolf3D_Avatar')) throw new Error('atlas avatar, not supported');
    for (const a of doc.getRoot().listAnimations()) a.dispose();
    for (const mat of doc.getRoot().listMaterials()) mat.setExtension('KHR_materials_specular', null);
    doc.createExtension(EXTTextureWebP).setRequired(true);
    await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const glb = await io.writeBinary(doc);
    fs.writeFileSync(path.join(outDir, `${h.id}.glb`), glb);
    console.log(`${h.id.padEnd(10)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
    done.push(h);
  } catch (e) { console.log(`${h.id}: FAILED ${e.message}`); }
}
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.humans = done.map((h) => ({ id: h.id, sex: h.sex, file: `humans/${h.id}.glb`, source: { site: 'Sketchfab', uid: h.uid, title: h.title, author: h.author, url: `https://sketchfab.com/3d-models/${h.uid}`, license: 'CC-BY-4.0' } }));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const lines = ['# People credits', '', 'Character models are used under the Creative Commons Attribution 4.0 license (https://creativecommons.org/licenses/by/4.0/). They were converted for real-time use (animations removed, textures re-encoded, geometry compressed); the game animates them procedurally.', ''];
for (const h of done) lines.push(`- "${h.title}" by ${h.author}, https://sketchfab.com/3d-models/${h.uid} (CC BY 4.0), modified.`);
fs.writeFileSync(path.join(outDir, 'CREDITS.md'), lines.join('\n') + '\n');
console.log(`done: ${done.length}/${HUMANS.length}`);
