// Logical weapon definitions (server-authoritative). The `visual` key refers to an entry in
// client/assets/asset-manifest.json – the mesh can be swapped without touching gameplay.

export const WEAPONS = {
  ar: {
    id: 'ar', name: 'AR-15 Carbine', slot: 0, visual: 'assault_rifle', auto: true,
    damage: 26, headMul: 1.9, rpm: 720, mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.9,
    range: [28, 70], minDamage: 17, spreadHip: 2.6, spreadAds: 0.055, spreadMove: 1.6,
    recoil: { pitch: 0.42, yaw: 0.18, recover: 9 }, adsTime: 0.22, adsFov: 0.72, speed: 1.0, tracer: 3,
    // ballistics (5.56x45 mm): muzzle velocity m/s, drag (1/s velocity decay), max range m, sight zeroing m
    velocity: 910, drag: 0.32, maxRange: 700, zero: [50, 100, 200, 300],
  },
  sniper: {
    id: 'sniper', name: 'M-38 Bolt Rifle', slot: 0, visual: 'bolt_rifle', auto: false, bolt: 1.05,
    damage: 92, headMul: 2.2, rpm: 55, mag: 5, reserve: 30, reload: 3.1, reloadEmpty: 3.1,
    range: [80, 200], minDamage: 70, spreadHip: 5, spreadAds: 0.0, spreadMove: 3,
    recoil: { pitch: 2.8, yaw: 0.4, recover: 5 }, adsTime: 0.34, adsFov: 0.22, speed: 0.95, tracer: 1, scoped: true,
    // 7.62x54 mmR
    velocity: 830, drag: 0.17, maxRange: 1200, zero: [100, 200, 300, 400, 500, 600, 800],
  },
  pistol: {
    id: 'pistol', name: 'P-17 Service Pistol', slot: 1, visual: 'pistol', auto: false,
    damage: 24, headMul: 1.8, rpm: 400, mag: 15, reserve: 60, reload: 1.6, reloadEmpty: 1.9,
    range: [15, 40], minDamage: 14, spreadHip: 2.0, spreadAds: 0.22, spreadMove: 1.0,
    recoil: { pitch: 1.0, yaw: 0.25, recover: 10 }, adsTime: 0.14, adsFov: 0.85, speed: 1.05, tracer: 1,
    // 9x19 mm
    velocity: 360, drag: 0.55, maxRange: 220, zero: [25, 50],
  },
};

export const GRENADE = { fuse: 3.2, radius: 9, maxDamage: 130, count: 2, throwSpeed: 17, gravity: 14 };

export const CLASSES = {
  assault: { name: 'Assault', primary: 'ar', secondary: 'pistol', grenades: 2 },
  recon: { name: 'Recon', primary: 'sniper', secondary: 'pistol', grenades: 1 },
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
