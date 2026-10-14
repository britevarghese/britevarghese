// Things the crew carry: Kathakali masks (the painted papier-mache kind every souvenir shop on a Kerala beach
// sells), a pistol, a bag for the cash. And the poses people take when a gun comes out: hands up, hands on the head.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

// ------------------------------------------------------------------------------------------------ masks
// Kathakali faces: pacha (green: the hero), kathi (green with red: the proud villain), minukku (warm yellow: the gentle
// characters). A white chutti (the paper frame round the jaw), red-rimmed eyes drawn out to the temples, red lips
const FACES = {
  pacha: { face: '#2f8a3c', lip: '#d8202a', brow: '#141414', mark: '#e8b830' },
  kathi: { face: '#2a7a34', lip: '#c81c24', brow: '#121212', mark: '#d02820', cheek: '#c83020' },
  minukku: { face: '#e8a85c', lip: '#c8302c', brow: '#1a1010', mark: '#c82a5a' },
};
const texCache = {};
function maskTexture(style) {
  if (texCache[style]) return texCache[style];
  const F = FACES[style] || FACES.pacha;
  const W = 256, H = 320, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  // the face
  x.fillStyle = F.face; x.fillRect(0, 0, W, H);
  // papier-mache: a little uneven
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; x.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  // the forehead band and the crown's gold edge
  x.fillStyle = '#1a1410'; x.fillRect(0, 0, W, 34);
  x.fillStyle = '#d8a83a'; x.fillRect(0, 30, W, 10);
  for (let k = 0; k < 16; k++) { x.fillStyle = k % 2 ? '#b02020' : '#f0e0a0'; x.beginPath(); x.arc(8 + k * 16, 35, 4, 0, Math.PI * 2); x.fill(); }
  // the mark on the forehead
  x.fillStyle = F.mark; x.beginPath(); x.ellipse(W / 2, 74, 7, 18, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f4f0e0'; x.beginPath(); x.ellipse(W / 2, 74, 3, 9, 0, 0, Math.PI * 2); x.fill();
  // eyebrows: thick black arcs
  x.strokeStyle = F.brow; x.lineWidth = 9; x.lineCap = 'round';
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(W / 2 + s * 18, 104); x.quadraticCurveTo(W / 2 + s * 52, 82, W / 2 + s * 92, 102); x.stroke(); }
  // the eyes: white, red rims, black lines drawn out to the temples, dark pupils looking sideways
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * 50, cy = 126;
    x.fillStyle = '#f6f2e8'; x.beginPath(); x.ellipse(cx, cy, 26, 11, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#c42028'; x.lineWidth = 3; x.stroke();
    x.strokeStyle = '#101010'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx - s * 26, cy); x.quadraticCurveTo(cx, cy - 16, cx + s * 44, cy - 10); x.stroke();
    x.beginPath(); x.moveTo(cx - s * 24, cy + 4); x.quadraticCurveTo(cx, cy + 14, cx + s * 40, cy - 4); x.stroke();
    x.fillStyle = '#1a0a08'; x.beginPath(); x.arc(cx + s * 9, cy, 6, 0, Math.PI * 2); x.fill();
  }
  // nose: a pale line and the nostrils
  x.strokeStyle = 'rgba(250,240,200,0.8)'; x.lineWidth = 5; x.beginPath(); x.moveTo(W / 2, 140); x.lineTo(W / 2, 182); x.stroke();
  x.fillStyle = '#1a1010'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(W / 2 + s * 9, 188, 5, 3, 0, 0, Math.PI * 2); x.fill(); }
  // the villain's red on the cheeks (kathi), a curled moustache
  if (F.cheek) {
    x.fillStyle = F.cheek; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(W / 2 + s * 66, 172, 24, 14, s * 0.3, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = '#141010'; x.lineWidth = 6; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(W / 2, 200); x.quadraticCurveTo(W / 2 + s * 40, 206, W / 2 + s * 48, 188); x.stroke(); }
  }
  // lips: bright red, a slight smile
  x.fillStyle = F.lip; x.beginPath(); x.moveTo(W / 2 - 30, 214); x.quadraticCurveTo(W / 2, 200, W / 2 + 30, 214); x.quadraticCurveTo(W / 2, 236, W / 2 - 30, 214); x.fill();
  x.strokeStyle = '#5a0808'; x.lineWidth = 2; x.beginPath(); x.moveTo(W / 2 - 28, 214); x.quadraticCurveTo(W / 2, 220, W / 2 + 28, 214); x.stroke();
  // the chutti: a thick white frame round the jaw from temple to temple, ridged
  x.fillStyle = '#f6f2e6';
  x.beginPath(); x.moveTo(0, 150); x.quadraticCurveTo(10, 300, W / 2, H + 10); x.quadraticCurveTo(W - 10, 300, W, 150); x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(160,150,130,0.7)'; x.lineWidth = 2;
  for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(0, 168 + k * 12); x.quadraticCurveTo(14, 304 + k * 6, W / 2, H - 6 + k * 4); x.quadraticCurveTo(W - 14, 304 + k * 6, W, 168 + k * 12); x.stroke(); }
  // a red edge between the face and the chutti
  x.strokeStyle = '#c42028'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, 150); x.quadraticCurveTo(10, 300, W / 2, H + 10); x.quadraticCurveTo(W - 10, 300, W, 150); x.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (texCache[style] = t);
}

// a mask: a shell over the face (a slice of an egg shape), its centre at the middle of the head, looking down +Z
export function kathakaliMask(style = 'pacha') {
  const g = new THREE.SphereGeometry(0.118, 28, 20, Math.PI / 2 - 1.15, 2.3, 0.3, 2.35);
  g.scale(1.0, 1.22, 1.05);
  // (the texture runs across the slice: flip it so the forehead is up and the face reads left to right)
  const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, 1 - U.getX(i), U.getY(i));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: maskTexture(style), roughness: 0.55, metalness: 0.0 }));
  m.castShadow = true;
  // (the inside: bare papier-mache, what shows round the head from behind)
  const back = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95, side: THREE.BackSide }));
  const grp = new THREE.Group(); grp.add(m, back); grp.name = 'mask';
  return grp;
}

// the face's forward and up axes in a head bone's own frame, from the rest pose (the character faces +Z)
export function headAxes(human) {
  const B = human.B, head = B.Head;
  if (!head) return null;
  const q = new THREE.Quaternion();
  for (let o = head; o && o !== human.group; o = o.parent) q.premultiply(o.isBone && o.userData.rest ? o.userData.rest : o.quaternion);
  q.invert();
  return { face: new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize(), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize() };
}

// put a mask on: parented to the head bone, its centre ~9 cm up the skull, facing forward (sizes kept in metres
// whatever the model's own scale)
export function wearMask(human, style) {
  const B = human.B, head = B.Head;
  if (!head) return null;
  const ax = headAxes(human), m = kathakaliMask(style);
  human.group.updateMatrixWorld(true);
  const sc = head.getWorldScale(_a), s = 1 / Math.max(1e-4, (sc.x + sc.y + sc.z) / 3);
  // the head's own size: the top of the head above the head bone (a model's head-top bone, or ~0.18 m)
  const top = B.HeadTop_End ? B.HeadTop_End.getWorldPosition(_b).distanceTo(head.getWorldPosition(_c)) : 0.18;
  const k = Math.min(1.25, Math.max(0.85, top / 0.19));
  m.position.copy(ax.up).multiplyScalar(0.095 * k * s).addScaledVector(ax.face, 0.012 * s);
  // rotate the mask's +Z onto the face axis, its +Y onto the head's up
  const mtx = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(ax.up, ax.face).normalize(), ax.up, ax.face);
  m.quaternion.setFromRotationMatrix(mtx);
  m.scale.setScalar(s * k);
  head.add(m);
  return m;
}

// ------------------------------------------------------------------------------------------------ the gun, the bag
export function makeGun() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.42, metalness: 0.75 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8, metalness: 0.1 });
  const gun = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.032, 0.19), steel); slide.position.set(0, 0.022, 0.045); gun.add(slide);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.018, 0.15), steel); frame.position.set(0, -0.002, 0.03); gun.add(frame);
  const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.029, 0.1, 0.045), grip); g2.position.set(0, -0.05, -0.025); g2.rotation.x = 0.28; gun.add(g2);
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return gun;
}

// a dark canvas holdall with two handles
export function makeBag(color = 0x1c2230) {
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.36, 4, 10).rotateZ(Math.PI / 2), cloth);
  body.scale.set(1, 1, 0.82); body.position.y = -0.24; g.add(body);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 4, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.8 }));
  strap.position.y = -0.1; g.add(strap);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.4 }));
  zip.position.y = -0.095; g.add(zip);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------------------------------------ poses
// on top of the animated pose (after animate), blended in by w: hands raised either side of the head, palms out
export function handsUp(human, ik, w) {
  const B = human.B;
  if (!B.LeftArm || !B.RightArm || w <= 0.01) return;
  const g = human.group, up = _a.set(0, 1, 0), fwd = g.getWorldDirection(_b);
  for (const side of [1, -1]) {
    const sh = (side > 0 ? B.LeftArm : B.RightArm).getWorldPosition(new THREE.Vector3());
    const out = _c.copy(fwd).cross(up).multiplyScalar(-side);   // (+side = the character's left)
    const hand = sh.clone().addScaledVector(up, 0.42).addScaledVector(fwd, 0.08).addScaledVector(out, 0.14);
    ik.arm(side, hand, out.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize(), w);
  }
}
// hands clasped on the back of the head (down on the floor, as told)
export function handsOnHead(human, ik, w) {
  const B = human.B;
  if (!B.LeftArm || !B.RightArm || !B.Head || w <= 0.01) return;
  const g = human.group, up = _a.set(0, 1, 0), fwd = g.getWorldDirection(_b);
  const head = B.Head.getWorldPosition(new THREE.Vector3());
  for (const side of [1, -1]) {
    const out = _c.copy(fwd).cross(up).multiplyScalar(-side);
    const hand = head.clone().addScaledVector(up, 0.1).addScaledVector(fwd, -0.07).addScaledVector(out, 0.05);
    ik.arm(side, hand, out.clone().addScaledVector(fwd, 0.5).normalize(), w);
  }
}
void _q;
