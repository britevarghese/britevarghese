// Locates playwright-core + the preinstalled Chromium and launches it with software GL.
import fs from 'node:fs';
const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).pathname,
  '/tmp/claude-0/-home-user-britevarghese/ea210266-c2f2-5d4e-bb96-a00562a842af/scratchpad/t/node_modules/playwright-core/index.mjs',
].filter(Boolean);
const found = CANDIDATES.find((p) => fs.existsSync(p));
if (!found) throw new Error('playwright-core not found: run `npm install` in NIGHTSHIFT or set PLAYWRIGHT_CORE');
export const PW = await import(found);
export function launch() {
  return PW.chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
}
