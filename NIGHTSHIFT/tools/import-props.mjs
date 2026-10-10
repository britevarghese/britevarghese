// Imports the licensed static models listed below (boats for now) from Sketchfab: scaled to their real length,
// turned so they run along +Z, set on their waterline (y = 0 is the water surface), simplified to a triangle
// budget, textures to WebP, geometry meshopt-compressed. Writes public/assets/models/props/<id>.glb, registers
// them in public/assets/models/manifest.json (props) and credits them in public/assets/models/props/CREDITS.md.
//
//   SKETCHFAB_API_TOKEN=xxxx node tools/import-props.mjs [--only id,id] [--force]
//
// Downloads are cached in .cache/props.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, metalRough, weld, simplify, flatten, join, normals } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';

// len: real length in metres; draft: how deep the hull sits; tris: triangle budget (error: how far the simplifier
// may move the surface, as a share of the model's size); flip: the model faces -Z
export const PROPS = [
  { id: 'boat_canopy', name: 'Country boat with a canopy', len: 9, draft: 0.25, tris: 9000, uid: '45ab977c53aa44c3b9c81052dcf19b57', title: 'Traditional Bangladeshi Boat', author: 'xamir' },
  { id: 'boat_vallam', name: 'Vallam (wooden boat)', len: 6.5, draft: 0.18, tris: 4000, uid: '7357ab059f744223985423eb9cb01eb7', title: 'Vallam (Wooden Boat)', author: 'Shadowtiger' },
  // trees: height instead of len (scaled to that height, standing on y = 0, trunk at the origin, not turned)
  { id: 'tree_coconut', name: 'Coconut palm', height: 11, tris: 8000, uid: '26e787f2ff2e4c0fb004c3b0210805a3', title: 'Coconut Palm', author: 'evolveduk' },
  { id: 'tree_banana', name: 'Banana plant', height: 3.1, tris: 4500, uid: '85695b82c7ba4b3497a663616cc3bf25', title: 'Banana Plant', author: 'evolveduk' },
  { id: 'tree_broad', name: 'Broadleaf tree', height: 8.5, tris: 5000, uid: '2cd58e603ae542c78dd9cada46496921', title: 'Realistic Tree 2 Free', author: 'NextSpring' },
  { id: 'boat_ferry', name: 'Passenger ferry', len: 24, draft: 0.9, tris: 16000, error: 0.06, sloppy: true, uid: '73b9556133704e73af6637a428bcb8f4', title: 'Ferry Concept', author: 'gmanisdabossatbeastmode' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i < 0 ? null : args[i + 1]; };
const only = opt('only') ? opt('only').split(',') : null;
const force = args.includes('--force');
const token = process.env.SKETCHFAB_API_TOKEN;
const outDir = path.join(ROOT, 'public/assets/models/props');
const cacheRoot = path.join(ROOT, '.cache/props');
const manifestPath = path.join(ROOT, 'public/assets/models/manifest.json');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

function findModel(dir) {
  if (!fs.existsSync(dir)) return null;
  const all = fs.readdirSync(dir, { recursive: true }).map(String);
  const f = all.find((n) => n.endsWith('.glb')) || all.find((n) => n.endsWith('.gltf'));
  return f ? path.join(dir, f) : null;
}
async function download(p) {
  const dir = path.join(cacheRoot, p.id);
  fs.mkdirSync(dir, { recursive: true });
  const have = findModel(dir);
  if (have) return have;
  if (!token) throw new Error('no SKETCHFAB_API_TOKEN');
  const res = await fetch(`https://api.sketchfab.com/v3/models/${p.uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Sketchfab download API ${res.status}`);
  const links = await res.json(), link = links.glb || links.gltf;
  if (!link) throw new Error('no glTF download offered');
  console.log(`   downloading ${(link.size / 1048576).toFixed(1)} MB...`);
  const buf = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
  if (links.glb) fs.writeFileSync(path.join(dir, 'model.glb'), buf);
  else for (const [name, data] of Object.entries(unzipSync(buf))) { const q = path.join(dir, name); fs.mkdirSync(path.dirname(q), { recursive: true }); if (!name.endsWith('/')) fs.writeFileSync(q, data); }
  return findModel(dir);
}
const tris = (doc) => { let n = 0; for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) { const ix = pr.getIndices(); n += (ix ? ix.getCount() : pr.getAttribute('POSITION').getCount()) / 3; } return Math.round(n); };

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.props ||= {};
fs.mkdirSync(outDir, { recursive: true });
for (const p of PROPS) {
  if (only && !only.includes(p.id)) continue;
  const out = path.join(outDir, `${p.id}.glb`);
  if (!force && fs.existsSync(out) && manifest.props[p.id]) { console.log(`= ${p.id} already imported`); continue; }
  console.log(`> ${p.id}  [${p.title} by ${p.author}]`);
  const doc = await io.read(await download(p));
  // (outline edges and points are no use in a game: triangles only)
  for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) if (pr.getMode() !== 4) { m.removePrimitive(pr); pr.dispose(); }
  await doc.transform(metalRough(), flatten());
  // and no baked ground / shadow / water planes: a part as flat as paper that spans most of the model goes
  {
    const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0], B = getBounds(sc), span = Math.max(B.max[0] - B.min[0], B.max[2] - B.min[2]);
    for (const node of doc.getRoot().listNodes()) {
      const m = node.getMesh(); if (!m) continue;
      const W = node.getWorldMatrix();
      for (const pr of m.listPrimitives()) {
        const A = pr.getAttribute('POSITION'), lo = A.getMin([]), hi = A.getMax([]), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
          for (let r = 0; r < 3; r++) { const w = W[r] * v[0] + W[4 + r] * v[1] + W[8 + r] * v[2] + W[12 + r]; mn[r] = Math.min(mn[r], w); mx[r] = Math.max(mx[r], w); }
        }
        const h = mx[1] - mn[1], w = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
        if (w > span * 0.6 && (h < w * 0.01 || (h < w * 0.05 && A.getCount() < 400))) {   // (or a low-poly, slightly wavy water sheet)
           console.log('   (dropped a flat ground plane)'); m.removePrimitive(pr); pr.dispose(); }
      }
    }
  }
  await doc.transform(prune(), weld(), join({ keepNamed: false }));
  const t0 = tris(doc);
  if (t0 > p.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: p.tris / t0, error: p.error ?? 0.01, lockBorder: false }));
  // sloppy: still over budget (many small loose parts the edge-collapse can't merge): cluster the vertices instead
  if (p.sloppy && tris(doc) > p.tris * 1.3) {
    const ratio = p.tris / tris(doc);
    for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) {
      const ix = pr.getIndices(), pos = pr.getAttribute('POSITION');
      if (!ix || ix.getCount() < 300) continue;
      const idx = new Uint32Array(ix.getArray()), P = new Float32Array(pos.getArray());
      const target = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
      if (P.length % 3 || idx.length % 3) { console.log("   (skip a primitive: odd sizes", P.length, idx.length, ")"); continue; }
      const [res] = MeshoptSimplifier.simplifySloppy(idx, P, 3, null, Math.min(target, idx.length), 0.03);
      pr.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(res)).setBuffer(ix.getBuffer()));
    }
    await doc.transform(prune(), weld(), normals({ overwrite: true }));   // (clustered vertices: their old normals are wrong)
  }
  // one wrapper node: turn the long side along +Z, scale to the real length, sit the hull on the waterline
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene), sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2];
  const alongX = !p.height && sx > sz, L = Math.max(sx, sz), k = p.height ? p.height / (b.max[1] - b.min[1]) : p.len / L;
  const wrap = doc.createNode('prop');
  for (const n of scene.listChildren()) { scene.removeChild(n); wrap.addChild(n); }
  scene.addChild(wrap);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  // rotation about Y by 90 degrees when the model lies along X (then flip if it faces backwards)
  const yaw = (alongX ? Math.PI / 2 : 0) + (p.flip ? Math.PI : 0);
  wrap.setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  wrap.setScale([k, k, k]);
  // translate after rotation and scale: centre to the origin, bottom at -draft
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rx = cx * c + cz * s, rz = -cx * s + cz * c;
  wrap.setTranslation([-rx * k, -b.min[1] * k - (p.draft || 0), -rz * k]);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(out, glb);
  const t1 = tris(doc);
  console.log(`   ${t0} -> ${t1} tris, ${(glb.byteLength / 1048576).toFixed(2)} MB, ${p.height ? 'height ' + p.height : 'length ' + p.len} m (${alongX ? 'turned' : 'as is'})`);
  manifest.props[p.id] = { file: `props/${p.id}.glb`, name: p.name, ...(p.height ? { height: p.height } : { length: p.len, draft: p.draft }), tris: t1, source: { site: 'Sketchfab', uid: p.uid, title: p.title, author: p.author, url: `https://sketchfab.com/3d-models/${p.uid}`, license: 'CC-BY-4.0' } };
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const credits = ['# Prop model credits', '', ...Object.values(manifest.props).map((m) => `- **${m.name}**: "${m.source.title}" by ${m.source.author}, ${m.source.url} (CC BY 4.0), modified.`), ''];
fs.writeFileSync(path.join(outDir, 'CREDITS.md'), credits.join('\n'));
console.log('done');
