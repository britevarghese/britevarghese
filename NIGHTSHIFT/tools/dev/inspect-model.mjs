// Prints the node tree, triangle counts, materials and textures of a glTF/GLB (import debugging).
//   node tools/dev/inspect-model.mjs path/to/model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('extensions', root.listExtensionsUsed().map((e) => e.extensionName).join(','));
const scene = root.listScenes()[0];
const b = getBounds(scene);
console.log('scene bounds', b.min.map((v) => v.toFixed(2)), b.max.map((v) => v.toFixed(2)));
let tris = 0;
const walk = (n, d) => {
  const m = n.getMesh();
  let info = '';
  if (m) { const nb = getBounds(n); let t = 0; for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } tris += t; info = ` mesh=${m.getName()} prims=${m.listPrimitives().length} tris=${t} mats=[${m.listPrimitives().map((p) => p.getMaterial()?.getName()).join(',')}] c=(${nb.min.map((v, k) => ((v + nb.max[k]) / 2).toFixed(2))}) size=(${nb.max.map((v, k) => (v - nb.min[k]).toFixed(2))})`; }
  if (d < 6) console.log('  '.repeat(d) + (n.getName() || '(node)') + (n.getSkin() ? ' SKIN' : '') + info);
  for (const c of n.listChildren()) walk(c, d + 1);
};
for (const n of scene.listChildren()) walk(n, 0);
console.log('total tris', tris);
for (const m of root.listMaterials()) console.log('mat', m.getName(), 'base', m.getBaseColorFactor().map((v) => v.toFixed(2)).join(','), 'tex', !!m.getBaseColorTexture(), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'alpha', m.getAlphaMode(), 'ext', m.listExtensions().map((e) => e.extensionName).join(','));
console.log('textures', root.listTextures().map((t) => `${t.getName() || t.getURI()} ${t.getMimeType()} ${t.getSize()?.join('x')}`).join(' | '));
console.log('animations', root.listAnimations().length, 'skins', root.listSkins().length);
