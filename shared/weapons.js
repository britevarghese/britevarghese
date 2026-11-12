// Logical weapon definitions (server-authoritative). The `visual` key refers to an entry in
// client/assets/asset-manifest.json – the mesh can be swapped without touching gameplay.

export const WEAPONS = {
  ar: {
    id: 'ar', name: 'AR-15 Carbine', slot: 0, visual: 'assault_rifle', auto: true,
    damage: 26, headMul: 3.9, legMul: 0.75, rpm: 720, mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.9,
    range: [28, 70], minDamage: 17, engage: 170, spreadHip: 2.6, spreadAds: 0.055, spreadMove: 1.6,
    recoil: { pitch: 0.42, yaw: 0.18, recover: 9 }, adsTime: 0.22, adsFov: 0.72, speed: 1.0, tracer: 3,
    // ballistics (5.56x45 mm M855): muzzle velocity m/s, quadratic drag (1/m: ~550 m/s left at 500 m), max range m,
    // sight zeroing m
    velocity: 910, dragQ: 1.0e-3, maxRange: 700, zero: [50, 100, 200, 300],
  },
  sniper: {
    id: 'sniper', name: 'M-38 Bolt Rifle', slot: 0, visual: 'bolt_rifle', auto: false, bolt: 1.05,
    damage: 92, headMul: 2.2, legMul: 0.8, rpm: 55, mag: 5, reserve: 30, reload: 3.1, reloadEmpty: 3.1,
    range: [80, 200], minDamage: 70, engage: 550, spreadHip: 5, spreadAds: 0.0, spreadMove: 3,
    recoil: { pitch: 2.8, yaw: 0.4, recover: 5 }, adsTime: 0.34, adsFov: 0.22, speed: 0.95, tracer: 1, scoped: true,
    // 7.62x54 mmR (~370 m/s left at 1000 m)
    velocity: 830, dragQ: 0.8e-3, maxRange: 1200, zero: [100, 200, 300, 400, 500, 600, 800],
  },
  // Support: a belt-fed 5.56 mm light machine gun (M249 pattern). A 100-round box and a long reload; heavy and wild from
  // the hip, steady once settled: prone (or crouched) the bipod / braced stance halves the spread and the climb.
  lmg: {
    id: 'lmg', name: 'M249 Light MG', slot: 0, visual: 'lmg', auto: true, bipod: true,
    damage: 25, headMul: 3.4, legMul: 0.75, rpm: 760, mag: 100, reserve: 200, reload: 5.6, reloadEmpty: 6.2,
    range: [30, 80], minDamage: 18, engage: 180, spreadHip: 3.8, spreadAds: 0.1, spreadMove: 2.6,
    recoil: { pitch: 0.36, yaw: 0.26, recover: 8 }, adsTime: 0.36, adsFov: 0.72, speed: 0.92, tracer: 2,
    velocity: 915, dragQ: 1.0e-3, maxRange: 800, zero: [100, 200, 300, 400, 500],
  },
  // Medic: a 9 mm submachine gun (MP5 pattern). Quick to the shoulder and to move with, a high rate of fire; the
  // pistol round loses its punch past ~40 m.
  smg: {
    id: 'smg', name: 'MP5 Submachine Gun', slot: 0, visual: 'smg', auto: true,
    damage: 23, headMul: 3.5, legMul: 0.8, rpm: 840, mag: 30, reserve: 150, reload: 2.0, reloadEmpty: 2.5,
    range: [12, 40], minDamage: 13, engage: 90, spreadHip: 1.9, spreadAds: 0.09, spreadMove: 1.0,
    recoil: { pitch: 0.3, yaw: 0.15, recover: 11 }, adsTime: 0.16, adsFov: 0.78, speed: 1.05, tracer: 3,
    velocity: 400, dragQ: 1.6e-3, maxRange: 300, zero: [25, 50, 100],
  },
  pistol: {
    id: 'pistol', name: 'P-17 Service Pistol', slot: 1, visual: 'pistol', auto: false,
    damage: 24, headMul: 4.2, legMul: 0.75, rpm: 400, mag: 15, reserve: 60, reload: 1.6, reloadEmpty: 1.9,
    range: [15, 40], minDamage: 14, engage: 45, spreadHip: 2.0, spreadAds: 0.22, spreadMove: 1.0,
    recoil: { pitch: 1.0, yaw: 0.25, recover: 10 }, adsTime: 0.14, adsFov: 0.85, speed: 1.05, tracer: 1,
    // 9x19 mm
    velocity: 360, dragQ: 1.6e-3, maxRange: 220, zero: [25, 50],
  },
  // disposable 84 mm recoilless anti-armour launcher (AT4 class): one shot per tube, the spent tube is dropped and the
  // next one unslung. HEAT round at ~290 m/s with no motor after it leaves the tube (full gravity: the pop-up sight
  // has range settings), lethal blast of a couple of metres; against armour it is the hit that counts — a jeep or a
  // bike is gone in one, a tank takes four from the front, three on the flank, two up the back (see armourAspect)
  at4: {
    id: 'at4', name: 'AT-84 Launcher', slot: 2, visual: 'launcher', auto: false, launcher: true,
    damage: 110, directHit: 360, vehicleDamage: 360, splash: 3.5, rpm: 30, mag: 1, reserve: 2, reload: 3.4, reloadEmpty: 3.4,
    engage: 300, spreadHip: 2.4, spreadAds: 0.1, spreadMove: 2.5,
    recoil: { pitch: 1.6, yaw: 0.5, recover: 3 }, adsTime: 0.55, adsFov: 0.78, speed: 0.9, tracer: 0,
    velocity: 290, maxRange: 600, zero: [100, 200, 300, 400],
    // the fuze arms ~10 m out of the tube: closer, the round just strikes (no blast, no self-kill at point blank)
    armDist: 10, dudDamage: 60, dudVehicle: 25,
  },
};

// armour by aspect: a shaped charge on a tank's glacis does little; on the side skirts more; up the engine deck /
// rear most (front within 50° of the hull's nose, rear within 50° of its tail). Other vehicles: no difference.
export function armourAspect(v, dir) {
  if (v.type !== 'tank') return 1;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), l = Math.hypot(dir.x, dir.z) || 1;
  const c = -(dir.x * fx + dir.z * fz) / l; // 1 = shot comes in at the nose, -1 = from behind
  return c > Math.cos(0.87) ? 0.75 : c < -Math.cos(0.87) ? 1.8 : 1.25;
}

// M67-like: 4 s fuse, ~15 m/s overarm throw under real gravity (lands ~25-30 m away on a lob)
export const GRENADE = { fuse: 4.0, radius: 9, maxDamage: 130, count: 2, throwSpeed: 15, gravity: 9.81 };

export const CLASSES = {
  assault: { name: 'Assault', primary: 'ar', secondary: 'pistol', grenades: 2 },
  recon: { name: 'Recon', primary: 'sniper', secondary: 'pistol', grenades: 1 },
  // support: double ammo, extra grenades, an anti-armour launcher, resupplies teammates nearby (ammo bag)
  support: { name: 'Support', primary: 'lmg', secondary: 'pistol', gadget: 'at4', grenades: 4, ammoMul: 2, resupply: true },
  // medic: heals faster, patches up teammates within a few metres, and revives downed teammates
  medic: { name: 'Medic', primary: 'smg', secondary: 'pistol', grenades: 1, medic: true },
};
// short role descriptions + perks (shown on the deploy screen)
export const CLASS_INFO = {
  assault: { role: 'Close range · Balanced', perk: 'All-round carbine kit' },
  recon: { role: 'Long range · Intel', perk: 'Bolt-action rifle, 4x scope, spots further and longer' },
  support: { role: 'Heavy firepower · Anti-armour', perk: 'Light MG (steady prone), AT launcher, double ammo, resupplies squad' },
  medic: { role: 'Heal · Revive', perk: 'SMG, revives downed teammates, heals those nearby, fast self-heal' },
};

export function damageAt(w, dist) {
  const [r0, r1] = w.range;
  if (dist <= r0) return w.damage;
  if (dist >= r1) return w.minDamage;
  return w.damage + (w.minDamage - w.damage) * ((dist - r0) / (r1 - r0));
}

// ----------------------------------------------------------------- hitboxes (capsules), shared so client debug can draw them
// p: { x, y, z, yaw, stance }
export function hitCapsules(p) {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  if (p.stance === 'prone') {
    return [
      { part: 'head', a: [p.x + fx * 0.75, p.y + 0.3, p.z + fz * 0.75], b: [p.x + fx * 0.75, p.y + 0.3, p.z + fz * 0.75], r: 0.14 },
      { part: 'body', a: [p.x + fx * 0.5, p.y + 0.22, p.z + fz * 0.5], b: [p.x - fx * 0.3, p.y + 0.2, p.z - fz * 0.3], r: 0.24 },
      { part: 'legs', a: [p.x - fx * 0.3, p.y + 0.15, p.z - fz * 0.3], b: [p.x - fx * 1.1, p.y + 0.12, p.z - fz * 1.1], r: 0.17 },
    ];
  }
  const c = p.stance === 'crouch';
  return [
    { part: 'head', a: [p.x, p.y + (c ? 1.12 : 1.6), p.z], b: [p.x, p.y + (c ? 1.18 : 1.68), p.z], r: 0.13 },
    { part: 'body', a: [p.x, p.y + (c ? 0.55 : 0.95), p.z], b: [p.x, p.y + (c ? 0.82 : 1.28), p.z], r: 0.25 },
    { part: 'legs', a: [p.x, p.y + 0.1, p.z], b: [p.x, p.y + (c ? 0.55 : 0.95), p.z], r: 0.2 },
  ];
}

// ray (o, d normalized) vs capsule segment a-b radius r -> t or null
export function rayCapsule(o, d, a, b, r) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa = [o.x - a[0], o.y - a[1], o.z - a[2]];
  const D = [d.x, d.y, d.z];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const baba = dot(ba, ba), bard = dot(ba, D), baoa = dot(ba, oa), rdoa = dot(D, oa), oaoa = dot(oa, oa);
  if (baba < 1e-8) { // sphere
    const bq = rdoa, c = oaoa - r * r, h = bq * bq - c;
    if (h < 0) return null; const t = -bq - Math.sqrt(h); return t >= 0 ? t : null;
  }
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // caps (nearest)
  let best = null;
  for (const cap of [a, b]) {
    const oc = [o.x - cap[0], o.y - cap[1], o.z - cap[2]];
    const bq = dot(D, oc), c = dot(oc, oc) - r * r, hh = bq * bq - c;
    if (hh >= 0) { const t = -bq - Math.sqrt(hh); if (t >= 0 && (best === null || t < best)) best = t; }
  }
  return best;
}
