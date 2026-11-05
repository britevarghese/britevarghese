// Builds the continuous beds (vehicle engines, helicopter rotor, wind) and the near-miss cracks from CC0 recordings
// (credits in client/assets/audio/README.md) and adds them to client/assets/audio/sounds.json (other sets are kept).
//   node scripts/audio/build_beds.mjs <src> client/assets/audio        (needs ffmpeg + curl; run after build_audio.py)
// Downloads into <src>/dl_bsb/<id>.aiff: BigSoundBank originals (Joseph Sardin), each page checked for "License CC0".
// Loop takes: a steady section, its length tuned to the engine / rotor period (best match of the crossfade region one
// loop later), the loop point crossfaded offline, then LOOP_PAD s of the loop's own continuation on both sides
// (circular padding). Audio.js loops [LOOP_PAD, dur - LOOP_PAD] of each take, so a decoder that leaves the MP3 priming
// delay in (or trims a little more) still loops seamlessly. 44.1 kHz mono MP3 (VBR), like the other beds; the cracks
// are 32 kHz 16-bit WAV like the gunshots (sample-accurate attacks).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) { console.error('usage: node scripts/audio/build_beds.mjs <src> <client/assets/audio>'); process.exit(1); }
const SR = 44100, GAP = 0.1, LOOP_PAD = 0.08;

// ---------------------------------------------------------------- sources
const BSB = path.join(SRC, 'dl_bsb');
function bsb(id, slug) {
  const out = path.join(BSB, `${id}.aiff`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(BSB, { recursive: true });
  const page = execFileSync('curl', ['-sS', '-f', '--max-time', '60', `https://bigsoundbank.com/${slug}-s${id}.html`]).toString();
  if (!/>License<\/h2>\s*<p[^>]*>\s*<strong>CC0 \(public domain\)/.test(page)) throw new Error(`BigSoundBank ${id}: page does not state CC0`);
  execFileSync('curl', ['-sS', '-f', '--max-time', '300', '-o', out, `https://bigsoundbank.com/UPLOAD/aiff/${id}.aiff`]);
  return out;
}

// NASA image and video library (US Government works, public domain): the original rendition of a video, after
// checking that its metadata credits no music (third-party music would not be public domain)
const NASA = path.join(SRC, 'dl_nasa');
function nasa(id) {
  const out = path.join(NASA, `${id}.mp4`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(NASA, { recursive: true });
  const base = `https://images-assets.nasa.gov/video/${id}/${id}`;
  const meta = execFileSync('curl', ['-sS', '-f', '--max-time', '60', `https://images-assets.nasa.gov/video/${id}/metadata.json`]).toString();
  if (/music/i.test(meta)) throw new Error(`NASA ${id}: metadata mentions music`);
  execFileSync('curl', ['-sS', '-f', '--max-time', '600', '-o', out, `${base}~orig.mp4`]);
  return out;
}

// decode to mono float32 at SR: ch = 0 / 1 picks one microphone (spaced stereo pairs comb when summed), 'mix' sums;
// af = extra ffmpeg filters (applied after the channel pick); rate < 1 = tape-style slow-down (lower and longer)
function decode(file, { ch = 0, start = 0, dur, af = [], rate = 1, sr = SR } = {}) {
  const pick = ch === 'mix' ? 'pan=mono|c0=0.5*c0+0.5*c1' : `pan=mono|c0=c${ch}`;
  const srcSR = +execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tape = rate !== 1 ? [`asetrate=${Math.round(srcSR * rate)}`] : [];
  const args = ['-v', 'error', '-ss', String(start)];
  if (dur) args.push('-t', String(dur));
  args.push('-i', file, '-af', [pick, ...tape, ...af, `aresample=${sr}`].join(','), '-f', 'f32le', '-ac', '1', '-');
  const raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }); // (stderr: AIFF ID3 tag warnings)
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
}
// mono stereo-ness check for the log (inter-channel correlation of the source)
function corr(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < x.length; i += 2) { a += x[i] * x[i]; b += x[i + 1] * x[i + 1]; c += x[i] * x[i + 1]; }
  return c / Math.sqrt(a * b + 1e-20);
}

// ---------------------------------------------------------------- loop making
const rms = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
const db = (v) => 20 * Math.log10(v + 1e-12);
function ncc(x, a, b, n) { let s = 0, ea = 0, eb = 0; for (let i = 0; i < n; i++) { s += x[a + i] * x[b + i]; ea += x[a + i] ** 2; eb += x[b + i] ** 2; } return s / Math.sqrt(ea * eb + 1e-20); }

// x holds the section (from its start): the loop is L samples, L within +-search s of len, chosen where the crossfade
// region (X s at the start) best matches the audio one loop later. Returns { loop, L, rho }.
function makeLoop(x, len, xf, search = 0.15) {
  const X = Math.round(xf * SR), L0 = Math.round(len * SR), S = Math.round(search * SR);
  if (L0 + S + X > x.length) throw new Error(`section too short: need ${((L0 + S + X) / SR).toFixed(2)} s, have ${(x.length / SR).toFixed(2)} s`);
  // 1) the pulse pattern (blade slap, firing strokes): amplitude envelope (2.5 ms mean of |x|, 2.2 kHz), the loop
  //    length where the crossfade region's envelope repeats best; 2) the waveform phase within +-1 ms of it
  const D = 20, H = Math.round(0.0025 * SR), e = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < e.length; i++) { let s = 0; for (let j = Math.max(0, i * D - H); j < Math.min(x.length, i * D + H); j++) s += Math.abs(x[j]); e[i] = s; }
  const em = e.reduce((a, b) => a + b, 0) / e.length; for (let i = 0; i < e.length; i++) e[i] -= em;
  let best = -2, L = L0;
  for (let l = Math.round((L0 - S) / D); l <= Math.round((L0 + S) / D); l++) { const r = ncc(e, 0, l, Math.round(X / D)); if (r > best) { best = r; L = l * D; } }
  const envR = best; best = -2; const Lc = L;
  for (let l = Lc - 44; l <= Lc + 44; l++) { const r = ncc(x, 0, l, X); if (r > best) { best = r; L = l; } }
  const rho = Math.max(0, best);
  // crossfade: the start of the loop fades from the audio that follows its end (x[L..L+X]) into its own start, with
  // weights that keep the power constant for the measured correlation (rho 0: equal power, 1: equal gain)
  const loop = new Float32Array(L);
  for (let i = 0; i < L; i++) loop[i] = x[i];
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X, a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2);
    const k = 1 / Math.sqrt(a * a + b * b + 2 * rho * a * b);
    loop[i] = (x[i] * a + x[L + i] * b) * k;
  }
  return { loop, L, rho, envR };
}
// seam check: first-difference energy across the wrap vs. inside the loop (1 = like anywhere else, a click would be
// >> 1), and the level step between the 20 ms before and after the wrap vs. the 90th percentile of that step anywhere
function seam(loop) {
  const L = loop.length, W = 32, d = (i) => loop[(i + L) % L] - loop[(i - 1 + L) % L];
  let ew = 0, ea = 0;
  for (let i = -W; i < W; i++) ew += d(i) ** 2;
  for (let i = 1; i < L; i++) ea += d(i) ** 2;
  const n20 = Math.round(0.02 * SR), lv = [];
  for (let a = 0; a + n20 <= L; a += n20) lv.push(db(rms(loop, a, a + n20)));
  const steps = lv.slice(1).map((v, i) => Math.abs(v - lv[i])).sort((a, b) => a - b);
  return { click: Math.sqrt(ew / (2 * W)) / Math.sqrt(ea / (L - 1)), step: db(rms(loop, 0, n20)) - db(rms(loop, L - n20, L)), p90: steps[Math.floor(steps.length * 0.9)] };
}
const circPad = (loop) => { const P = Math.round(LOOP_PAD * SR), L = loop.length, y = new Float32Array(L + 2 * P); for (let i = 0; i < y.length; i++) y[i] = loop[((i - P) % L + L) % L]; return y; };

// ---------------------------------------------------------------- engine speed (for idle / load crossfades)
// dominant period 8..60 ms (engine firing / rotor blade pass) by autocorrelation of the low band
function periodHz(x) {
  const lpN = Math.round(SR / 400); const y = new Float32Array(Math.floor(x.length / lpN));
  for (let i = 0; i < y.length; i++) { let s = 0; for (let j = 0; j < lpN; j++) s += Math.abs(x[i * lpN + j]); y[i] = s; } // envelope at 400 Hz
  const m = y.reduce((a, b) => a + b, 0) / y.length; for (let i = 0; i < y.length; i++) y[i] -= m;
  const fs2 = SR / lpN; let best = -1, lag = 0;
  for (let l = Math.round(0.008 * fs2); l <= Math.round(0.12 * fs2); l++) { const r = ncc(y, 0, l, y.length - l - 1); if (r > best) { best = r; lag = l; } }
  return { hz: fs2 / lag, r: best };
}

// ---------------------------------------------------------------- packing (same layout as build_audio.py)
const summary = {};
// takes: Float32Arrays, or { x, hit } (hit = offset of the transient, s); the set's loudest peak at `peak` dBFS
function writeSet(name, takes, { peak = -1, fmt = 'mp3', sr = SR } = {}) {
  takes = takes.map((t) => (t instanceof Float32Array ? { x: t } : t));
  const g = 10 ** (peak / 20) / Math.max(...takes.map((t) => t.x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const gapN = Math.round(GAP * sr), total = takes.reduce((s, t) => s + t.x.length + gapN, 0), y = new Float32Array(total), meta = [];
  let p = 0;
  for (const { x, hit } of takes) { meta.push([+(p / sr).toFixed(4), +(x.length / sr).toFixed(4), ...(hit != null ? [+hit.toFixed(3)] : [])]); for (let i = 0; i < x.length; i++) y[p + i] = x[i] * g; p += x.length + gapN; }
  // MP3: -0.5 dB headroom for the encoder, as build_audio.py does
  const k = fmt === 'mp3' ? 10 ** (-0.5 / 20) : 1, pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * k * 32767))), i * 2);
  const file = path.join(OUT, `${name}.${fmt}`);
  const codec = fmt === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '4'] : ['-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-map_metadata', '-1'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', String(sr), '-ac', '1', '-i', '-', ...codec, file], { input: pcm });
  summary[name] = { file: path.basename(file), takes: meta, loop: fmt === 'mp3' };
  return file;
}
// decode the written MP3 again (ffmpeg trims the priming delay, as browsers do) and check each loop region's seam
function verify(name) {
  const { file, takes } = summary[name];
  const x = decode(path.join(OUT, file));
  return takes.map(([s, d]) => {
    const a = Math.round((s + LOOP_PAD) * SR), L = Math.round((d - 2 * LOOP_PAD) * SR);
    return { ...seam(x.subarray(a, a + L)), dur: +(L / SR).toFixed(3), lvl: +db(rms(x, a, a + L)).toFixed(1) };
  });
}

// ---------------------------------------------------------------- the beds
// loop(src, {ch, start, len, xf, af}): section from `start`, loop length ~len s with an xf s crossfade
const log = [];
function loopTake(label, file, { ch = 0, start, len, xf = 0.3, af = ['highpass=f=28'], search, rate = 1 } = {}) {
  const x = decode(file, { ch, start, dur: len + xf + 0.5, af, rate });
  const { loop, L, rho, envR } = makeLoop(x, len, xf, search);
  const pe = periodHz(loop), s = seam(loop);
  log.push(`${label.padEnd(14)} ${path.basename(file)} ch ${ch} (src corr ${corr(file).toFixed(2)}) @${start}s  loop ${(L / SR).toFixed(3)} s  xfade: envelope r ${envR.toFixed(2)}, waveform rho ${rho.toFixed(2)}  seam: click ${s.click.toFixed(2)}, step ${s.step.toFixed(1)} dB (p90 elsewhere ${s.p90.toFixed(1)})  pulse ${pe.hz.toFixed(1)} Hz (r ${pe.r.toFixed(2)})  ${db(rms(loop)).toFixed(1)} dBFS`);
  return { loop, hz: pe.hz };
}
const eq = (takes, ref = -20) => takes.map((t) => { const k = 10 ** ((ref - db(rms(t))) / 20); return t.map((v) => v * k); });

// helicopter: outside (a powerful rotor close by: blade slap, turbine) and inside (the cabin: low, muffled)
const heliOut = bsb('0264', 'helicopter-2'), heliIn = bsb('0263', 'helicopter-1');
const hOut = loopTake('heli outside', heliOut, { ch: 0, start: 0.15, len: 3.5, xf: 0.35 });
const hIn = loopTake('heli inside', heliIn, { ch: 0, start: 0.6, len: 4.6, xf: 0.4 });
writeSet('loop_heli', eq([hOut.loop, hIn.loop]).map(circPad));

// tank: a tracked diesel machine (Volvo EC55B compact excavator, 3 L diesel) in one take: idling, then travelling on
// its tracks with the engine under load. Slowed to 0.78 for a heavier machine; the two keep their natural level ratio,
// Audio.js crossfades them with the speed.
const exc = bsb('2149', 'excavator-displacement');
const tIdle = loopTake('tank idle', exc, { ch: 1, start: 3.0, len: 4.0, xf: 0.35, rate: 0.78 });
const tMove = loopTake('tank moving', exc, { ch: 1, start: 38.0, len: 4.5, xf: 0.4, rate: 0.78 });
log.push(`tank moving / idle engine pulse ratio ${(tMove.hz / tIdle.hz).toFixed(2)}`);
writeSet('loop_tank', [tIdle.loop, tMove.loop].map(circPad));

// transport plane: the cargo hold of NASA's C-130 Hercules (four Allison T56 turboprops) in flight, Operation IceBridge
// 2015 (NASA Goddard video, natural sound); one camera shot (32.3-37.6 s), the left channel
const oib = nasa('GSFC_20150422_OIB_m11862_southwest_coastal');
const pl = loopTake('plane cabin', oib, { ch: 0, start: 32.5, len: 4.2, xf: 0.4, af: ['highpass=f=25'] });
writeSet('loop_plane', [pl.loop].map(circPad));

// jeep: Iveco Daily 3.0 turbo-diesel idling (light-truck four-cylinder)
const iveco = bsb('1145', 'truck-engine');
const jIdle = loopTake('jeep idle', iveco, { start: 6.0, len: 4.0, xf: 0.3 });
writeSet('loop_jeep', [jIdle.loop].map(circPad));

// bike: single-cylinder quad (ATV) engine idling
const quad = bsb('0711', 'quad-stopped');
const bIdle = loopTake('bike idle', quad, { start: 12.0, len: 3.5, xf: 0.3 });
writeSet('loop_bike', [bIdle.loop].map(circPad));

// wind: strong steady wind, one microphone of the pair (freefall / canopy; Audio.js filters it with the speed)
const wind = bsb('0154', 'strong-wind-4');
const w = loopTake('wind', wind, { ch: 0, start: 0.5, len: 5.0, xf: 0.8, af: ['highpass=f=25'], search: 0.3 });
writeSet('loop_wind', [w.loop].map(circPad));

// ---------------------------------------------------------------- near-miss cracks
// No CC0 / public-domain recording of a bullet passing close by was reachable. A cracking whip is the same physics in
// miniature: its tip breaks the sound barrier and the crack is the shock wave (an N-wave of a fraction of a ms, like a
// rifle bullet's). Four whip cracks, cut 1 ms before the shock, the rope's swish high-passed away, the tail faded
// (squared) over its last 40 %; matched on punch (RMS of the first 3 ms), set peak -1 dBFS. hit = the shock's offset.
const SRC_ = 32000;
function crackTake(id, slug, { at = 0, len }) {
  const x = decode(bsb(id, slug), { sr: SRC_, af: ['highpass=f=300', 'highpass=f=300'] });
  // the shock: first sample over 30 % of the loudest one after `at`
  const a0 = Math.round(at * SRC_);
  let pk = 0; for (let i = a0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  let on = a0; while (Math.abs(x[on]) < 0.3 * pk) on++;
  const s = on - Math.round(0.001 * SRC_), n = Math.round(len * SRC_), y = x.slice(s, s + n), f = Math.round(n * 0.4);
  for (let i = 0; i < 16; i++) y[i] *= i / 16;
  for (let i = 0; i < f; i++) y[n - f + i] *= (1 - i / f) ** 2;
  const punch = rms(y, Math.round(0.001 * SRC_), Math.round(0.004 * SRC_));
  log.push(`crack ${id}       shock at ${(on / SRC_).toFixed(4)} s, ${(len * 1000).toFixed(0)} ms, punch ${db(punch).toFixed(1)} dBFS, tail ${db(rms(y, Math.round(0.02 * SRC_))).toFixed(1)} dBFS`);
  return { x: y.map((v) => v / punch), hit: 0.001 };
}
writeSet('crack', [
  crackTake('2949', 'whip-crack-1', { len: 0.09 }),
  crackTake('2950', 'whip-crack-2', { at: 0.2, len: 0.12 }), // the second (main) crack of a double crack
  crackTake('2951', 'whip-crack-3', { len: 0.12 }),
  crackTake('2952', 'whip-crack-4', { len: 0.1 }),
], { fmt: 'wav', sr: SRC_ });

// ---------------------------------------------------------------- manifest + report
const manPath = path.join(OUT, 'sounds.json');
let text = fs.readFileSync(manPath, 'utf8').trim();
const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v)); // python-style floats, like the rest of the file
for (const [k, v] of Object.entries(summary)) {
  const val = `["${v.file}",[${v.takes.map((t) => `[${t.map(num).join(',')}]`).join(',')}]]`;
  const re = new RegExp(`"${k}":\\["[^"]+",\\[(?:\\[[^\\]]*\\],?)*\\]\\]`);
  text = re.test(text) ? text.replace(re, `"${k}":${val}`) : text.replace(/\}$/, `,"${k}":${val}}`);
}
JSON.parse(text);
fs.writeFileSync(manPath, text);
for (const l of log) console.log(l);
let kb = 0;
for (const [k, v] of Object.entries(summary)) {
  const size = fs.statSync(path.join(OUT, v.file)).size; kb += size / 1024;
  const check = v.loop ? `  decoded: ${verify(k).map((r) => `${r.dur}s ${r.lvl} dBFS click ${r.click.toFixed(2)} step ${r.step.toFixed(1)} dB (p90 ${r.p90.toFixed(1)})`).join(' | ')}` : '';
  console.log(`${k.padEnd(12)} ${v.file.padEnd(16)} ${(size / 1024).toFixed(1).padStart(6)} KB  takes ${JSON.stringify(v.takes)}${check}`);
}
console.log(`added ${kb.toFixed(1)} KB`);
