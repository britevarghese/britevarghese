// The engine voice (audio/engine-worklet.js), run offline on a real bank: its note is where the revs say (the firings
// come at the engine's own rate), steady revs hold a steady note, and a quick stab of throttle doesn't click.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SR = 48000, BLOCK = 128;
const root = new URL('..', import.meta.url).pathname;

function worklet() {
  let Proc = null;
  const ctx = {
    sampleRate: SR, Math, Float32Array, Int32Array, Uint8Array, Uint16Array,
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} }; } },
    registerProcessor: (n, c) => { Proc = c; },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(root + 'src/audio/engine-worklet.js', 'utf8'), ctx);
  return Proc;
}

function bank(name) {
  const base = root + 'public/assets/audio/engines/';
  const meta = JSON.parse(fs.readFileSync(base + name + '.grains.json', 'utf8'));
  const wav = fs.readFileSync(base + name + '.grains.wav'), v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let p = 12, data = null;
  while (p + 8 <= wav.byteLength) {
    const id = wav.toString('ascii', p, p + 4), len = v.getUint32(p + 4, true);
    if (id === 'data') { data = new Float32Array(len >> 1); for (let i = 0; i < data.length; i++) data[i] = v.getInt16(p + 8 + i * 2, true) / 32768; break; }
    p += 8 + len + (len & 1);
  }
  const arr = (b64, T) => { const u = Buffer.from(b64, 'base64'); return new T(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); };
  return { data, sr: meta.sr, cyl: meta.cyl, engineCyl: meta.engineCyl || meta.cyl, idleRpm: meta.idleRpm, pos: arr(meta.pos, Int32Array),
    r: arr(meta.r, Float32Array), g: arr(meta.g, Float32Array), cls: arr(meta.cls, Uint8Array), run: arr(meta.run, Uint16Array) };
}

/** Render: at(t) -> { rpm, load } for `seconds`. */
function render(Proc, B, cfg, at, seconds) {
  const proc = new Proc({ processorOptions: { bank: B, config: cfg } });
  const out = new Float32Array(Math.floor(seconds * SR / BLOCK) * BLOCK);
  for (let n = 0; n < out.length; n += BLOCK) {
    const { rpm, load } = at(n / SR), o = new Float32Array(BLOCK);
    proc.process([], [[o]], { rpm: [rpm], load: [load], gain: [1] });
    out.set(o, n);
  }
  return out;
}

/** The strongest period (Hz) within 30% of `f` in x[a, a + len), and how clear it is (0..1). */
function heard(x, a, len, f) {
  const P = SR / f, lo = Math.floor(P / 1.3), hi = Math.ceil(P * 1.3);
  let e0 = 0;
  for (let i = a; i < a + len; i++) e0 += x[i] * x[i];
  let best = 0, bj = lo;
  for (let j = lo; j <= hi; j++) {
    let s = 0;
    for (let i = a; i < a + len; i++) s += x[i] * x[i + j];
    if (s > best) { best = s; bj = j; }
  }
  return { f: SR / bj, clear: best / (e0 || 1) };
}

const Proc = worklet();

for (const [name, cyl, idle] of [['d4', 4, 800], ['v8', 8, 650]]) {
  test(`${name}: the note follows the revs, a steady note at steady revs`, () => {
    const B = bank(name), cfg = { idle, cyl };
    for (const rpm of [idle * 1.2, 2000, 3500]) {
      const x = render(Proc, B, cfg, () => ({ rpm, load: 1 }), 1.2);
      const want = rpm * cyl / 120;
      for (const t of [0.5, 0.8]) {
        const h = heard(x, Math.floor(t * SR), Math.floor(0.2 * SR), want);
        assert.ok(Math.abs(h.f / want - 1) < 0.03, `${rpm} rpm at ${t} s: ${h.f.toFixed(1)} Hz heard, ${want.toFixed(1)} wanted`);
        assert.ok(h.clear > 0.25, `${rpm} rpm: no clear note (${h.clear.toFixed(2)})`);
      }
    }
  });
}

test('a stab of throttle and off again: no clicks', () => {
  const B = bank('d4'), cfg = { idle: 800, cyl: 4 };
  const x = render(Proc, B, cfg, (t) => (t < 0.5 ? { rpm: 800, load: 0.1 } : t < 1.2 ? { rpm: 800 + 2400 * Math.min(1, (t - 0.5) / 0.4), load: 1 } : { rpm: 3200 - 2000 * Math.min(1, (t - 1.2) / 0.6), load: 0 }), 2.2);
  // a click: one sample's step far bigger than the steps round it
  const W = 480;
  let clicks = 0;
  for (let i = SR * 0.2 + W; i < x.length - W; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    let s = 0;
    for (let j = i - W; j < i + W; j += 4) s += (x[j] - x[j - 1]) ** 2;
    if (d > 8 * Math.sqrt(s / (W / 2)) + 1e-4) clicks++;
  }
  assert.equal(clicks, 0, `${clicks} click-like steps`);
});
