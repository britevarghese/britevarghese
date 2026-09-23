// Headless screenshot helper: node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h]
import { chromium } from 'playwright-core';
const [url, out, wait = '4000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
try { await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 }); } catch {}
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const info = await page.evaluate(() => document.getElementById('info')?.innerText || '');
console.log(info.slice(0, 3000));
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
