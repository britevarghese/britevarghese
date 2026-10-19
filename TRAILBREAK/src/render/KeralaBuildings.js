// Kerala's buildings: whitewashed and pastel walls under steep roofs of red Mangalore tiles with deep eaves, laterite
// block walls, corrugated sheet sheds, a hill estate's tea factory with its rows of windows, roof vents and chimney.
// Each builder takes a landmark { x, y, z, yaw, ... } and a Builder (render/Landmarks.js) and returns the group.
import * as THREE from 'three';
import { HASH21 } from './ShaderHash.js';

const std = (color, roughness = 0.85, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** Clay tiles: courses of tiles down the slope (world-space stripes, darker in the gaps) on a weathered red. */
function tileMaterial(color) {
  const m = std(color, 0.82, 0, { side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTileW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTileW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTileW;
${HASH21}
float kh(vec2 p) { return hash21(p); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float course = fract(vTileW.y / 0.13);
  float along = fract((vTileW.x + vTileW.z) / 0.24 + floor(vTileW.y / 0.13) * 0.5);
  float gap = smoothstep(0.0, 0.12, course) * (0.75 + 0.25 * smoothstep(0.0, 0.08, along) * smoothstep(1.0, 0.92, along));
  float age = kh(floor(vec2(vTileW.x + vTileW.z, vTileW.y) / vec2(0.24, 0.13)));
  diffuseColor.rgb *= (0.55 + 0.45 * gap) * (0.82 + 0.3 * age);
}`);
  };
  return m;
}

export const KMAT = {
  wash: std(0xe9e3d3, 0.9), cream: std(0xe2d1a2, 0.88), sky: std(0xb9d3d6, 0.88), pink: std(0xdcb2a4, 0.88), lemon: std(0xe4d48a, 0.88),
  plinth: std(0x6e6660, 0.95), floor: std(0x9a3a26, 0.6), tile: tileMaterial(0xa5452a), tileOld: tileMaterial(0x8a3e2c),
  laterite: std(0x9c4a2e, 0.95), wood: std(0x5a3a22, 0.8), green: std(0x2f6a42, 0.6), blue: std(0x2f5f8a, 0.6),
  glass: std(0x1c2a30, 0.15, 0.3), dark: std(0x161412, 1), steel: std(0x6b6d6e, 0.55, 0.5), sheet: std(0x7e8a8c, 0.5, 0.55),
  rust: std(0x7a4a34, 0.75, 0.35), brick: std(0x8d3f2b, 0.9), concrete: std(0xa8a49a, 0.95), white: std(0xf2efe6, 0.7),
  sign: std(0x1f5a36, 0.6), banana: std(0x6e8a2a, 0.8), yellow: std(0xd9a62a, 0.7),
};

/** A hipped roof over a w x d plan at height y (ridge `rise` up), eaves `over` out: two trapezoids and two triangles. */
export function hipRoof(B, w, d, y, rise, m, over = 0.9) {
  const W = w / 2 + over, D = d / 2 + over, r = Math.max(0, W - D);
  const v = [
    // the long sides (trapezoids), then the ends (triangles); each face is two triangles
    -W, y, D, W, y, D, r, y + rise, 0, -W, y, D, r, y + rise, 0, -r, y + rise, 0,
    W, y, -D, -W, y, -D, -r, y + rise, 0, W, y, -D, -r, y + rise, 0, r, y + rise, 0,
    W, y, D, W, y, -D, r, y + rise, 0,
    -W, y, -D, -W, y, D, -r, y + rise, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  B.put(m, g, 0, 0, 0);
  // the eaves' fascia
  B.box(KMAT.wood, 2 * W, 0.12, 0.06, 0, y - 0.04, D);
  B.box(KMAT.wood, 2 * W, 0.12, 0.06, 0, y - 0.04, -D);
}

/** A gabled roof of sheets (corrugated: stripes down the slope) over w x d at height y. */
function sheetRoof(B, w, d, y, rise, m, over = 0.4) {
  const half = d / 2 + over, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  B.box(m, w + over * 2, 0.06, slope, 0, y + rise / 2, -half / 2, 0, -ang);
  B.box(m, w + over * 2, 0.06, slope, 0, y + rise / 2, half / 2, 0, ang);
}

/** Walls of a w x d room, h tall, with a door on the front (+z) and windows: plain boxes. */
function room(B, w, d, h, wall, { door = true, windows = 2, sideWindows = 1, shutter = KMAT.green } = {}) {
  B.box(wall, w, h, 0.22, 0, h / 2, -d / 2 + 0.11);
  B.box(wall, w, h, 0.22, 0, h / 2, d / 2 - 0.11);
  B.box(wall, 0.22, h, d, -w / 2 + 0.11, h / 2, 0);
  B.box(wall, 0.22, h, d, w / 2 - 0.11, h / 2, 0);
  if (door) B.box(KMAT.wood, 1.0, 2.1, 0.06, 0, 1.05, d / 2 + 0.01);
  for (let i = 0; i < windows; i++) {
    const x = (i - (windows - 1) / 2) * (w / (windows + 1)) * 1.6 + (windows === 1 ? w / 4 : 0);
    if (door && Math.abs(x) < 1) continue;
    B.box(KMAT.glass, 0.9, 1.0, 0.05, x, 1.55, d / 2 + 0.01);
    B.box(shutter, 0.42, 1.04, 0.04, x - 0.66, 1.55, d / 2 + 0.03);
    B.box(shutter, 0.42, 1.04, 0.04, x + 0.66, 1.55, d / 2 + 0.03);
  }
  for (let i = 0; i < sideWindows; i++) for (const s of [-1, 1]) B.box(KMAT.glass, 0.05, 1.0, 0.9, s * (w / 2 + 0.01), 1.55, (i - (sideWindows - 1) / 2) * 2.2);
}

/** A verandah along the front: a raised floor, pillars, and the roof carried over it. */
function verandah(B, w, z, depth, pillars, pillarMat = KMAT.wash) {
  B.box(KMAT.floor, w, 0.4, depth, 0, 0.2, z + depth / 2);
  B.box(KMAT.plinth, w + 0.1, 0.12, depth + 0.1, 0, 0.06, z + depth / 2);
  for (let i = 0; i < pillars; i++) {
    const x = (i / (pillars - 1) - 0.5) * (w - 0.4);
    B.box(pillarMat, 0.26, 2.5, 0.26, x, 1.65, z + depth - 0.2);
  }
}

function signTexture(text, bg = '#1f5a36', fg = '#f4efe2', w = 1024, h = 160) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
  x.fillStyle = fg; x.font = 'bold 62px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function sign(g, text, w, h, x, y, z, ry = 0, bg, fg) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(text, bg, fg), roughness: 0.8 }));
  m.position.set(x, y, z); m.rotation.y = ry;
  g.add(m);
  return m;
}

const WALLS = [KMAT.wash, KMAT.cream, KMAT.sky, KMAT.pink, KMAT.lemon];
const pick = (L, n) => Math.abs(Math.round(L.x * 13 + L.z * 7)) % n;

export const KERALA_BUILD = {
  // the forest station: whitewashed, a red tiled hip roof, a deep verandah, the department's green board
  station(B, L) {
    room(B, 10, 7, 3.2, KMAT.wash, { windows: 3, sideWindows: 2 });
    B.box(KMAT.plinth, 10.4, 0.45, 7.4, 0, 0.22, 0);
    verandah(B, 10, 3.5, 2.6, 5);
    hipRoof(B, 10, 7 + 2.6, 3.2, 2.4, KMAT.tile, 0.9);
    const g = B.build(L);
    sign(g, (L.sign || 'Forest Station').toUpperCase(), 6.2, 0.95, 0, 4.0, 3.5 + 2.6 + 0.96, 0);
    return g;
  },
  // the workshop: laterite block walls, an open front, a rusty sheet roof
  garage(B, L) {
    B.box(KMAT.laterite, 7.4, 3.6, 0.3, 0, 1.8, -3.1);
    B.box(KMAT.laterite, 0.3, 3.6, 6.2, -3.55, 1.8, 0); B.box(KMAT.laterite, 0.3, 3.6, 6.2, 3.55, 1.8, 0);
    B.box(KMAT.laterite, 1.2, 3.6, 0.3, -3.0, 1.8, 3.1); B.box(KMAT.laterite, 1.2, 3.6, 0.3, 3.0, 1.8, 3.1);
    B.box(KMAT.laterite, 7.4, 0.6, 0.3, 0, 3.3, 3.1);
    for (let y = 0.4; y < 3.6; y += 0.42) B.box(KMAT.plinth, 7.42, 0.03, 0.32, 0, y, -3.1);
    sheetRoof(B, 7.4, 6.6, 3.6, 1.0, KMAT.rust);
    B.box(KMAT.dark, 4.6, 2.9, 0.05, 0, 1.45, 2.95);
    const g = B.build(L);
    sign(g, 'WORKSHOP', 3.2, 0.5, 0, 3.25, 3.27, 0, '#d9a62a', '#1b1b1b');
    return g;
  },
  // the tea factory: three storeys of cream walls and rows of windows, a long sheet roof with vents along its ridge,
  // a loading bay, a tall brick chimney for the driers
  teafactory(B, L) {
    const w = 26, d = 12, h = 10.5;
    room(B, w, d, h, KMAT.cream, { door: false, windows: 0, sideWindows: 0 });
    for (let f = 0; f < 3; f++) for (let i = 0; i < 11; i++) for (const s of [-1, 1]) {
      const x = (i - 5) * 2.3, y = 1.8 + f * 3.3;
      B.box(KMAT.glass, 1.3, 1.5, 0.05, x, y, s * (d / 2 + 0.01));
      B.box(KMAT.white, 1.45, 0.1, 0.12, x, y - 0.8, s * (d / 2 + 0.04));
    }
    for (let f = 0; f < 3; f++) B.box(KMAT.green, w + 0.1, 0.18, d + 0.1, 0, 3.3 * (f + 1) - 0.1, 0);
    sheetRoof(B, w, d, h, 3.2, KMAT.green, 0.6);
    for (let i = 0; i < 6; i++) { B.box(KMAT.green, 1.6, 1.0, 1.6, (i - 2.5) * 4, h + 3.6, 0); B.box(KMAT.sheet, 2.0, 0.08, 2.0, (i - 2.5) * 4, h + 4.15, 0); }
    // the loading bay: a platform and a canopy
    B.box(KMAT.concrete, 9, 1.1, 3, -6, 0.55, d / 2 + 1.5);
    B.box(KMAT.dark, 3.2, 2.8, 0.06, -6, 2.5, d / 2 + 0.02);
    B.box(KMAT.sheet, 10, 0.08, 3.6, -6, 4.6, d / 2 + 1.7, 0, 0.12);
    for (const x of [-10.6, -1.4]) B.cyl(KMAT.steel, 0.06, 0.06, 3.6, x, 2.8, d / 2 + 3.3, 6);
    // the chimney
    B.cyl(KMAT.brick, 0.75, 0.95, 22, w / 2 + 2.2, 11, -2, 10);
    B.box(KMAT.brick, 2.4, 2.4, 2.4, w / 2 + 2.2, 1.2, -2);
    const g = B.build(L);
    sign(g, 'PONMALA TEA FACTORY', 11, 1.1, 4, h - 0.4, d / 2 + 0.06, 0);
    return g;
  },
  // the estate manager's bungalow: white, a steep tiled roof, a chimney, a verandah
  bungalow(B, L) {
    room(B, 11, 8, 3.4, KMAT.wash, { windows: 4, sideWindows: 2, shutter: KMAT.green });
    B.box(KMAT.plinth, 11.4, 0.6, 8.4, 0, 0.3, 0);
    verandah(B, 11, 4, 2.8, 6, KMAT.white);
    hipRoof(B, 11, 8 + 2.8, 3.4, 3.4, KMAT.tileOld, 0.8);
    B.box(KMAT.brick, 0.9, 3.0, 0.9, -3.4, 5.4, -1.6);
    return B.build(L);
  },
  // a village house: pastel walls, a red tiled hip roof, a sit-out verandah at the front
  house(B, L) {
    const wall = WALLS[pick(L, WALLS.length)];
    room(B, 8, 6, 3.0, wall, { windows: 2, sideWindows: 1, shutter: pick(L, 2) ? KMAT.blue : KMAT.green });
    B.box(KMAT.plinth, 8.3, 0.5, 6.3, 0, 0.25, 0);
    verandah(B, 6, 3, 2.0, 3, wall);
    hipRoof(B, 8, 6 + 1.2, 3.0, 2.2, pick(L, 3) ? KMAT.tile : KMAT.tileOld, 0.8);
    return B.build(L);
  },
  // the chai stall: a tin-roofed kiosk, its counter open, a bench and a bunch of bananas hung up
  chaistall(B, L) {
    B.box(KMAT.wood, 3.6, 1.0, 0.1, 0, 0.5, 1.4);
    B.box(KMAT.blue, 3.6, 2.3, 0.1, 0, 1.15, -1.4);
    B.box(KMAT.blue, 0.1, 2.3, 2.8, -1.8, 1.15, 0); B.box(KMAT.blue, 0.1, 2.3, 2.8, 1.8, 1.15, 0);
    B.box(KMAT.wood, 3.6, 0.08, 0.6, 0, 1.0, 1.2);
    for (const x of [-1.75, 1.75]) B.box(KMAT.wood, 0.1, 2.5, 0.1, x, 1.25, 1.4);
    B.box(KMAT.sheet, 4.6, 0.05, 4.2, 0, 2.62, 0.3, 0, 0.12);
    B.box(KMAT.wood, 2.4, 0.08, 0.5, 0, 0.45, 3.0);
    for (const x of [-1, 1]) B.box(KMAT.wood, 0.08, 0.45, 0.4, x, 0.22, 3.0);
    B.cyl(KMAT.banana, 0.14, 0.08, 0.5, 1.2, 1.9, 1.45, 7);
    B.cyl(KMAT.steel, 0.15, 0.15, 0.4, -0.8, 1.25, 1.2, 10);
    const g = B.build(L);
    sign(g, 'CHAI · KAAPI', 2.6, 0.42, 0, 2.35, 1.47, 0, '#c8321e', '#f9e9c0');
    return g;
  },
  // the bus shelter: a slab roof on four posts over a bench
  busstop(B, L) {
    for (const [x, z] of [[-1.8, -0.8], [1.8, -0.8], [-1.8, 0.8], [1.8, 0.8]]) B.box(KMAT.concrete, 0.18, 2.5, 0.18, x, 1.25, z);
    B.box(KMAT.concrete, 4.4, 0.14, 2.2, 0, 2.55, 0, 0, -0.08);
    B.box(KMAT.concrete, 3.4, 0.08, 0.5, 0, 0.48, -0.5);
    B.box(KMAT.concrete, 3.6, 1.2, 0.1, 0, 0.6, -0.85);
    return B.build(L);
  },
  // laterite blocks cut from the quarry, stacked to dry
  laterite(B, L) {
    for (let y = 0; y < 5; y++) for (let i = 0; i < 6 - (y >> 1); i++) for (let j = 0; j < 3; j++) {
      B.box(KMAT.laterite, 0.4, 0.2, 0.25, (i - 2.5) * 0.43 + (y % 2) * 0.1, 0.1 + y * 0.21, (j - 1) * 0.28);
    }
    return B.build(L);
  },
  // the viewpoint: a pavilion of four pillars under a tiled pyramid, a parapet round its platform
  lookout(B, L) {
    B.box(KMAT.concrete, 6, 0.5, 6, 0, 0.25, 0);
    for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]]) B.box(KMAT.wash, 0.3, 2.6, 0.3, x, 1.8, z);
    hipRoof(B, 5.2, 5.2, 3.1, 1.8, KMAT.tile, 0.5);
    for (const s of [-1, 1]) { B.box(KMAT.wash, 6, 0.8, 0.18, 0, 0.9, s * 2.9); B.box(KMAT.wash, 0.18, 0.8, 6, s * 2.9, 0.9, 0); }
    return B.build(L);
  },
};
