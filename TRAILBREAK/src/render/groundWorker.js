// A map's ground textures packed off the main thread (render/Ground.js, render/GroundPack.js): { base, map, quality }
// in; the packed arrays out (handed over, not copied).
import { packGround } from './GroundPack.js';

self.onmessage = async ({ data: { base, map, quality } }) => {
  try {
    const p = await packGround(base, map, quality);
    self.postMessage(p, [p.color.buffer, p.normal.buffer]);
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
