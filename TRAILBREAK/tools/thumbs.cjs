// The showroom's cards: a picture of each car in the showroom (ui/ShowroomStage.js), from the front three-quarters,
// in a colour it's known in. Needs playwright-core and a Chromium (WebGL); the game served (node server.js):
//   node tools/thumbs.cjs <baseUrl> <chromium> [id...]     -> public/assets/thumbs/<id>.webp
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const PAINT = {
  m4csl: '#5d6166', amggt: '#d6bf2a', c8: '#b8191b', huracan: '#e8711c', r8: '#1d4fbf', m3e30: '#e6e4dc', nsx: '#a80f19', p930: '#161616',
  r34: '#2a4fb2', r35: '#d8dadc', rx7: '#b81a1a', senna: '#d0471b', sti: '#1f3e8c', supra: '#c7c9cb', gclass: '#1d1d1e',
  thar: '#b5532c', roxx: '#e6e6e2', wrangler: '#2d6a3e', shepherd: '#55625f', bronco: '#2b5f8a', hummer: '#9a8a63', hummerev: '#e2e2df', cybertruck: '#b8bcc1', mule: '#4f5a34',
  ranger: '#3f5a3a', bruiser: '#a81c1c', hauler: '#2f3b54', trekker: '#3b4046', gecko: '#c2ae66', drover: '#8a8d91', rhino: '#d29f24', u8: '#2f4a5c',
};
(async () => {
  const [base, exe, ...only] = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(PAINT);
  const out = path.join(__dirname, '..', 'public', 'assets', 'thumbs');
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base);
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { GaragePreview } = await import('/src/ui/GaragePreview.js');
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;z-index:99';
    document.body.appendChild(c);
    window.__thumb = new GaragePreview(c, { showroom: true });
  });
  for (const id of ids) {
    const url = await page.evaluate(async ([id, paint]) => {
      const { truckSpec } = await import('/src/physics/trucks.js');
      const { loadTruckAsset } = await import('/src/render/TruckAssets.js');
      await loadTruckAsset(id);
      const p = window.__thumb;
      p.show(truckSpec(id), paint); p.fit();
      p.spin = false; p.yaw = 0.72; p.pitch = 0.12; p.dirty = true;
      p.frame(0);
      return p.canvas.toDataURL('image/webp', 0.86);
    }, [id, PAINT[id]]);
    fs.writeFileSync(path.join(out, `${id}.webp`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(id, Math.round(url.length * 0.75 / 1024), 'KB');
  }
  await browser.close();
})();
