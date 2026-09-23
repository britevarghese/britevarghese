// In-game screenshot tour: node scripts/gameshot.mjs <outdir> [query] [steps.json]
// steps: [{ name, js (evaluated in page), wait }]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outdir, query = 'autojoin=1&autodeploy=1&q=medium', stepsFile] = process.argv.slice(2);
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [{ name: 'spawn', js: '', wait: 1500 }];
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:3000/?${query}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
for (const s of steps) {
  if (s.js) await page.evaluate(s.js);
  await page.waitForTimeout(s.wait ?? 1500);
  await page.screenshot({ path: `${outdir}/${s.name}.png`, timeout: 180000 });
  console.log('shot', s.name, await page.evaluate(() => document.getElementById('fps')?.textContent));
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
