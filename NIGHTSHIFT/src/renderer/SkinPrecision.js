// Skinned characters far from the world origin: the Kerala map's coordinates run to hundreds of kilometres,
// and three.js skins in world space on the GPU, where float32 near 1e5 m resolves only ~1 cm. Fingers, faces
// and cuffs (a few cm across) were torn into spikes. Here the bone matrices are taken relative to a nearby
// origin (the camera's, set each frame) and every skinned mesh's inverse bind matrix to match: the same
// skinned positions, computed on the GPU with small numbers. Import once, before anything renders.
import * as THREE from 'three';

/** The origin skinning is computed about: keep it near the camera (Game sets it every frame). */
export const SKIN_ORIGIN = new THREE.Vector3();

const _off = new THREE.Matrix4(), _m = new THREE.Matrix4(), _id = new THREE.Matrix4();
const toOrigin = () => _off.makeTranslation(-SKIN_ORIGIN.x, -SKIN_ORIGIN.y, -SKIN_ORIGIN.z);

THREE.Skeleton.prototype.update = function () {
  const { bones, boneInverses, boneMatrices, boneTexture } = this;
  toOrigin();
  for (let i = 0, n = bones.length; i < n; i++) {
    _m.multiplyMatrices(bones[i] ? bones[i].matrixWorld : _id, boneInverses[i]).premultiply(_off);
    _m.toArray(boneMatrices, i * 16);
  }
  if (boneTexture !== null) boneTexture.needsUpdate = true;
};

const updateMatrixWorld = THREE.SkinnedMesh.prototype.updateMatrixWorld;
THREE.SkinnedMesh.prototype.updateMatrixWorld = function (force) {
  updateMatrixWorld.call(this, force);
  (this._bindInvPlain ||= new THREE.Matrix4()).copy(this.bindMatrixInverse); // (three's own, for the CPU below)
  // attached: (origin offset x world)^-1; detached: the bind inverse, undoing the origin offset first
  toOrigin();
  if (this.bindMode === THREE.AttachedBindMode) this.bindMatrixInverse.multiplyMatrices(_off, this.matrixWorld).invert();
  else if (this.bindMode === THREE.DetachedBindMode) this.bindMatrixInverse.copy(this.bindMatrix).invert().multiply(_off.invert());
};

// skinned vertices on the CPU (bounds, raycasts, baked figures) sum the bones' world matrices themselves, in
// float64: they keep three's own inverse bind matrix
const applyBoneTransform = THREE.SkinnedMesh.prototype.applyBoneTransform, _keep = new THREE.Matrix4();
THREE.SkinnedMesh.prototype.applyBoneTransform = function (index, target) {
  if (!this._bindInvPlain) return applyBoneTransform.call(this, index, target);
  _keep.copy(this.bindMatrixInverse); this.bindMatrixInverse.copy(this._bindInvPlain);
  applyBoneTransform.call(this, index, target);
  this.bindMatrixInverse.copy(_keep);
  return target;
};
