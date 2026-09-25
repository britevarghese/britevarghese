// Motion-captured animations for the people: Quaternius' Universal Animation Library (CC0 1.0), retargeted
// onto the Ready Player Me skeleton the game's characters share (tools/import-humans.mjs).
//
//   node tools/import-anims.mjs --src "path/to/Universal Animation Library[Standard]"
//
// Retargeting: the two rigs have different rest poses (T-pose vs A-pose) and bone frames, so rotations
// can't be copied. For every frame, the tool poses the source skeleton, then turns each target bone so the
// segment it drives (hip->knee, knee->ankle, shoulder->elbow, ...) points the same way as in the source;
// the hips copy the source's rotation relative to its rest pose, and their height is scaled by leg length.
// The result is written as three.js AnimationClip JSON with clean bone names (Hips, LeftUpLeg, ...):
// public/assets/anims/people.json. Root motion is measured from the _RM variant to get each gait's speed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const SRC_DIR = args.includes('--src') ? args[args.indexOf('--src') + 1] : null;
if (!SRC_DIR) throw new Error('pass --src <Universal Animation Library[Standard] folder> (free download: https://quaternius.itch.io/universal-animation-library)');
const TARGET = path.join(ROOT, '.cache/humans/pmariano.glb'); // reference Ready Player Me avatar (tools/import-humans.mjs downloads it)
const FPS = 30;

// clips to bake: game name -> source clip, loop?
const CLIPS = {
  idle: ['Idle_Loop', true], talk: ['Idle_Talking_Loop', true], walk: ['Walk_Loop', true], jog: ['Jog_Fwd_Loop', true], sprint: ['Sprint_Loop', true],
  jumpStart: ['Jump_Start', false], jumpLoop: ['Jump_Loop', true], jumpLand: ['Jump_Land', false],
  interact: ['Interact', false], sitEnter: ['Sitting_Enter', false], sitExit: ['Sitting_Exit', false], sitIdle: ['Sitting_Idle_Loop', true],
  drive: ['Driving_Loop', true], hit: ['Hit_Chest', false], roll: ['Roll', false], death: ['Death01', false], push: ['Push_Loop', true],
};

// target (Ready Player Me) segment -> source (Unreal-style) segment: aim target bone at its child the way
// the source bone points at its child. Listed parents first.
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const SEGMENTS = [
  ['Spine', 'Spine1', 'spine_01', 'spine_02'], ['Spine1', 'Spine2', 'spine_02', 'spine_03'], ['Spine2', 'Neck', 'spine_03', 'neck_01'],
  ['Neck', 'Head', 'neck_01', 'Head'],
];
for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
  SEGMENTS.push(
    [`${S}Shoulder`, `${S}Arm`, `clavicle_${s}`, `upperarm_${s}`], [`${S}Arm`, `${S}ForeArm`, `upperarm_${s}`, `lowerarm_${s}`],
    [`${S}ForeArm`, `${S}Hand`, `lowerarm_${s}`, `hand_${s}`], [`${S}Hand`, `${S}HandMiddle1`, `hand_${s}`, `middle_01_${s}`],
    [`${S}UpLeg`, `${S}Leg`, `thigh_${s}`, `calf_${s}`], [`${S}Leg`, `${S}Foot`, `calf_${s}`, `foot_${s}`], [`${S}Foot`, `${S}ToeBase`, `foot_${s}`, `ball_${s}`],
  );
  for (const F of FINGERS) {
    const f = F.toLowerCase();
    for (let i = 1; i <= 3; i++) SEGMENTS.push([`${S}Hand${F}${i}`, `${S}Hand${F}${i + 1}`, `${f}_0${i}_${s}`, i < 3 ? `${f}_0${i + 1}_${s}` : `${f}_04_leaf_${s}`]);
  }
}
// standing clips whose leg spread is narrowed (x component of the leg directions)
const STANCE = { idle: 0.45, talk: 0.55 };
// bones whose own roll matters (no child direction to lean on): copy the source's rotation relative to rest
const DELTA = [['Head', 'Head']];

// ---------------------------------------------------------------- load both rigs in three.js (no textures in Node)
async function loadScene(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const m of doc.getRoot().listMaterials()) for (const ext of m.listExtensions()) m.setExtension(ext.constructor, null);
  const glb = await io.writeBinary(doc);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, '', resolve, reject));
}
const bonesOf = (scene) => { const B = {}; scene.traverse((o) => { if (o.isBone) B[o.name.replace(/_\d+$/, '')] ||= o; }); return B; };
const bonesExact = (scene) => { const B = {}; scene.traverse((o) => { if (o.isBone) B[o.name] = o; }); return B; };

const srcFile = path.join(SRC_DIR, 'Unreal-Godot/UAL1_Standard.glb');
const rmFile = path.join(SRC_DIR, 'Unreal-Godot/UAL1_Standard_RM.glb');
const src = await loadScene(srcFile), rm = await loadScene(rmFile), dst = await loadScene(TARGET);
const S = bonesExact(src.scene), D = bonesOf(dst.scene);
src.scene.updateMatrixWorld(true); dst.scene.updateMatrixWorld(true);

const wpos = (o, v = new THREE.Vector3()) => v.setFromMatrixPosition(o.matrixWorld);
const wquat = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
// rest data
const restLocal = new Map(); dst.scene.traverse((o) => { if (o.isBone) restLocal.set(o, o.quaternion.clone()); });
const hipsRestPos = D.Hips.position.clone();
const srcHipH = wpos(S.pelvis).y, dstHipH = wpos(D.Hips).y;
const legScale = dstHipH / srcHipH;
const srcRestQ = { pelvis: wquat(S.pelvis), Head: wquat(S.Head) };
const dstRestQ = { Hips: wquat(D.Hips), Head: wquat(D.Head) };
const srcRestHips = wpos(S.pelvis);

const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
function aim(bone, child, dir) {
  bone.updateWorldMatrix(true, false);
  _a.subVectors(wpos(child, _c), wpos(bone, _p)).normalize();
  _qd.setFromUnitVectors(_a, dir);
  wquat(bone, _q).premultiply(_qd);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q));
  bone.updateWorldMatrix(false, true);
}
function setWorldQuat(bone, q) {
  bone.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(q));
  bone.updateWorldMatrix(false, true);
}

const trackBones = [...new Set([...SEGMENTS.map((s) => s[0]), 'Hips', 'Head'])].filter((n) => D[n]);
const out = { source: { title: 'Universal Animation Library (Standard)', author: 'Quaternius', url: 'https://quaternius.itch.io/universal-animation-library', license: 'CC0-1.0' }, clips: {} };

for (const [name, [srcName, loop]] of Object.entries(CLIPS)) {
  const clip = src.animations.find((a) => a.name === srcName);
  if (!clip) { console.log(`${name}: source clip ${srcName} missing`); continue; }
  const mixer = new THREE.AnimationMixer(src.scene);
  const action = mixer.clipAction(clip); action.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
  const times = [], Q = Object.fromEntries(trackBones.map((n) => [n, []])), P = [];
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / FPS);
    mixer.setTime(t); src.scene.updateMatrixWorld(true);
    for (const [b, q] of restLocal) b.quaternion.copy(q);
    D.Hips.position.copy(hipsRestPos);
    dst.scene.updateMatrixWorld(true);
    // hips: height and sway scaled to the target's legs, rotation relative to rest
    const sp = wpos(S.pelvis, new THREE.Vector3());
    const want = new THREE.Vector3((sp.x - srcRestHips.x) * legScale, sp.y * legScale, (sp.z - srcRestHips.z) * legScale);
    const hipW = wpos(D.Hips, new THREE.Vector3());
    const local = D.Hips.parent.worldToLocal(new THREE.Vector3(hipW.x + want.x, want.y, hipW.z + want.z));
    D.Hips.position.copy(local);
    dst.scene.updateMatrixWorld(true);
    setWorldQuat(D.Hips, wquat(S.pelvis).multiply(srcRestQ.pelvis.clone().invert()).multiply(dstRestQ.Hips));
    // limbs and spine: direction matching
    const narrow = STANCE[name] ?? 1;
    for (const [dB, dC, sB, sC] of SEGMENTS) {
      if (!D[dB] || !D[dC] || !S[sB] || !S[sC]) continue;
      _b.subVectors(wpos(S[sC], _c), wpos(S[sB], _p));
      // the library's idles stand wide, like a fighter: bring the feet in under the hips
      if (narrow !== 1 && /UpLeg$|Leg$/.test(dB) && !/Foot/.test(dB)) _b.x *= narrow;
      _b.normalize();
      aim(D[dB], D[dC], _b.clone());
    }
    for (const [dB, sB] of DELTA) setWorldQuat(D[dB], wquat(S[sB]).multiply(srcRestQ[sB].clone().invert()).multiply(dstRestQ[dB]));
    times.push(+(f / FPS).toFixed(4));
    for (const n of trackBones) { const q = D[n].quaternion; Q[n].push(+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)); }
    P.push(+D.Hips.position.x.toFixed(4), +D.Hips.position.y.toFixed(4), +D.Hips.position.z.toFixed(4));
  }
  // gait speed from the root-motion variant: metres per second of forward travel
  let speed = 0;
  const rc = rm.animations.find((a) => a.name === srcName);
  const rt = rc?.tracks.find((tr) => tr.name === 'root.position');
  if (rt) { const v = rt.values; speed = Math.hypot(v[v.length - 3] - v[0], v[v.length - 1] - v[2]) / rc.duration * legScale; }
  out.clips[name] = { duration: +clip.duration.toFixed(4), loop, speed: +speed.toFixed(3), times, hips: P, bones: Q };
  console.log(`${name.padEnd(10)} ${srcName.padEnd(18)} ${clip.duration.toFixed(2)} s ${frames} frames${speed ? `, ${speed.toFixed(2)} m/s` : ''}`);
}
const outDir = path.join(ROOT, 'public/assets/anims');
fs.mkdirSync(outDir, { recursive: true });
out.hipsRest = hipsRestPos.toArray().map((v) => +v.toFixed(4));
fs.writeFileSync(path.join(outDir, 'people.json'), JSON.stringify(out));
fs.writeFileSync(path.join(outDir, 'CREDITS.md'), '# Animation credits\n\nMotion-captured animations: "Universal Animation Library" by Quaternius, https://quaternius.itch.io/universal-animation-library (CC0 1.0, public domain). Retargeted to the Ready Player Me skeleton by tools/import-anims.mjs.\n');
console.log(`wrote public/assets/anims/people.json ${(fs.statSync(path.join(outDir, 'people.json')).size / 1048576).toFixed(2)} MB`);
