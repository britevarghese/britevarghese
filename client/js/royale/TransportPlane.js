// Four-engine military transport (C-130-class proportions: 29.8 m long, 40.4 m span, 11.6 m tall), modelled
// procedurally because no CC0 aircraft mesh exists: lofted fuselage with flat cargo floor and upswept tail,
// airfoil-section tapered wings with dihedral, turboprop nacelles with spinning 4-blade propellers, external fuel
// tanks, landing-gear sponsons, cockpit glazing, cabin windows, painted panel lines / rivets / exhaust staining and
// blinking navigation + anti-collision lights. Local frame: nose toward -Z, +Y up, origin near the wing root.
import * as THREE from 'three';

// ---------------------------------------------------------------- loft: sections (closed loops) -> skinned mesh
// sections: [{ pts: [[x,y,z]...] }] all with the same point count; u runs around the loop, v along the sections
export function loft(sections, { closeEnds = true, uScale = 1, vFrom = 0, vTo = 1 } = {}) {
  const n = sections[0].length, m = sections.length;
  const pos = [], uv = [], idx = [];
  // cumulative length along the loft for v
  const lens = [0];
  for (let j = 1; j < m; j++) {
    const a = sections[j - 1], b = sections[j];
    let d = 0; for (let i = 0; i < n; i++) d += Math.hypot(b[i][0] - a[i][0], b[i][1] - a[i][1], b[i][2] - a[i][2]);
    lens.push(lens[j - 1] + d / n);
  }
  const L = lens[m - 1] || 1;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i <= n; i++) {
      const p = sections[j][i % n];
      pos.push(p[0], p[1], p[2]);
      uv.push((i / n) * uScale, vFrom + (vTo - vFrom) * (lens[j] / L));
    }
  }
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (closeEnds) {
    for (const [j, flip] of [[0, true], [m - 1, false]]) {
      const s = sections[j];
      const cx = s.reduce((t, p) => t + p[0], 0) / n, cy = s.reduce((t, p) => t + p[1], 0) / n, cz = s.reduce((t, p) => t + p[2], 0) / n;
      const ci = pos.length / 3; pos.push(cx, cy, cz); uv.push(0.5, j ? vTo : vFrom);
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1;
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// superellipse ring (fuselage / nacelle cross-section). Points start at the top and go clockwise seen from the nose.
export function ring(cx, cy, z, hw, hhTop, hhBot, n = 28, e = 2.6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = Math.sin(a), c = Math.cos(a);
    const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * hw;
    const yr = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    pts.push([cx + x, cy + yr * (yr > 0 ? hhTop : hhBot), z]);
  }
  return pts;
}

// NACA 00xx-like symmetric airfoil (chord along +Z from the leading edge), n points around
export function airfoil(chord, thick, n = 20) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = (1 - Math.cos(a)) / 2;                         // 0 (LE) -> 1 (TE) -> 0
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    pts.push([x * chord, Math.sin(a) >= 0 ? t * chord : -t * chord]);
  }
  return pts;
}

// ---------------------------------------------------------------- painted skin (canvas textures)
function skinTexture(kind) {
  const W = 2048, H = kind === 'fuselage' ? 1024 : 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // base: matte medium grey with slight blotchy weathering
  g.fillStyle = '#6f7571'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 20 + Math.random() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const d = Math.random() < 0.5;
    gr.addColorStop(0, d ? 'rgba(40,44,42,0.10)' : 'rgba(150,155,150,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // panel lines + rivet rows
  g.strokeStyle = 'rgba(30,33,32,0.55)'; g.lineWidth = 1.2;
  const cols = kind === 'fuselage' ? 34 : 18, rows = kind === 'fuselage' ? 10 : 6;
  for (let i = 1; i < cols; i++) { const x = (i / cols) * W + (Math.random() - 0.5) * 6; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let j = 1; j < rows; j++) { const y = (j / rows) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = 'rgba(25,28,27,0.35)';
  for (let i = 0; i < cols; i++) for (let y = 4; y < H; y += 9) g.fillRect((i / cols) * W + 5, y, 1.4, 1.4);
  if (kind === 'fuselage') {
    // u = around the body (0 = top, .25 = right, .5 = belly, .75 = left), v = nose (0) -> tail (1)
    const U = (u) => u * W, V = (v) => v * H;
    // cockpit glazing: windscreen band + eyebrow windows
    g.fillStyle = '#121619';
    for (const [u0, u1] of [[0.93, 1.0], [0.0, 0.07], [0.83, 0.92], [0.08, 0.17]]) g.fillRect(U(u0), V(0.045), U(u1 - u0), V(0.028));
    g.fillRect(U(0.955), V(0.036), U(0.045), V(0.009)); g.fillRect(U(0.0), V(0.036), U(0.045), V(0.009));
    // cabin windows (both sides)
    for (const u of [0.21, 0.79]) for (let v = 0.13; v < 0.62; v += 0.075) { g.beginPath(); g.arc(U(u), V(v), 7, 0, Math.PI * 2); g.fillStyle = '#15191c'; g.fill(); g.strokeStyle = 'rgba(200,205,200,.35)'; g.lineWidth = 1.5; g.stroke(); }
    // crew / paratroop doors
    g.strokeStyle = 'rgba(20,22,21,0.8)'; g.lineWidth = 2;
    g.strokeRect(U(0.265), V(0.12), U(0.035), V(0.05)); g.strokeRect(U(0.7), V(0.12), U(0.035), V(0.05));
    g.strokeRect(U(0.27), V(0.66), U(0.03), V(0.05)); g.strokeRect(U(0.7), V(0.66), U(0.03), V(0.05));
    // cargo ramp outline under the tail
    g.strokeRect(U(0.4), V(0.72), U(0.2), V(0.2));
    // tail number + walkway stripes (generic, no national insignia)
    g.fillStyle = 'rgba(25,27,26,0.85)'; g.font = 'bold 38px sans-serif';
    for (const [u, flip] of [[0.28, false], [0.72, true]]) { g.save(); g.translate(U(u), V(0.78)); g.rotate(flip ? Math.PI / 2 : -Math.PI / 2); g.fillText('SP 4072', -70, 12); g.restore(); }
    // exhaust soot and belly grime
    const soot = g.createLinearGradient(0, 0, 0, H);
    soot.addColorStop(0, 'rgba(0,0,0,0)'); soot.addColorStop(1, 'rgba(20,20,18,0.25)');
    g.fillStyle = soot; g.fillRect(U(0.4), 0, U(0.2), H);
  } else {
    // wing: u = around the airfoil, v = root -> tip: flap / aileron lines, walkway, exhaust soot behind engines
    g.strokeStyle = 'rgba(20,22,21,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W * 0.42, 0); g.lineTo(W * 0.42, H); g.stroke();
    for (const v of [0.08, 0.5, 0.52, 0.9]) { g.beginPath(); g.moveTo(W * 0.3, v * H); g.lineTo(W * 0.5, v * H); g.stroke(); }
    for (const v of [0.27, 0.55]) { const gr = g.createLinearGradient(W * 0.25, 0, W * 0.5, 0); gr.addColorStop(0, 'rgba(20,20,18,0)'); gr.addColorStop(1, 'rgba(20,20,18,0.45)'); g.fillStyle = gr; g.fillRect(W * 0.25, (v - 0.04) * H, W * 0.25, 0.08 * H); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.flipY = false; // canvas y = loft v (nose -> tail)
  return t;
}

// ---------------------------------------------------------------- the aircraft
export function buildTransportPlane() {
  const g = new THREE.Group(); g.name = 'transport_plane';
  const fusMat = new THREE.MeshStandardMaterial({ map: skinTexture('fuselage'), metalness: 0.35, roughness: 0.62, side: THREE.DoubleSide });
  const wingMat = new THREE.MeshStandardMaterial({ map: skinTexture('wing'), metalness: 0.35, roughness: 0.6, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5f6560, metalness: 0.45, roughness: 0.55, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d1e, metalness: 0.6, roughness: 0.35 });
  // spinning blades are mostly a blur: semi-transparent
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2d, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.55, depthWrite: false });

  // fuselage: [z, halfWidth, halfHeightTop, halfHeightBottom, centreY]
  const F = [
    [-13.0, 0.12, 0.12, 0.12, -0.35], [-12.75, 0.75, 0.7, 0.72, -0.3], [-12.3, 1.3, 1.25, 1.35, -0.2], [-11.7, 1.72, 1.7, 1.75, -0.05],
    [-11.0, 1.98, 2.0, 2.0, 0.05], [-10.0, 2.15, 2.12, 2.1, 0.05], [-8.0, 2.22, 2.15, 2.12, 0.0], [8.0, 2.22, 2.15, 2.12, 0.0],
    [10.0, 2.12, 2.05, 1.8, 0.28], [12.0, 1.85, 1.8, 1.35, 0.75], [14.0, 1.45, 1.45, 0.95, 1.25], [15.8, 1.0, 1.05, 0.6, 1.7],
    [17.0, 0.6, 0.7, 0.35, 1.98], [17.9, 0.22, 0.3, 0.15, 2.15], [18.2, 0.05, 0.06, 0.05, 2.2],
  ];
  // e > 2 = boxier cross-section (flat cargo floor, straight sides)
  const fus = loft(F.map(([z, hw, ht, hb, cy]) => ring(0, cy, z, hw, ht, hb, 32, z > -11 && z < 9 ? 2.9 : 2.3)));
  const body = new THREE.Mesh(fus, fusMat); body.castShadow = true; g.add(body);
  // radome nose cap darker
  const nose = new THREE.Mesh(loft(F.slice(0, 3).map(([z, hw, ht, hb, cy]) => ring(0, cy, z + 0.01, hw * 1.01, ht * 1.01, hb * 1.01, 32, 2.3))), new THREE.MeshStandardMaterial({ color: 0x4a4f4c, metalness: 0.2, roughness: 0.7 }));
  g.add(nose);
  // landing gear sponsons along the lower sides
  for (const s of [1, -1]) {
    const S = [[-3.2, 0.05], [-2.6, 0.45], [2.6, 0.45], [3.4, 0.05]].map(([z, w]) => ring(s * 2.05, -1.55, z, w, w * 1.3, w * 0.9, 16, 2.4));
    const sp = new THREE.Mesh(loft(S), fusMat); sp.castShadow = true; g.add(sp);
  }

  // wings: tapered, dihedral, slight sweep of the leading edge; mounted on top of the fuselage
  const WING_Y = 2.0, rootChord = 4.9, tipChord = 2.6, span = 20.2;
  for (const s of [1, -1]) {
    const secs = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, chord = rootChord + (tipChord - rootChord) * t, x = s * (0.3 + t * span);
      const lex = -2.9 + t * 1.2, y = WING_Y + t * span * Math.tan(0.042);
      secs.push(airfoil(chord, t < 0.1 ? 0.17 : 0.14 - t * 0.03, 22).map(([cz, cy]) => [x, y + cy, lex + cz]));
    }
    const w = new THREE.Mesh(loft(secs), wingMat); w.castShadow = true; g.add(w);
    // wing-to-body fairing
    const fr = new THREE.Mesh(loft([ring(0, 1.95, -3.6, 1.2, 0.25, 0.1, 16), ring(0, 2.15, -2.8, 1.5, 0.45, 0.1, 16), ring(0, 2.15, 1.8, 1.5, 0.45, 0.1, 16), ring(0, 1.95, 2.8, 1.0, 0.2, 0.1, 16)]), fusMat);
    g.add(fr);
    // turboprop nacelles + 4-blade propellers
    for (const x of [5.2, 10.3]) {
      const t = (x - 0.3) / span, y = WING_Y + t * span * Math.tan(0.042) - 0.35, lex = -2.9 + t * 1.2;
      const N = [[lex - 1.7, 0.3, 0.3], [lex - 1.4, 0.52, 0.55], [lex - 0.6, 0.6, 0.66], [lex + 1.8, 0.58, 0.7], [lex + 3.4, 0.4, 0.45], [lex + 4.6, 0.15, 0.16]];
      const nac = new THREE.Mesh(loft(N.map(([z, hw, hh]) => ring(s * x, y, z, hw, hh * 0.9, hh, 18, 2.2))), metal);
      nac.castShadow = true; g.add(nac);
      // exhaust stain + intake
      const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12), dark);
      intake.rotation.x = Math.PI / 2; intake.position.set(s * x, y - 0.42, lex - 1.1); g.add(intake);
      const prop = new THREE.Group(); prop.position.set(s * x, y, lex - 1.85); prop.name = 'prop';
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 16), metal); spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.35; prop.add(spinner);
      const blades = new THREE.Group(); blades.name = 'blades';
      for (let b = 0; b < 4; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.05, 0.04), bladeMat);
        bl.geometry.translate(0, 1.1, 0);
        const holder = new THREE.Group(); holder.rotation.z = (b / 4) * Math.PI * 2; bl.rotation.y = 0.45; holder.add(bl); blades.add(holder);
      }
      prop.add(blades);
      // motion-blur disc, faded in at speed
      const disc = new THREE.Mesh(new THREE.RingGeometry(0.35, 2.15, 48), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      disc.name = 'blur'; prop.add(disc);
      g.add(prop);
    }
    // external fuel tank between the engines
    const tx = s * 7.7, tt = (7.7 - 0.3) / span, ty = WING_Y + tt * span * Math.tan(0.042) - 0.75, tlex = -2.9 + tt * 1.2;
    const T = [[tlex - 1.2, 0.05], [tlex - 0.6, 0.38], [tlex + 2.6, 0.42], [tlex + 4.2, 0.08]];
    const tank = new THREE.Mesh(loft(T.map(([z, r]) => ring(tx, ty, z, r, r, r, 14, 2))), metal); tank.castShadow = true; g.add(tank);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 2.2), metal); pylon.position.set(tx, ty + 0.35, tlex + 1.2); g.add(pylon);
  }

  // vertical fin (swept) + dorsal fillet, horizontal stabilisers
  const fin = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5, chord = 5.4 + (2.4 - 5.4) * t, y = 2.4 + t * 6.9, lez = 12.2 + t * 3.6;
    fin.push(airfoil(chord, 0.12, 20).map(([cz, cx]) => [cx, y, lez + cz]));
  }
  const finM = new THREE.Mesh(loft(fin), fusMat); finM.castShadow = true; g.add(finM);
  for (const s of [1, -1]) {
    const st = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, chord = 3.4 + (1.7 - 3.4) * t, x = s * (0.4 + t * 7.9), lez = 14.4 + t * 1.3;
      st.push(airfoil(chord, 0.11, 18).map(([cz, cy]) => [x, 2.35 + cy, lez + cz]));
    }
    const sm = new THREE.Mesh(loft(st), wingMat); sm.castShadow = true; g.add(sm);
  }

  // lights: red anti-collision beacons (top + belly), wingtip nav lights (red left, green right), white tail light
  const glow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const light = (color, pos, size, name) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.set(...pos); sp.scale.setScalar(size); sp.name = name; g.add(sp); return sp;
  };
  const beacons = [light(0xff2a1a, [0, 4.3, 1.0], 2.2, 'beacon'), light(0xff2a1a, [0, -2.15, 2.0], 2.2, 'beacon')];
  light(0xff3322, [-20.6, 2.9, -1.0], 1.4, 'nav'); light(0x33ff66, [20.6, 2.9, -1.0], 1.4, 'nav'); light(0xffffff, [0, 2.3, 18.2], 1.2, 'nav');

  const props = []; g.traverse((o) => { if (o.name === 'blades') props.push(o); });
  const blurs = []; g.traverse((o) => { if (o.name === 'blur') blurs.push(o); });
  let t = 0;
  // per-frame animation: propellers at flight rpm (~1020 rpm), beacon flash
  g.userData.update = (dt) => {
    t += dt;
    for (const p of props) p.rotation.z += dt * 107;
    for (const b of blurs) b.material.opacity = 0.1;
    const on = (t % 1.2) < 0.12;
    for (const b of beacons) b.visible = on;
  };
  return g;
}
