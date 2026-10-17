// The driver's models (public/assets/driver/, CC BY 4.0, see its CREDITS.md): a man ("indian man" by madmak21199, an
// Avaturn avatar) to sit at the wheel, and gloved arms in jacket sleeves ("Hand With Gloves" by
// teenjust500) for the cab view. Converted for NIGHTSHIFT: compressed with meshoptimizer (its decoder is in
// vendor/three/addons/libs), WebP textures. Loaded once (render/Person.js poses a copy in each truck); until they are
// here, or if they can't be had, the trucks keep the drawn driver (render/Driver.js).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// (named by their content: the server lets the browser keep a versioned file for good)
const FILES = { man: 'man.glb?v=3af4681b55', arms: 'arms.glb?v=07fe139a3c' };

let loading = null, loaded = null;

/** The loaded models { man, arms } (scenes to clone), or null. */
export const driverAssets = () => loaded;

/** Load the driver's models (resolves null when they can't be had). */
export function loadDriverAssets(base = '/assets/driver/') {
  if (!loading) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const names = Object.keys(FILES);
    loading = Promise.all(names.map((k) => loader.loadAsync(base + FILES[k])))
      .then((gl) => {
        // (every truck's driver shares these: TruckModel.dispose leaves them)
        for (const g of gl) g.scene.traverse((o) => { if (o.geometry) o.geometry.userData.cached = true; });
        return (loaded = Object.fromEntries(names.map((k, i) => [k, gl[i].scene])));
      })
      .catch((e) => { console.warn('driver models:', e); loading = null; return null; });
  }
  return loading;
}
