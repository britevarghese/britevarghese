// Downloads raw source assets (CC0 from Poly Haven + the three.js example Soldier.glb)
// into ./raw (git-ignored). Run `npm run assets` to fetch + build optimized runtime assets.
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('raw');
export const MODELS = [
  // weapons
  'bolt_action_rifle_7_62', 'service_pistol', 'stick_grenade',
  // military / urban props
  'concrete_road_barrier', 'concrete_road_barrier_02', 'wooden_military_crate', 'old_military_crate',
  'ammo_box', 'Barrel_01', 'barrel_03', 'covered_car', 'metal_jerrycan_green', 'cement_bag', 'old_tyre',
  'utility_box_01', 'street_lamp_01', 'exterior_aircon_unit', 'metal_trash_can', 'portable_generator',
  'rollershutter_door', 'modular_chainlink_fence', 'modular_electricity_poles', 'rusted_wheel_rim_01',
  // nature
  'tree_small_02', 'jacaranda_tree', 'grass_medium_01', 'shrub_04', 'rock_07', 'rock_09',
  'dead_tree_trunk', 'fern_02',
];
export const TEXTURES = [
  'sparse_grass', 'dry_ground_01', 'rocky_terrain_02', 'burned_ground_01', 'asphalt_02', 'concrete_pavement',
  'concrete_wall_008', 'worn_plaster_wall', 'rough_plaster_brick', 'concrete_floor_worn_001', 'corrugated_iron_02',
  'rusty_metal_02', 'plywood', 'concrete_slab_wall',
];
export const HDRI = 'kloofendal_48d_partly_cloudy_puresky';
const SOLDIER_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb';

async function get(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
    }
  }
}
const api = async (id) => (await fetch(`https://api.polyhaven.com/files/${id}`)).json();

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

export async function fetchSources({ characterOnly = false } = {}) {
  await get(SOLDIER_URL, path.join(RAW, 'characters', 'Soldier.glb'));
  if (characterOnly) return;
  await pool(MODELS, 4, async (id) => {
    const f = (await api(id)).gltf['1k'].gltf;
    const dir = path.join(RAW, 'models', id);
    await get(f.url, path.join(dir, path.basename(f.url)));
    for (const [rel, inc] of Object.entries(f.include || {})) await get(inc.url, path.join(dir, rel));
    // opacity maps are shipped separately from the glTF (foliage cards, chain-link wire...)
    const files = await api(id);
    for (const [k, v] of Object.entries(files)) {
      const u = /alpha$/i.test(k) && v?.['1k']?.jpg?.url;
      if (u) await get(u, path.join(dir, 'alpha', `${k.toLowerCase()}.jpg`));
    }
    console.log('model', id);
  });
  await pool(TEXTURES, 4, async (id) => {
    const d = await api(id);
    const dir = path.join(RAW, 'textures', id);
    const pick = (k) => d[k]?.['1k']?.jpg?.url;
    for (const [k, name] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['arm', 'arm']]) {
      const u = pick(k);
      if (u) await get(u, path.join(dir, `${name}.jpg`));
    }
    console.log('texture', id);
  });
  const h = await api(HDRI);
  await get(h.hdri['1k'].hdr.url, path.join(RAW, 'hdri', 'sky_1k.hdr'));
  console.log('sources ready');
}

if (import.meta.url === `file://${process.argv[1]}`) fetchSources().catch((e) => { console.error(e); process.exit(1); });
