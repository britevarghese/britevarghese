// Converts an arbitrary car model (e.g. a Sketchfab glTF export) into NIGHTSHIFT's vehicle layout:
//   <id> ─ lod0 ─ body_* (merged per material)          world units: metres, +Z forward, +X left,
//        │      ├ wheel_FL|FR|RL|RR ─ spin/*, fixed/*    y = 0 on the ground under the tyres
//        │      └ markers (light_head_L, light_tail_R, exhaust_L, eye_cockpit, ...)
//        └ lod1 ─ same, heavily simplified, no interior
// Steps: bake transforms -> drop floors/cameras/animation -> orient/scale to the real length -> find
// the four wheels (tyres = round ground-touching components, then everything inside each tyre) ->
// classify materials (paint/glass/lights/calipers) -> merge per material -> simplify LODs -> markers.
import { Primitive } from '@gltf-transform/core';
import { transformPrimitive, weldPrimitive, simplifyPrimitive, joinPrimitives } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { components, subsetPrimitive, triCount, triIndices, positions, triSetBounds } from './geom.mjs';

const RX = {
  plane: /(^|[^a-z])(plane|ground|floor|shadow|backdrop|studio|turntable|platform|podium|environment|sky)([^a-z]|$)/i,
  // game-rip helpers (GTA .dff collision / shadow meshes), never visible geometry
  junk: /col.?mesh|shadow.?mesh|collision|\bcol_/i,
  front: /head.?(light|lamp)|headl|front|grill|grille|hood|bonnet|wind.?shield|wind.?screen|steering|dashboard|radiator|splitter|kuehler|capot/i,
  rear: /tail.?(light|lamp)|taill|rear|brake.?light|exhaust|muffler|trunk|boot|diffuser|spoiler|tailpipe|auspuff|heck/i,
  glass: /glass|window|wind.?screen|wind.?shield|vidrio|scheibe|verre|vetro|windows/i,
  head: /head.?(light|lamp)|headl|front.?light|scheinwerfer|faro|phare|\bhl[_ ]/i,
  tail: /tail.?(light|lamp)|taill|rear.?light|brake.?light|stop.?(light|lamp)|rueckleucht|\btl[_ ]/i,
  paint: /paint|car.?paint|carpaint|body|exterior|lack|carroceria|colou?r|shell|metal.?flake/i,
  notPaint: /glass|window|rubber|tire|tyre|chrome|interior|seat|leather|plastic|black|mirror|light|lamp|lens|carbon|grill|rim|wheel|brake|disc|caliper|engine|exhaust|plate|logo|badge|emblem|decal|dash/i,
  interior: /interior|seat|dash|steering|pedal|gauge|console|belt|cockpit|cabin|door.?panel|engine|motor|gear.?(stick|lever|knob)|roll.?cage|speaker|carpet|headliner/i,
  caliper: /caliper|brake.?pad|bremssattel|pinza|etrier/i,
  steer: /steer/i,
  exhaust: /exhaust|muffler|tailpipe|auspuff|pipe/i,
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const rotX = (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
const scaleM = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const transM = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

function boundsOf(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const pos = positions(p.prim);
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  }
  return { min, max, size: min.map((v, k) => max[k] - v), c: min.map((v, k) => (v + max[k]) / 2) };
}

function reverseWinding(doc, prim) {
  const idx = triIndices(prim);
  for (let t = 0; t < idx.length; t += 3) { const b = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = b; }
  const Ctor = prim.getAttribute('POSITION').getCount() > 65535 ? Uint32Array : Uint16Array;
  prim.getIndices().setArray(Ctor.from(idx));
}

const labelOf = (p) => `${p.name} ${p.prim.getMaterial()?.getName() || ''}`;

export function processCar(doc, car, opt = {}) {
  const log = [];
  const say = (m) => { log.push(m); if (opt.verbose) console.log('   ' + m); };
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const spec = car.spec;

  // ---- 1. bake every triangle primitive into world space (fresh accessors, no sharing)
  for (const a of root.listAnimations()) a.dispose();
  const parts = [];
  const walk = (node, path) => {
    const name = [...path, node.getName() || ''].filter(Boolean).join('/');
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      const flip = det3(world) < 0;
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== Primitive.Mode.TRIANGLES || triCount(prim) === 0) continue;
        const np = subsetPrimitive(doc, prim, [...Array(triCount(prim)).keys()]);
        for (const sem of np.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) np.setAttribute(sem, null);
        transformPrimitive(np, world);
        if (flip) reverseWinding(doc, np);
        parts.push({ prim: np, name: `${name}/${mesh.getName() || ''}` });
      }
    }
    for (const c of node.listChildren()) walk(c, [...path, node.getName() || '']);
  };
  for (const n of scene.listChildren()) walk(n, []);
  // detach the original hierarchy; unused properties are pruned when writing
  for (const n of [...scene.listChildren()]) scene.removeChild(n);
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  for (const sk of root.listSkins()) sk.dispose();
  say(`baked ${parts.length} primitives, ${parts.reduce((a, p) => a + triCount(p.prim), 0)} triangles`);

  // ---- 2. drop floors / shadow catchers / studio props
  // a name like "Plane.001" is also what Blender calls a body started from a plane primitive: only drop
  // name-matched parts that are actually flat
  const flatPart = (p) => { const pb = triSetBounds(positions(p.prim), [...Array(triCount(p.prim)).keys()], triIndices(p.prim)); return pb.size[1] < Math.max(pb.size[0], pb.size[2]) * 0.1; };
  let keep = parts.filter((p) => !RX.junk.test(p.name) && !(RX.plane.test(p.name) && flatPart(p)));
  let b = boundsOf(keep);
  const horiz = Math.max(b.size[0], b.size[2]);
  keep = keep.filter((p) => {
    const pb = triSetBounds(positions(p.prim), [...Array(triCount(p.prim)).keys()], triIndices(p.prim));
    const fx = pb.size[0], fz = pb.size[2], fmax = Math.max(fx, fz);
    // a floor/backdrop spans the whole model, is flat, and (unlike a car) has a squarish footprint
    const spans = fx > b.size[0] * 0.9 && fz > b.size[2] * 0.9;
    const flat = pb.size[1] < fmax * 0.35;
    const squarish = Math.min(fx, fz) / fmax > 0.7;
    const thinSheet = fmax > horiz * 0.98 && pb.size[1] < horiz * 0.01;
    const floor = (spans && flat && squarish) || thinSheet;
    if (floor) say(`removed floor/backdrop "${p.name}" (${fx.toFixed(3)} x ${pb.size[1].toFixed(3)} x ${fz.toFixed(3)})`);
    return !floor;
  });
  if (keep.length < parts.length) say(`removed ${parts.length - keep.length} floor/studio parts`);
  let P = keep;

  // ---- 3. orientation, scale, position
  let M = IDENTITY;
  b = boundsOf(P);
  if (car.import?.up === 'z') { M = mul(rotX(-Math.PI / 2), M); say('up axis: Z (config)'); }
  const applyAll = (m) => { for (const p of P) transformPrimitive(p.prim, m); };
  if (M !== IDENTITY) { applyAll(M); b = boundsOf(P); }
  if (b.size[1] > Math.max(b.size[0], b.size[2])) say('WARNING: height is the largest extent; set import.up if the car is on its nose/side');
  if (b.size[0] > b.size[2]) { applyAll(rotY(-Math.PI / 2)); say('length ran along X: rotated 90 deg'); b = boundsOf(P); }
  const s = spec.len / b.size[2];
  applyAll(mul(scaleM(s), transM(-b.c[0], -b.min[1], -b.c[2])));
  say(`scale x${s.toFixed(4)} (model length ${b.size[2].toFixed(3)} -> ${spec.len} m)`);
  // front/back: named parts (lights, grille, hood... vs tail lights, exhaust, spoiler...)
  const zOf = (re) => { let a = 0, z = 0; for (const p of P) { if (!re.test(labelOf(p))) continue; const t = [...Array(triCount(p.prim)).keys()]; const pb = triSetBounds(positions(p.prim), t, triIndices(p.prim)); a += pb.area; z += pb.c[2] * pb.area; } return a > 0 ? z / a : null; };
  const zf = zOf(RX.front), zr = zOf(RX.rear);
  let flipFB = false;
  if (car.import?.flip !== undefined) { flipFB = !!car.import.flip; say(`front/back from config (flip=${flipFB})`); }
  else if (zf !== null && zr !== null) flipFB = zf < zr;
  else if (zf !== null) flipFB = zf < 0;
  else if (zr !== null) flipFB = zr > 0;
  else say('WARNING: no front/rear named parts; assuming the model faces +Z (set import.flip to override)');
  if (flipFB) { applyAll(rotY(Math.PI)); say('model faced -Z: rotated 180 deg'); }
  say(`front marker z ${zf?.toFixed(2)} rear marker z ${zr?.toFixed(2)}`);
  b = boundsOf(P);

  // ---- 4. wheels
  const bike = !!car.bike;
  const quad = (x, z) => (z > 0 ? 'F' : 'R') + (bike ? '' : x > 0 ? 'L' : 'R');
  let comps = [];
  const collect = () => {
    comps = [];
    for (const p of P) {
      const pb = boundsOf([p]);
      if (pb.min[1] > 1.0) continue;
      for (const c of components(p.prim)) comps.push({ ...c, part: p });
    }
  };
  collect();
  // car tyres sit out at the corners; bike tyres are narrow and on the centre line
  const tireOk = (c, loose) => {
    const [dx, dy, dz] = c.size, d = Math.max(dy, dz);
    if (bike) {
      const round = loose ? 0.2 : 0.12;
      return d > (loose ? 0.4 : 0.45) && d < (loose ? 0.95 : 0.85) && Math.abs(dy - dz) < round * d && dx > 0.04 && dx < 0.36 && c.min[1] < (loose ? 0.2 : 0.12) && Math.abs(c.c[0]) < 0.2;
    }
    const lo = loose ? 0.35 : 0.45, hi = loose ? 1.15 : 1.0, round = loose ? 0.2 : 0.12;
    return d > lo && d < hi && Math.abs(dy - dz) < round * d && dx > 0.08 && dx < 0.6 && c.min[1] < (loose ? 0.2 : 0.12) && Math.abs(c.c[0]) > 0.35;
  };
  // the tyre is the largest round part at each wheel (bikes: by diameter, the rim can be wider than a skinny front tyre)
  const score = (c) => Math.max(c.size[1], c.size[2]) * (bike ? 1 : c.size[0]);
  const findTyres = () => {
    const found = {};
    for (const loose of [false, true]) {
      for (const c of comps) {
        if (!tireOk(c, loose)) continue;
        const q = quad(c.c[0], c.c[2]);
        if (found[q] && !loose) { const w = found[q]; if (score(c) <= score(w)) continue; }
        if (found[q] && loose) continue;
        found[q] = c;
      }
    }
    return found;
  };
  let wheels = findTyres();
  // bikes: the rear tyre is always the wider one; that beats part names for front/back
  if (bike && wheels.F && wheels.R && car.import?.flip === undefined) {
    const wf = wheels.F.size[0], wr = wheels.R.size[0];
    if (wf > wr * 1.08) { applyAll(rotY(Math.PI)); say(`front tyre wider than rear (${wf.toFixed(3)} > ${wr.toFixed(3)}): rotated 180 deg`); collect(); wheels = findTyres(); }
    else if (wr > wf * 1.08 && flipFB) say('rear tyre is the wider one: orientation confirmed');
  }
  const W = {};
  for (const q of bike ? ['F', 'R'] : ['FL', 'FR', 'RL', 'RR']) {
    const c = wheels[q];
    if (!c) { say(`WARNING: no tyre found for ${q}`); continue; }
    W[q] = { id: q, x: c.c[0], y: c.c[1], z: c.c[2], r: Math.max(c.size[1], c.size[2]) / 2, w: c.size[0], spin: new Map(), fixed: new Map() };
  }
  const wheelIds = Object.keys(W);
  // anything inside a tyre's cylinder belongs to that wheel; off-axis chunky parts (calipers) stay put
  for (const c of comps) {
    for (const q of wheelIds) {
      const w = W[q];
      const rr = Math.max(c.size[1], c.size[2]) / 2;
      const dist = Math.hypot(c.c[1] - w.y, c.c[2] - w.z);
      const inside = dist + rr <= w.r * 1.06 && Math.abs(c.c[0] - w.x) + c.size[0] / 2 <= w.w / 2 + (bike ? 0.1 : 0.16) && c.size[0] < 0.7;
      if (!inside) continue;
      const staticPart = RX.caliper.test(labelOf(c.part)) || (dist > 0.3 * w.r && rr * 2 > 0.08 && rr * 2 < 0.8 * w.r);
      const bucket = staticPart ? w.fixed : w.spin;
      if (!bucket.has(c.part)) bucket.set(c.part, []);
      for (const t of c.tris) bucket.get(c.part).push(t);
      c.taken = true;
      break;
    }
  }
  // ground = lowest tyre point
  if (wheelIds.length) {
    const ground = Math.min(...wheelIds.map((q) => W[q].y - W[q].r));
    if (Math.abs(ground) > 0.002) { applyAll(transM(0, -ground, 0)); for (const q of wheelIds) W[q].y -= ground; say(`ground offset ${ground.toFixed(3)}`); }
  }
  for (const q of wheelIds) { const w = W[q]; say(`wheel ${q}: centre (${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)}) r ${w.r.toFixed(3)} w ${w.w.toFixed(3)} parts ${w.spin.size}+${w.fixed.size} fixed`); }

  // split primitives: wheel triangles move into wheel pieces, the rest stays body
  const body = [];
  const wheelPieces = Object.fromEntries(wheelIds.map((q) => [q, { spin: [], fixed: [] }]));
  for (const p of P) {
    const taken = new Set();
    for (const q of wheelIds) for (const kind of ['spin', 'fixed']) {
      const tris = W[q][kind].get(p);
      if (!tris?.length) continue;
      for (const t of tris) taken.add(t);
      wheelPieces[q][kind].push({ prim: subsetPrimitive(doc, p.prim, tris), name: p.name });
    }
    if (!taken.size) { body.push(p); continue; }
    const rest = [...Array(triCount(p.prim)).keys()].filter((t) => !taken.has(t));
    if (rest.length) body.push({ prim: subsetPrimitive(doc, p.prim, rest), name: p.name });
  }
  // re-centre wheel geometry on the hub
  for (const q of wheelIds) for (const kind of ['spin', 'fixed']) for (const piece of wheelPieces[q][kind]) transformPrimitive(piece.prim, transM(-W[q].x, -W[q].y, -W[q].z));

  // ---- 5. materials
  const matInfo = new Map();
  const note = (mat, piece, area, c) => {
    if (!mat) return;
    let m = matInfo.get(mat);
    if (!m) { m = { mat, area: 0, names: new Set(), z: 0, y: 0, x: 0 }; matInfo.set(mat, m); }
    m.area += area; m.z += c[2] * area; m.y += c[1] * area; m.x += Math.abs(c[0]) * area; m.names.add(piece.name);
  };
  for (const p of body) { const t = [...Array(triCount(p.prim)).keys()]; const pb = triSetBounds(positions(p.prim), t, triIndices(p.prim)); note(p.prim.getMaterial(), p, pb.area, pb.c); }
  const L = spec.len;
  const texOf = (m) => `${m.mat.getName() || ''} ${[...m.names].join(' ')}`;
  const classes = new Map();
  for (const m of matInfo.values()) {
    const z = m.z / m.area, y = m.y / m.area, mat = m.mat, name = texOf(m);
    const transmission = mat.getExtension('KHR_materials_transmission');
    const alpha = mat.getBaseColorFactor()[3];
    if (RX.glass.test(mat.getName() || '') || transmission || (mat.getAlphaMode() === 'BLEND' && alpha < 0.85)) {
      if (z > L / 2 - 0.75 && y < 1.0 && y > 0.3 && !RX.glass.test(name)) classes.set(mat, 'headlight');
      else classes.set(mat, 'glass');
    }
    if (RX.head.test(name) && z > 0) classes.set(mat, 'headlight');
    else if (RX.tail.test(name) && z < 0) classes.set(mat, 'taillight');
    else if (RX.caliper.test(name)) classes.set(mat, 'caliper');
  }
  // paint: the named body-colour material with the most area, else the largest exterior material
  const candidates = [...matInfo.values()].filter((m) => !classes.has(m.mat) && !RX.notPaint.test(m.mat.getName() || '') && !RX.interior.test(texOf(m)));
  const named = candidates.filter((m) => RX.paint.test(texOf(m)));
  const pick = (list) => list.sort((a, b2) => b2.area - a.area)[0];
  const paint = car.import?.paint ? [...matInfo.values()].find((m) => m.mat.getName() === car.import.paint) : pick(named.length ? named : candidates);
  if (paint) classes.set(paint.mat, 'paint');
  // tidy materials for real-time use
  let glassN = 0;
  for (const [mat, cls] of classes) {
    if (cls === 'paint') mat.setName('paint');
    if (cls === 'glass') mat.setName(glassN++ ? `glass_${glassN}` : 'glass');
    if (cls === 'headlight') mat.setName('headlight');
    if (cls === 'taillight') mat.setName('taillight');
    if (cls === 'caliper') mat.setName('caliper');
  }
  for (const mat of root.listMaterials()) {
    // transmission needs an extra full-scene pass per frame in three.js: fake it with alpha blending
    if (mat.getExtension('KHR_materials_transmission') || classes.get(mat) === 'glass') {
      mat.setExtension('KHR_materials_transmission', null);
      mat.setExtension('KHR_materials_volume', null);
      const c = mat.getBaseColorFactor();
      mat.setBaseColorFactor([c[0] * 0.25, c[1] * 0.25, c[2] * 0.27, 0.32]).setAlphaMode('BLEND').setRoughnessFactor(0.04).setMetallicFactor(0.1);
    }
    for (const ext of ['KHR_materials_variants', 'KHR_materials_iridescence', 'KHR_materials_sheen', 'KHR_materials_dispersion', 'KHR_materials_anisotropy']) mat.setExtension(ext, null);
  }
  say(`materials: paint=${paint ? `"${[...paint.names][0]}"` : 'NONE'} glass=${glassN} headlight=${[...classes.values()].includes('headlight')} taillight=${[...classes.values()].includes('taillight')}`);

  // ---- 6. merge per material, build LODs
  const buffer = root.listBuffers()[0];
  const merge = (pieces) => {
    const groups = new Map();
    for (const piece of pieces) {
      const pr = piece.prim;
      const key = `${root.listMaterials().indexOf(pr.getMaterial())}|${pr.listSemantics().sort().join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pr);
    }
    const out = [];
    for (const list of groups.values()) out.push(list.length === 1 ? list[0] : joinPrimitives(list));
    return out;
  };
  const simplifyList = (prims, targetTris, error) => {
    const total = prims.reduce((a, pr) => a + triCount(pr), 0);
    const ratio = Math.min(1, targetTris / Math.max(1, total));
    if (ratio >= 0.999) return prims;
    for (const pr of prims) { weldPrimitive(pr); simplifyPrimitive(pr, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }); }
    return prims.filter((pr) => triCount(pr) > 0);
  };
  const cloneList = (pieces) => pieces.map((pc) => ({ name: pc.name, prim: subsetPrimitive(doc, pc.prim, [...Array(triCount(pc.prim)).keys()]) }));
  const budget = opt.budget || (bike ? { body0: 90000, wheel0: 8000, body1: 9000, wheel1: 600 } : { body0: 120000, wheel0: 9000, body1: 14000, wheel1: 700 });
  const lod1Body = cloneList(body.filter((p) => !RX.interior.test(p.name)));
  const lod1Wheels = Object.fromEntries(wheelIds.map((q) => [q, { spin: cloneList(wheelPieces[q].spin), fixed: cloneList(wheelPieces[q].fixed) }]));
  const lods = [
    { name: 'lod0', body: simplifyList(merge(body), budget.body0, 0.0015), wheels: Object.fromEntries(wheelIds.map((q) => [q, { spin: simplifyList(merge(wheelPieces[q].spin), budget.wheel0, 0.002), fixed: merge(wheelPieces[q].fixed) }])) },
    { name: 'lod1', body: simplifyList(merge(lod1Body), budget.body1, 0.03), wheels: Object.fromEntries(wheelIds.map((q) => [q, { spin: simplifyList(merge(lod1Wheels[q].spin), budget.wheel1, 0.03), fixed: simplifyList(merge(lod1Wheels[q].fixed), 120, 0.05) }])) },
  ];

  // ---- 7. markers from the final geometry
  b = boundsOf(body);
  const H = b.size[1], Wd = b.size[0], zF = b.max[2], zR = b.min[2];
  const matCentres = (cls) => {
    const out = { L: null, R: null };
    for (const side of ['L', 'R']) {
      let a = 0, c = [0, 0, 0];
      for (const p of body) {
        if (classes.get(p.prim.getMaterial()) !== cls) continue;
        const idx = triIndices(p.prim), pos = positions(p.prim);
        const tris = [...Array(triCount(p.prim)).keys()].filter((t) => (pos[idx[t * 3] * 3] > 0) === (side === 'L'));
        if (!tris.length) continue;
        const pb = triSetBounds(pos, tris, idx);
        a += pb.area; for (let k = 0; k < 3; k++) c[k] += pb.c[k] * pb.area;
      }
      if (a > 0) out[side] = c.map((v) => v / a);
    }
    return out;
  };
  const head = matCentres('headlight'), tail = matCentres('taillight');
  const markers = {
    light_head_L: head.L || [Wd * 0.33, Math.min(0.72, H * 0.5), zF - 0.12], light_head_R: head.R || [-Wd * 0.33, Math.min(0.72, H * 0.5), zF - 0.12],
    light_tail_L: tail.L || [Wd * 0.36, Math.min(0.9, H * 0.62), zR + 0.1], light_tail_R: tail.R || [-Wd * 0.36, Math.min(0.9, H * 0.62), zR + 0.1],
    exhaust_L: [Wd * 0.2, 0.3, zR + 0.06], exhaust_R: [-Wd * 0.2, 0.3, zR + 0.06],
    eye_bumper: [0, 0.55, zF + 0.05],
  };
  // exhaust tips / steering wheel by name
  const named2 = (re) => { const hits = []; for (const p of body) if (re.test(p.name)) for (const c of components(p.prim)) if (c.size[0] < 0.3 && c.size[1] < 0.3) hits.push(c); return hits; };
  const tips = named2(RX.exhaust).filter((c) => c.c[2] < zR + 0.6 && c.c[1] < 0.6);
  if (tips.length) { const l = tips.filter((c) => c.c[0] > 0), r = tips.filter((c) => c.c[0] <= 0); if (l.length) markers.exhaust_L = l.sort((a, c) => a.c[2] - c.c[2])[0].c; if (r.length) markers.exhaust_R = r.sort((a, c) => a.c[2] - c.c[2])[0].c; }
  const steer = [];
  for (const p of body) if (RX.steer.test(p.name)) { const t = [...Array(triCount(p.prim)).keys()]; steer.push(triSetBounds(positions(p.prim), t, triIndices(p.prim))); }
  const sw = steer.sort((a, c) => c.area - a.area)[0];
  markers.eye_cockpit = sw ? [sw.c[0], sw.c[1] + 0.24, sw.c[2] - 0.45] : [Wd * 0.2, H * 0.78, 0];
  // hood camera just above the bonnet line
  let hoodY = H * 0.6;
  for (const p of body) { const pos = positions(p.prim); for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > zF - 1.3 && pos[i + 2] < zF - 0.6 && Math.abs(pos[i]) < 0.4 && pos[i + 1] > hoodY) hoodY = pos[i + 1]; }
  markers.eye_hood = [0, hoodY + 0.28, zF * 0.3];
  if (bike) {
    // single centre lamps, one exhaust (on whichever side the named tip was found), eyes over the tank
    if (!head.L && !head.R) { markers.light_head_L = [0.05, Math.min(0.9, H * 0.72), zF - 0.18]; markers.light_head_R = [-0.05, markers.light_head_L[1], zF - 0.18]; }
    if (!tail.L && !tail.R) { markers.light_tail_L = [0.04, Math.min(0.95, H * 0.78), zR + 0.08]; markers.light_tail_R = [-0.04, markers.light_tail_L[1], zR + 0.08]; }
    for (const k of ['light_head', 'light_tail']) { const l = markers[k + '_L'], r = markers[k + '_R']; if (!l) markers[k + '_L'] = [...r]; if (!r) markers[k + '_R'] = [...l]; }
    if (!tips.length) { delete markers.exhaust_L; markers.exhaust_R = [-0.14, 0.42, zR + 0.3]; }
    else if (tips.every((c) => c.c[0] > 0)) delete markers.exhaust_R;
    else if (tips.every((c) => c.c[0] <= 0)) delete markers.exhaust_L;
    markers.eye_bumper = [0, 0.72, zF + 0.02];
    markers.eye_hood = [0, Math.max(1.1, H * 0.95), zF * 0.15];
    markers.eye_cockpit = [0, 1.32, -0.02];
  }
  say(`markers: head ${head.L ? 'from lamps' : 'estimated'}, tail ${tail.L ? 'from lamps' : 'estimated'}, cockpit ${sw ? 'from steering wheel' : 'estimated'}`);

  // ---- 8. assemble the scene
  const top = doc.createNode(car.id);
  scene.addChild(top);
  let tris0 = 0, tris1 = 0, calls0 = 0;
  for (const lod of lods) {
    const g = doc.createNode(lod.name);
    top.addChild(g);
    lod.body.forEach((pr, i) => {
      const mesh = doc.createMesh(`${lod.name}_body_${i}`).addPrimitive(pr);
      g.addChild(doc.createNode(`body_${i}`).setMesh(mesh));
      if (lod.name === 'lod0') { tris0 += triCount(pr); calls0++; } else tris1 += triCount(pr);
    });
    for (const q of wheelIds) {
      const wn = doc.createNode(`wheel_${q}`).setTranslation([W[q].x, W[q].y, W[q].z]);
      g.addChild(wn);
      for (const kind of ['spin', 'fixed']) {
        const kn = doc.createNode(kind);
        wn.addChild(kn);
        lod.wheels[q][kind].forEach((pr, i) => {
          kn.addChild(doc.createNode(`${kind}_${i}`).setMesh(doc.createMesh(`${lod.name}_${q}_${kind}_${i}`).addPrimitive(pr)));
          if (lod.name === 'lod0') { tris0 += triCount(pr); calls0++; } else tris1 += triCount(pr);
        });
      }
    }
    if (lod.name === 'lod0') for (const [n, v] of Object.entries(markers)) g.addChild(doc.createNode(n).setTranslation(v.map((x) => +x.toFixed(4))));
  }
  // drop the scratch primitives that didn't make it into the final meshes
  for (const pr of root.listMeshes().flatMap((m) => m.listPrimitives())) void pr;
  say(`lod0 ${tris0} tris in ${calls0} draw calls, lod1 ${tris1} tris`);
  void buffer;
  return {
    log,
    info: {
      length: +b.size[2].toFixed(3), width: +b.size[0].toFixed(3), height: +b.size[1].toFixed(3),
      wheels: wheelIds.map((q) => ({ id: q, x: +W[q].x.toFixed(3), y: +W[q].y.toFixed(3), z: +W[q].z.toFixed(3), r: +W[q].r.toFixed(3), w: +W[q].w.toFixed(3) })),
      tris: { lod0: tris0, lod1: tris1 }, drawCalls: calls0, paint: !!paint,
      lights: { head: !!head.L, tail: !!tail.L },
    },
  };
}
