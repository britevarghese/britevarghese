// The voice relay's codec (net/Voice.js): IMA ADPCM keeps speech clear at 4 bits a sample, frame by frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adpcmEncode, adpcmDecode } from '../src/net/Voice.js';

test('ADPCM: a voice-like signal survives at 4 bits a sample, and every frame decodes on its own', () => {
  const st = { pred: 0, index: 0 }, frames = [];
  const sig = (i) => 0.4 * Math.sin(i * 0.11) + 0.2 * Math.sin(i * 0.47 + 1) + 0.05 * Math.sin(i * 1.9);
  for (let f = 0; f < 10; f++) {
    const pcm = new Int16Array(640);
    for (let i = 0; i < 640; i++) pcm[i] = Math.round(sig(f * 640 + i) * 32767);
    const bytes = adpcmEncode(pcm, st);
    assert.equal(bytes.length, 3 + 320, '4 bits a sample and 3 bytes of state');
    frames.push({ pcm, bytes });
  }
  // decode the frames out of order: each carries its own state
  let err = 0, pow = 0;
  for (const f of [frames[7], frames[2], frames[9], frames[5]]) {
    const out = adpcmDecode(f.bytes);
    assert.equal(out.length, 640);
    for (let i = 0; i < 640; i++) { const x = f.pcm[i] / 32768; err += (out[i] - x) ** 2; pow += x * x; }
  }
  const snr = 10 * Math.log10(pow / err);
  assert.ok(snr > 18, `signal to noise ${snr.toFixed(1)} dB`);
  // silence stays silent, and the extremes don't wrap
  const quiet = adpcmDecode(adpcmEncode(new Int16Array(640), { pred: 0, index: 0 }));
  assert.ok(quiet.every((x) => Math.abs(x) < 0.001));
  const loud = new Int16Array(640).map((_, i) => (i % 80 < 40 ? 32767 : -32768));
  const back = adpcmDecode(adpcmEncode(loud, { pred: 0, index: 0 }));
  assert.ok(back.every((x) => x >= -1 && x <= 1));
});
