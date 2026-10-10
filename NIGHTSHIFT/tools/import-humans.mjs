// Imports the people of Port Halvern: rigged CC BY 4.0 characters from Sketchfab that share one
// humanoid skeleton (Ready Player Me style), so one set of retargeted motion-capture clips drives them all
// (src/player/Human.js). Textures are re-encoded as WebP and geometry compressed. The first one is
// the player's default look; the rest walk the sidewalks, give missions and stand in for other players.
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-humans.mjs     (downloads are cached in .cache/humans)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, weld, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { stampModels } from './carimport/stamp.mjs';

export const HUMANS = [
  // the player: a realistic young Indian man (hoodie, jeans, trainers), kept at full texture detail
  { id: 'hero', sex: 'm', uid: '0304e3ede6f346adbe92439042ee7758', title: 'indian man', author: 'madmak21199', license: 'CC-BY-4.0', tex: 1024 },
  { id: 'pmariano', sex: 'm', uid: 'a9c1f5d2cd7c4ca3bb46272998d3e451', title: 'Avatar Full body - Ready Player Me - pmariano', author: 'patomariano' },
  { id: 'alex', sex: 'm', uid: '006dd7a2d3734387ab4ab8d92c868788', title: 'ReadyPlayerMe - Rainbow Family: Alex', author: 'anonim.user.978' },
  { id: 'arnold', sex: 'm', uid: '4cd6354f28f24ca9ab84bf182279286a', title: 'ReadyPlayerMe - Rainbow Family: Arnold', author: 'anonim.user.978' },
  { id: 'jake', sex: 'm', uid: '73c342982ea74c63b5a9bb1fc3cfb2e7', title: 'ReadyPlayerMe - Sports Couple: Jake', author: 'anonim.user.978' },
  { id: 'kenzie', sex: 'm', uid: '3c026db1453644eba3f60afc885998e7', title: 'Kenzie ready player me avatar', author: 'Kenz.makes.3D' },
  { id: 'emilius', sex: 'm', uid: '68839614ac7947a2998148892e2a0c4c', title: 'Avatar Fullbody - Ready Player Me', author: 'emiliusvgs' },
  { id: 'songbird', sex: 'f', uid: 'd739dfe5ac6d46d69886f660cdf6649c', title: 'ReadyPlayerMe - Lifestyle Series: Songbird', author: 'anonim.user.978' },
  { id: 'lucy', sex: 'f', uid: '152e5e3aed3b408085b14b7aa580d87f', title: 'ReadyPlayerMe - Sports Couple: Lucy', author: 'anonim.user.978' },
];

// Kerala: people in what Kerala wears — white mundu / dhoti and shirt, kurtas, sarees, and the jeans-and-top or
// cricket-jersey look of younger people in town. Simplified for crowds. `node tools/import-humans.mjs --kerala`
// imports only these (manifest.humansKL); the game uses them for Kerala's pedestrians. (Two Mixamo-rigged
// candidates, 'Indian Man with Red Clothes' and 'Sareelady', were left out: their rigs don't take the clips.)
export const HUMANS_KL = [
  { id: 'kl_elder', sex: 'm', uid: 'e70a140ad4334c2e8648ac78d61545b3', title: 'Indian Old man walking', author: 'anandmohan662', license: 'CC-BY-4.0' },
  { id: 'kl_kurta_brown', sex: 'm', uid: 'a7fcb7ce36984b1b860ac7e476033bb1', title: 'Indian Man In Kurta', author: 'ar.jethin', license: 'Sketchfab Free Standard' },
  { id: 'kl_kurta_dhoti', sex: 'm', uid: 'd691bd90c3e046aa970215a5c6a00a6d', title: 'Indian Man In Kurta (2)', author: 'ar.jethin', license: 'Sketchfab Free Standard' },
  { id: 'kl_jersey', sex: 'm', uid: '0baf0a4bbe314764a8d7b639e8f600ca', title: 'indian male character', author: 'adabhade17', license: 'CC-BY-4.0' },
  { id: 'kl_saree', sex: 'f', uid: 'b5965a93b03440dea65160f7cbac1fc7', title: 'Indian Woman in Saree', author: 'ar.jethin', license: 'Sketchfab Free Standard' },
  { id: 'kl_saree_pink', sex: 'f', uid: 'c8ae4057c6904a248ad0b185170cbe45', title: 'Indian  women', author: 'Sorojithaldar98', license: 'CC-BY-4.0' },
  { id: 'kl_modern', sex: 'f', uid: '830d8ed3236a4221862290b81807f408', title: 'Modern Indian Woman', author: 'ar.jethin', license: 'CC-BY-4.0' },
  { id: 'kl_office', sex: 'f', uid: 'e6c60cafd33c4d54b0b840c4146ed244', title: 'Indian Office Woman', author: 'ar.jethin', license: 'CC-BY-4.0' },
  { id: 'kl_saree_yellow', sex: 'f', uid: 'c28105203127478b8e26ad0474083367', title: 'Sareewoman', author: 'dk8026854', license: 'CC-BY-4.0' },
  { id: 'kl_saree_rose', sex: 'f', uid: 'c686c80a3fc84465b1dad642d3b21fa3', title: 'Sareewoman', author: 'dk8026854', license: 'CC-BY-4.0' },
];
const KERALA = process.argv.includes('--kerala');

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

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(outDir, { recursive: true });
const done = [];
const LIST = KERALA ? HUMANS_KL : HUMANS;
for (const h of LIST) {
  try {
    const doc = await io.read(await source(h));
    if (!doc.getRoot().listSkins().length) throw new Error('not rigged');
    // single-mesh texture-atlas avatars (material "Wolf3D_Avatar") don't survive the conversion: skip them
    if (doc.getRoot().listMaterials().some((m) => m.getName() === 'Wolf3D_Avatar')) throw new Error('atlas avatar, not supported');
    for (const a of doc.getRoot().listAnimations()) a.dispose();
    for (const mat of doc.getRoot().listMaterials()) mat.setExtension('KHR_materials_specular', null);
    doc.createExtension(EXTTextureWebP).setRequired(true);
    // crowds: bring heavy models down to ~20k triangles
    let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    if (KERALA && tris > 22000) { await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 20000 / tris, error: 0.004 })); console.log(`   ${h.id}: ${Math.round(tris)} tris -> ~20k`); }
    await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [h.tex || 512, h.tex || 512], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const glb = await io.writeBinary(doc);
    fs.writeFileSync(path.join(outDir, `${h.id}.glb`), glb);
    console.log(`${h.id.padEnd(10)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
    done.push(h);
  } catch (e) { console.log(`${h.id}: FAILED ${e.message}`); }
}
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = (h) => ({ id: h.id, sex: h.sex, file: `humans/${h.id}.glb`, source: { site: 'Sketchfab', uid: h.uid, title: h.title, author: h.author, url: `https://sketchfab.com/3d-models/${h.uid}`, license: h.license || 'CC-BY-4.0' } });
manifest[KERALA ? 'humansKL' : 'humans'] = done.map(entry);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const lines = ['# People credits', '', 'Character models from Sketchfab, used under their licenses (Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/, or the Sketchfab Free Standard license). They were converted for real-time use (animations removed, textures re-encoded, geometry compressed and, for the Kerala crowd, simplified); the game animates them with motion-captured clips (public/assets/anims).', ''];
for (const h of [...(manifest.humans || []), ...(manifest.humansKL || [])].map((e) => ({ ...e.source }))) lines.push(`- "${h.title}" by ${h.author}, ${h.url} (${h.license === 'CC-BY-4.0' ? 'CC BY 4.0' : h.license}), modified.`);
fs.writeFileSync(path.join(outDir, 'CREDITS.md'), lines.join('\n') + '\n');
stampModels(ROOT); // cache-busting fingerprints for the game
console.log(`done: ${done.length}/${LIST.length}`);
