// Builds optimized runtime assets (client/assets/**) from the raw sources fetched by fetch-sources.mjs.
//   BLEND/raw glTF  ->  gltf-transform (dedup/weld/simplify/foliage thinning/webp textures)  ->  GLB
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, simplifyPrimitive, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { fetchSources, TEXTURES } from './fetch-sources.mjs';

const RAW = path.resolve('raw');
const OUT = path.resolve('client/assets');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// id -> output + budget. simplify = target ratio for opaque meshes; foliage = leaf thinning.
const MODELS = {
  bolt_action_rifle_7_62: [{ out: 'weapons/bolt_action_rifle.glb', tex: 1024 }, { out: 'weapons/bolt_action_rifle_tps.glb', tex: 512, simplify: 0.12, error: 0.01 }],
  service_pistol: [{ out: 'weapons/service_pistol.glb', tex: 1024 }, { out: 'weapons/service_pistol_tps.glb', tex: 512, simplify: 0.1, error: 0.01 }],
  stick_grenade: { out: 'weapons/grenade.glb', tex: 512 },
  concrete_road_barrier: { out: 'props/concrete_barrier.glb', tex: 512, simplify: 0.04, error: 0.03 },
  concrete_road_barrier_02: { out: 'props/concrete_barrier_02.glb', tex: 512, simplify: 0.08, error: 0.03 },
  wooden_military_crate: { out: 'props/military_crate.glb', tex: 512, simplify: 0.15, error: 0.02 },
  old_military_crate: { out: 'props/old_military_crate.glb', tex: 512, simplify: 0.3, error: 0.02 },
  ammo_box: { out: 'props/ammo_box.glb', tex: 512, simplify: 0.3, error: 0.02 },
  Barrel_01: { out: 'props/barrel.glb', tex: 512, simplify: 0.4, error: 0.02 },
  barrel_03: { out: 'props/barrel_rusty.glb', tex: 512 },
  covered_car: { out: 'props/covered_car.glb', tex: 1024, simplify: 0.4, error: 0.01 },
  metal_jerrycan_green: { out: 'props/jerrycan.glb', tex: 512, simplify: 0.15, error: 0.02 },
  cement_bag: { out: 'props/cement_bag.glb', tex: 512, simplify: 0.22, error: 0.03 },
  old_tyre: { out: 'props/tyre.glb', tex: 512, simplify: 0.3, error: 0.02 },
  utility_box_01: { out: 'props/utility_box.glb', tex: 512, simplify: 0.4, error: 0.02 },
  street_lamp_01: { out: 'props/street_lamp.glb', tex: 512, simplify: 0.12, error: 0.02 },
  exterior_aircon_unit: { out: 'props/aircon.glb', tex: 512, simplify: 0.15, error: 0.02 },
  metal_trash_can: { out: 'props/trash_can.glb', tex: 512, simplify: 0.2, error: 0.02 },
  portable_generator: { out: 'props/generator.glb', tex: 512, simplify: 0.2, error: 0.02 },
  rollershutter_door: { out: 'props/rollershutter_door.glb', tex: 1024 },
  modular_chainlink_fence: { out: 'props/chainlink_fence.glb', tex: 512, simplify: 0.03, error: 0.05 },
  rusted_wheel_rim_01: { out: 'props/wheel_rim.glb', tex: 512, simplify: 0.15, error: 0.02 },
  tree_small_02: [
    { out: 'vegetation/tree_small_02_lod0.glb', tex: 1024, simplify: 0.06, error: 0.02, foliage: { keep: 0.012, scale: 4.8, leafRatio: 0.5 } },
    { out: 'vegetation/tree_small_02_lod1.glb', tex: 512, simplify: 0.012, error: 0.05, foliage: { keep: 0.0028, scale: 9.5, leafRatio: 0.35 } },
  ],
  grass_medium_01: { out: 'vegetation/grass_medium_01.glb', tex: 512, simplify: 0.2, error: 0.08 },
  shrub_04: { out: 'vegetation/shrub.glb', tex: 512, simplify: 0.08, error: 0.05 },
  fern_02: { out: 'vegetation/fern.glb', tex: 512, simplify: 0.3, error: 0.05 },
  dead_tree_trunk: { out: 'vegetation/dead_tree_trunk.glb', tex: 512, simplify: 0.03, error: 0.03 },
  rock_07: { out: 'vegetation/rock_07.glb', tex: 512, simplify: 0.06, error: 0.05 },
  rock_09: { out: 'vegetation/rock_09.glb', tex: 512, simplify: 0.06, error: 0.05 },
};

const triCount = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives()
  .reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);

// Keep a deterministic subset of leaf "islands" (connected components) and enlarge them about their centroid,
// preserving canopy volume/silhouette at a fraction of the triangle cost.
function thinFoliage(doc, prim, { keep, scale }) {
  const idx = prim.getIndices().getArray();
  const pos = prim.getAttribute('POSITION');
  const n = pos.getCount();
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const keepRoot = new Map();
  const hash = (x) => { x = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const kept = [];
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    let k = keepRoot.get(r);
    if (k === undefined) { k = hash(r) < keep; keepRoot.set(r, k); }
    if (k) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  // centroids
  const P = pos.getArray();
  const cen = new Map();
  for (const v of new Set(kept)) {
    const r = find(v); let c = cen.get(r); if (!c) cen.set(r, (c = [0, 0, 0, 0]));
    c[0] += P[v * 3]; c[1] += P[v * 3 + 1]; c[2] += P[v * 3 + 2]; c[3]++;
  }
  const NP = P.slice();
  for (const v of new Set(kept)) {
    const c = cen.get(find(v));
    for (let k = 0; k < 3; k++) NP[v * 3 + k] = c[k] / c[3] + (P[v * 3 + k] - c[k] / c[3]) * scale;
  }
  pos.setArray(NP);
  prim.getIndices().setArray(new Uint32Array(kept));
}

// Merge Poly Haven's separate opacity maps into the base colour alpha channel (-> alpha-tested cutout materials).
async function applyAlphaMaps(doc, dir) {
  const adir = path.join(dir, 'alpha');
  if (!fs.existsSync(adir)) return;
  const maps = fs.readdirSync(adir);
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getAlphaMode() === 'OPAQUE' && !/wire|leaves|leaf|grass|shrub|fern/i.test(mat.getName())) continue;
    const name = mat.getName().toLowerCase();
    const pick = maps.find((m) => m !== 'alpha.jpg' && name.endsWith(m.replace('_alpha.jpg', ''))) || (maps.includes('alpha.jpg') ? 'alpha.jpg' : null);
    const tex = mat.getBaseColorTexture();
    if (!pick || !tex) continue;
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = await sharp(path.join(adir, pick)).resize(info.width, info.height).greyscale().raw().toBuffer();
    const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
    const png = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType('image/png').setURI(tex.getURI().replace(/\.jpe?g$/i, '.png'));
    mat.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
    console.log(`  alpha: ${mat.getName()} <- ${pick}`);
  }
}

async function buildModel(id, cfg) {
  const dir = path.join(RAW, 'models', id);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, file));
  const before = triCount(doc);
  await MeshoptSimplifier.ready;
  await doc.transform(dedup(), weld());
  await applyAlphaMaps(doc, dir);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? '';
      const isLeaf = /leaves|leaf/i.test(matName);
      if (isLeaf && cfg.foliage) {
        thinFoliage(doc, prim, cfg.foliage);
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: cfg.foliage.leafRatio, error: 0.02 });
      } else if (cfg.simplify && !/glass/i.test(matName)) {
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: cfg.simplify, error: cfg.error ?? 0.01, lockBorder: false });
      }
      // Foliage materials: alpha-test instead of blending (no sorting cost, correct shadows).
      const mat = prim.getMaterial();
      if (mat && mat.getAlphaMode() === 'BLEND' && !/glass/i.test(matName)) mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
    }
  }
  await doc.transform(
    dedup(), prune(), resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 82 }),
  );
  const outPath = path.join(OUT, cfg.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = (fs.statSync(outPath).size / 1024) | 0;
  console.log(`${cfg.out.padEnd(44)} tris ${String(Math.round(before)).padStart(8)} -> ${String(Math.round(triCount(doc))).padStart(6)}  ${kb} KB`);
}

async function buildTextures() {
  for (const id of TEXTURES) {
    const src = path.join(RAW, 'textures', id);
    const dst = path.join(OUT, 'textures', id);
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      await sharp(path.join(src, f)).resize(1024, 1024).webp({ quality: 82 }).toFile(path.join(dst, f.replace('.jpg', '.webp')));
    }
  }
  fs.mkdirSync(path.join(OUT, 'hdri'), { recursive: true });
  fs.copyFileSync(path.join(RAW, 'hdri', 'sky_1k.hdr'), path.join(OUT, 'hdri', 'sky_1k.hdr'));
  console.log('textures + hdri done');
}

function installCharacter() {
  const dst = path.join(OUT, 'characters', 'soldier_default.glb');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(RAW, 'characters', 'Soldier.glb'), dst);
  console.log('characters/soldier_default.glb installed (three.js example Soldier / Mixamo — not committed)');
}

const onlyChar = process.argv.includes('--character-only');
await fetchSources({ characterOnly: onlyChar });
installCharacter();
if (!onlyChar) {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const [id, c] of Object.entries(MODELS)) {
    if (filter.length && !filter.includes(id)) continue;
    for (const cfg of [c].flat()) await buildModel(id, cfg);
  }
  if (!filter.length) await buildTextures();
}
