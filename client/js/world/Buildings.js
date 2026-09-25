// Assembles modular buildings from shared/map.js descriptions: structural walls/slabs (PBR, world-scale UVs,
// separate exterior/interior finishes, weathering vertex tint), window frames + sills + glass, door frames,
// floor bands, plinths, parapet coping, drain pipes, stairs, roof equipment, breaches with rebar & rubble.
import * as THREE from 'three';
import { buildBoxGeometry } from '../render/Materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '/shared/util.js';

export function buildBuildings(world, mats, props) {
  const group = new THREE.Group(); group.name = 'buildings';
  const all = new Map(); // material -> geometries[]
  const push = (mat, g) => { if (!all.has(mat)) all.set(mat, []); all.get(mat).push(g); };
  const glassGeoms = [];
  const glassIds = []; // pane id (shared with CollisionWorld.glass) per glass geometry, in merge order
  const rebarGeoms = [];
  const roofProps = [];
  const rubble = [];

  for (const b of world.buildings) {
    const spec = b.spec, rnd = mulberry32(spec.id.length * 977 + spec.x * 13 + spec.z * 7);
    const cx = spec.x, cz = spec.z;
    const tint = 1.0 + rnd() * 0.18;
    const dirtTone = [0.93 + rnd() * 0.07, 0.9 + rnd() * 0.07, 0.86 + rnd() * 0.06];
    const y0 = b.y0;
    // weathering: grime near the ground, streaks below windows (via noise), lighter upper walls
    const color = (p, part, n) => {
      const h = p[1] - y0;
      const g = 0.8 + 0.2 * Math.min(1, Math.max(0, (h - 0.1) / 1.6));
      const streak = 0.9 + 0.1 * Math.sin(p[0] * 3.1 + p[2] * 2.3);
      const k = tint * g * (n[1] > 0.5 ? 0.92 : streak);
      return [k * dirtTone[0], k * dirtTone[1], k * dirtTone[2]];
    };
    const faceMat = (part, n, fc) => {
      if (part.part === 'ground' || part.part === 'floor') return n[1] > 0.5 ? 'concrete_floor' : n[1] < -0.5 ? 'plaster_int' : 'trim';
      if (part.part === 'parapet' && n[1] === 0 && ((fc[0] - cx) * n[0] + (fc[2] - cz) * n[2]) < 0) return 'concrete';
      if (part.part === 'roof') return n[1] > 0.5 ? part.mat : n[1] < -0.5 ? 'plaster_int' : 'trim';
      if (part.part === 'rail') return 'frame';
      if (part.part === 'interior') return 'plaster_int';
      // outer walls: exterior finish on the outside face, plaster inside
      const out = (fc[0] - cx) * n[0] + (fc[2] - cz) * n[2];
      const inside = Math.abs(fc[0] - cx) < spec.w / 2 - b.T * 0.9 && Math.abs(fc[2] - cz) < spec.d / 2 - b.T * 0.9;
      if (n[1] !== 0) return part.mat;
      if (out < 0 || inside) return spec.style === 'warehouse' ? 'metal_siding' : 'plaster_int';
      return part.mat;
    };
    const geos = buildBoxGeometry(b.parts, { tile: spec.style === 'warehouse' ? 3 : 2.4, faceMat, color });
    for (const [m, g] of geos) push(m, g);

    // ---- trims & details (visual only)
    const trims = [];
    const T = b.T, x0 = cx - spec.w / 2, x1 = cx + spec.w / 2, z0 = cz - spec.d / 2, z1 = cz + spec.d / 2;
    const band = (y, h, out, mat) => {
      trims.push({ min: [x0 - out, y, z0 - out], max: [x1 + out, y + h, z0 + 0.02], mat });
      trims.push({ min: [x0 - out, y, z1 - 0.02], max: [x1 + out, y + h, z1 + out], mat });
      trims.push({ min: [x0 - out, y, z0], max: [x0 + 0.02, y + h, z1], mat });
      trims.push({ min: [x1 - 0.02, y, z0], max: [x1 + out, y + h, z1], mat });
    };
    if (spec.style !== 'warehouse') {
      band(y0 - 0.3, 0.75, 0.04, 'plinth');
      for (let f = 1; f < spec.floors; f++) band(y0 + f * b.FH - 0.28, 0.3, 0.035, 'trim');
      if (!spec.damage || spec.damage < 0.6) band(y0 + spec.floors * b.FH + 0.9, 0.08, 0.06, 'trim');
    } else {
      band(y0 - 0.3, 0.9, 0.03, 'plinth');
      band(y0 + b.FH - 0.05, 0.25, 0.08, 'frame');
    }
    // openings: frames, sills, glass, lintels
    for (const [oi, o] of b.openings.entries()) {
      const sd = o.sd, alongX = sd.dir[0] !== 0;
      const ft = 0.06, depth = T + 0.04;
      const outN = sd.out;
      const at = (u, v0, v1, w) => {
        // a frame member spanning u..u+w along the wall, v0..v1 vertical (opening heights are relative to the
        // building's base, which sits on the terrain: y0 must be added — it is metres off zero on hilly maps)
        if (alongX) return { min: [sd.ax + u, y0 + v0, sd.az - 0.02], max: [sd.ax + u + w, y0 + v1, sd.az + depth - 0.02] };
        return { min: [sd.ax - 0.02, y0 + v0, sd.az + u], max: [sd.ax + depth - 0.02, y0 + v1, sd.az + u + w] };
      };
      if (o.kind === 'breach') {
        // exposed rebar sticking out of the broken wall stub
        for (let r = 0; r < 5; r++) {
          const u = o.u0 + 0.2 + rnd() * (o.u1 - o.u0 - 0.4), len = 0.3 + rnd() * 0.7;
          const cyl = new THREE.CylinderGeometry(0.008, 0.008, len, 5);
          cyl.rotateZ((rnd() - 0.5) * 0.6); cyl.rotateX((rnd() - 0.5) * 0.6);
          const wx = alongX ? sd.ax + u : sd.ax + T / 2, wz = alongX ? sd.az + T / 2 : sd.az + u;
          cyl.translate(wx, y0 + o.v0 + len / 2, wz);
          rebarGeoms.push(cyl);
        }
        const mid = (o.u0 + o.u1) / 2;
        rubble.push({ x: alongX ? sd.ax + mid : sd.ax + outN[0] * 1.2, z: alongX ? sd.az + outN[1] * 1.2 : sd.az + mid, y: y0, n: 5 });
        continue;
      }
      const w = o.u1 - o.u0;
      if (o.kind === 'door' || o.kind === 'bigdoor') {
        trims.push({ ...at(o.u0 - ft, o.v0, o.v1 + ft, ft), mat: 'frame' });
        trims.push({ ...at(o.u1, o.v0, o.v1 + ft, ft), mat: 'frame' });
        trims.push({ ...at(o.u0 - ft, o.v1, o.v1 + ft, w + 2 * ft), mat: 'frame' });
        if (o.kind === 'bigdoor') roofProps.push({ type: 'rollershutter', x: alongX ? sd.ax + o.u0 : sd.ax + outN[0] * 0.05, z: alongX ? sd.az + outN[1] * 0.05 : sd.az + o.u0, y: y0 + o.v1 - 0.1, rot: alongX ? 0 : Math.PI / 2, w });
        continue;
      }
      // window: frame, sill (projecting), mullion, glass
      trims.push({ ...at(o.u0, o.v0, o.v1, ft), mat: 'frame' });
      trims.push({ ...at(o.u1 - ft, o.v0, o.v1, ft), mat: 'frame' });
      trims.push({ ...at(o.u0, o.v1 - ft, o.v1, w), mat: 'frame' });
      trims.push({ ...at(o.u0, o.v0, o.v0 + ft, w), mat: 'frame' });
      if (o.kind === 'window') trims.push({ ...at(o.u0 + w / 2 - 0.02, o.v0, o.v1, 0.04), mat: 'frame' });
      // sill projecting outward
      const sill = at(o.u0 - 0.06, o.v0 - 0.06, o.v0, w + 0.12);
      if (alongX) { if (outN[1] < 0) sill.min[2] -= 0.08; else sill.max[2] += 0.08; } else { if (outN[0] < 0) sill.min[0] -= 0.08; else sill.max[0] += 0.08; }
      trims.push({ ...sill, mat: 'trim' });
      if (o.glass) {
        const g = new THREE.PlaneGeometry(w - 2 * ft, o.v1 - o.v0 - 2 * ft);
        if (!alongX) g.rotateY(Math.PI / 2);
        g.translate(alongX ? sd.ax + (o.u0 + o.u1) / 2 : sd.ax + T / 2, y0 + (o.v0 + o.v1) / 2, alongX ? sd.az + T / 2 : sd.az + (o.u0 + o.u1) / 2);
        glassGeoms.push(g);
        glassIds.push(`${b.id}:${oi}`);
      }
    }
    // drain pipes at two corners
    if (spec.style !== 'bunker') {
      const top = y0 + spec.floors * b.FH + (spec.style === 'warehouse' ? 0 : 0.8);
      for (const [px, pz] of [[x0 - 0.08, z0 - 0.08], [x1 + 0.08, z1 + 0.08]]) {
        const c = new THREE.CylinderGeometry(0.05, 0.05, top - y0, 8); c.translate(px, (top + y0) / 2, pz); rebarGeoms.push(c);
      }
    }
    // stairs: real steps along each ramp
    for (const r of b.ramps) {
      const n = Math.round((r.y1 - r.y0) / 0.18);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        trims.push({ min: [r.x0, r.y0 - 0.15 + (r.y1 - r.y0) * t0, r.z0 + (r.z1 - r.z0) * t0], max: [r.x1, r.y0 + (r.y1 - r.y0) * t1, r.z0 + (r.z1 - r.z0) * t1], mat: 'concrete_floor' });
      }
    }
    // roof equipment
    if (!spec.damage || spec.damage < 0.6) {
      const ry = y0 + spec.floors * b.FH;
      if (spec.style !== 'bunker') roofProps.push({ type: 'aircon', x: cx + (rnd() - 0.5) * (spec.w - 3), z: cz + (rnd() - 0.5) * (spec.d - 3), y: ry, rot: Math.floor(rnd() * 4) * Math.PI / 2 });
    }
    if (spec.damage > 0.2) rubble.push({ x: cx + (rnd() - 0.5) * spec.w * 0.5, z: cz + (rnd() - 0.5) * spec.d * 0.5, y: y0 + 0.12, n: 4 });
    const tg = buildBoxGeometry(trims, { tile: 2.4, color });
    for (const [m, g] of tg) push(m, g);
  }

  for (const [m, list] of all) {
    const merged = mergeGeometries(list, false);
    const mesh = new THREE.Mesh(merged, mats.building(m));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `bld_${m}`;
    group.add(mesh);
  }
  let glass = null;
  if (glassGeoms.length) {
    const gm = new THREE.Mesh(mergeGeometries(glassGeoms), mats.glass()); gm.renderOrder = 1; gm.name = 'windows'; group.add(gm);
    // each pane is 4 vertices in merge order: breaking one collapses them (no draw-call cost, no rebuild)
    const index = new Map(glassIds.map((id, i) => [id, i * 4]));
    glass = { mesh: gm, index, original: gm.geometry.attributes.position.array.slice() };
  }
  if (rebarGeoms.length) {
    const rm = new THREE.Mesh(mergeGeometries(rebarGeoms.map((g) => g.toNonIndexed ? g.index ? g.toNonIndexed() : g : g)), mats.pbr('rusty_metal', { color: 0x8a7a6a }));
    rm.castShadow = true; rm.name = 'rebar_pipes'; group.add(rm);
  }
  return { group, roofProps, rubble, glass };
}
