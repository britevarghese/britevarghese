// Builds the recorded-sound assets: fetch + trim (fetch_trim.py), decode the trimmed engines with Chromium's
// decoder (the same one the game uses) into .cache/sounds/<name>.f32, analyse them (analyze.py -> engine
// JSON for the granular engine), and write public/assets/audio/sfx/clips.json from sources.json.
// Usage (from NIGHTSHIFT): node tools/sounds/build.mjs   (needs python3 with numpy + scipy)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from '../dev/pw.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sounds/sources.json'), 'utf8'));
const CACHE = path.join(ROOT, '.cache/sounds');
const AUDIO = path.join(ROOT, 'public/assets/audio');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

if (!process.argv.includes('--no-fetch')) run('python3', ['tools/sounds/fetch_trim.py']);

const b = await launch();
const page = await b.newPage();
await page.setContent('<html></html>');
for (const e of SRC.engines) {
  const out = path.join(CACHE, e.name + '.f32');
  const mp3 = path.join(AUDIO, 'engines', e.name + '.mp3');
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(mp3).mtimeMs) continue;
  const r = await page.evaluate(async (b64) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(u.buffer);
    const n = buf.length, ch = buf.numberOfChannels, m = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / ch; }
    let s = ''; const u8 = new Uint8Array(m.buffer);
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return { sr: buf.sampleRate, n, b64: btoa(s) };
  }, fs.readFileSync(mp3).toString('base64'));
  fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
  fs.writeFileSync(out + '.json', JSON.stringify({ sr: r.sr, n: r.n }));
  console.log('decoded', e.name, (r.n / r.sr).toFixed(1) + 's');
}
await b.close();

run('python3', ['tools/sounds/analyze.py', ...(process.argv.includes('--plots') ? ['--plots'] : [])]);

// SFX clip table: bank -> [[file, start, end], ...]
const banks = {};
for (const s of SRC.sfx) for (const [bank, list] of Object.entries(s.clips)) for (const [a, z] of list) (banks[bank] ||= []).push([`${s.id}.mp3`, a, z]);
fs.writeFileSync(path.join(AUDIO, 'sfx/clips.json'), JSON.stringify(banks));
fs.writeFileSync(path.join(AUDIO, 'engines/cars.json'), JSON.stringify(SRC.cars));
console.log('clips:', Object.entries(banks).map(([k, v]) => `${k}:${v.length}`).join(' '));
