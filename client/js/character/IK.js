// Analytic two-bone IK (shoulder-elbow-hand, hip-knee-foot) operating on real skeleton bones in world space.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _axis = new THREE.Vector3();

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// Rotate a bone by a world-space rotation delta (pre-multiplied), keeping hierarchy consistent.
export function rotateBoneWorld(bone, deltaWorld) {
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(deltaWorld);
  setBoneWorldQuaternion(bone, _q2);
}

export function setBoneWorldQuaternion(bone, qWorld) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}

/**
 * Solve so `end` reaches `target`. `pole` is a world point the middle joint should bend toward.
 * weight blends between animated pose (0) and full IK (1).
 */
export function solveTwoBone(upper, lower, end, target, pole, weight = 1) {
  if (weight <= 0) return;
  upper.updateMatrixWorld(true);
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  _t.copy(target);
  if (weight < 1) _t.lerpVectors(_c, target, weight);
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c);
  const lat = Math.max(0.01, Math.min(_a.distanceTo(_t), (lab + lcb) * 0.9995));

  // 1) set the elbow/knee angle
  const ac_ab_0 = Math.acos(clamp1(_v1.subVectors(_c, _a).normalize().dot(_v2.subVectors(_b, _a).normalize())));
  const ba_bc_0 = Math.acos(clamp1(_v1.subVectors(_a, _b).normalize().dot(_v2.subVectors(_c, _b).normalize())));
  const ac_ab_1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const ba_bc_1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  // bend axis: plane containing the chain and the pole
  // bend in the plane of the current (animated) pose so joints never hyper-extend; the pole twist comes after.
  _v1.subVectors(_c, _a);
  _axis.crossVectors(_v1, _v2.subVectors(_b, _a));
  if (_axis.lengthSq() < 1e-8) _axis.crossVectors(_v1, _v2.subVectors(pole, _a));
  if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
  _axis.normalize();
  rotateBoneWorld(upper, _q.setFromAxisAngle(_axis, ac_ab_1 - ac_ab_0));
  rotateBoneWorld(lower, _q.setFromAxisAngle(_axis, ba_bc_1 - ba_bc_0));

  // 2) swing the whole chain onto the target
  upper.getWorldPosition(_a); end.getWorldPosition(_c);
  _v1.subVectors(_c, _a).normalize(); _v2.subVectors(_t, _a).normalize();
  _q.setFromUnitVectors(_v1, _v2);
  rotateBoneWorld(upper, _q);

  // 3) twist around the shoulder->target axis so the mid joint points at the pole
  upper.getWorldPosition(_a); lower.getWorldPosition(_b);
  const axis = _v1.subVectors(_t, _a).normalize();
  const bProj = _v2.subVectors(_b, _a); bProj.addScaledVector(axis, -bProj.dot(axis));
  const pProj = _c.subVectors(pole, _a); pProj.addScaledVector(axis, -pProj.dot(axis));
  if (bProj.lengthSq() > 1e-8 && pProj.lengthSq() > 1e-8) {
    bProj.normalize(); pProj.normalize();
    let ang = Math.acos(clamp1(bProj.dot(pProj)));
    if (_axis.crossVectors(bProj, pProj).dot(axis) < 0) ang = -ang;
    rotateBoneWorld(upper, _q.setFromAxisAngle(axis, ang));
  }
}

// Build the world rotation that maps local basis (f, n) of a bone onto world directions (F, N).
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
export function basisQuaternion(fLocal, nLocal, fWorld, nWorld, out = new THREE.Quaternion()) {
  const f1 = fLocal.clone().normalize(), n1 = nLocal.clone().addScaledVector(f1, -nLocal.dot(f1)).normalize(), s1 = new THREE.Vector3().crossVectors(f1, n1);
  const f2 = fWorld.clone().normalize(), n2 = nWorld.clone().addScaledVector(f2, -nWorld.dot(f2)).normalize(), s2 = new THREE.Vector3().crossVectors(f2, n2);
  _m1.makeBasis(f1, n1, s1); _m2.makeBasis(f2, n2, s2);
  _m2.multiply(_m1.transpose());
  return out.setFromRotationMatrix(_m2);
}
