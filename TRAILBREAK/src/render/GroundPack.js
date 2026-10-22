// The ground textures' pixels packed for the terrain's texture arrays (render/Ground.js): colour with the height in
// alpha, and the normal's x and y, a layer for each kind of ground. In a worker where the browser can
// (render/groundWorker.js: the pictures decoded and read off the main thread), else on the page. (No three.js here:
// a worker has no import map.)

/** The pixels of an image at a size (a region of it with src = [x, y, w, h]). */
async function pixels(blob, w, h, src) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  if (src) x.drawImage(bmp, src[0], src[1], src[2], src[3], 0, 0, w, h); else x.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return x.getImageData(0, 0, w, h).data;
}

/**
 * A map's ground layers packed: { manifest, CS, DS, color (CS x CS x 4 a layer), normal (DS x DS x 2 a layer) }.
 * base: the ground folder's URL. quality 'low' halves the colour resolution (512 instead of 1024).
 */
export async function packGround(base, map, quality) {
  const manifest = await fetch(`${base}${map}.json`).then((r) => { if (!r.ok) throw new Error(`ground ${map}: ${r.status}`); return r.json(); });
  const L = manifest.layers.length;
  const CS = quality === 'low' ? 512 : 1024, DS = 512;
  const color = new Uint8Array(CS * CS * 4 * L), normal = new Uint8Array(DS * DS * 2 * L);
  await Promise.all(manifest.layers.map(async (layer, li) => {
    const [cb, db] = await Promise.all([fetch(base + layer.color).then((r) => r.blob()), fetch(base + layer.data).then((r) => r.blob())]);
    const [c, h, n] = await Promise.all([
      pixels(cb, CS, CS),
      pixels(db, CS, CS, [1024, 0, 512, 512]),           // the height panel, at the colour's size
      pixels(db, DS * 2, DS, [0, 0, 1024, 512]),          // the normal's x and y panels
    ]);
    // rows bottom-up, so texture v runs up the picture (the normal maps' +y)
    const co = li * CS * CS * 4, no = li * DS * DS * 2;
    for (let r = 0; r < CS; r++) {
      const src = (CS - 1 - r) * CS * 4, dst = co + r * CS * 4;
      for (let i = 0; i < CS; i++) {
        const s = src + i * 4, d = dst + i * 4;
        color[d] = c[s]; color[d + 1] = c[s + 1]; color[d + 2] = c[s + 2]; color[d + 3] = h[s];
      }
    }
    for (let r = 0; r < DS; r++) {
      const src = (DS - 1 - r) * DS * 2 * 4, dst = no + r * DS * 2;
      for (let i = 0; i < DS; i++) {
        normal[dst + i * 2] = n[src + i * 4];
        normal[dst + i * 2 + 1] = n[src + (DS + i) * 4];
      }
    }
  }));
  return { manifest, CS, DS, color, normal };
}
