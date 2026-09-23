// NIGHTSHIFT audio - procedural buffers & curves (generated once, reused everywhere).

/** Deterministic PRNG so generated buffers are stable between sessions. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate the shared noise buffers.
 * white: flat spectrum, pink: -3 dB/oct, brown: -6 dB/oct (rumble),
 * droplets: sparse little decaying pings for rain ticks (loopable).
 */
export function createNoiseBuffers(ctx) {
  const sr = ctx.sampleRate;
  const rnd = mulberry32(0x5eed1234);

  const white = ctx.createBuffer(1, Math.floor(sr * 2), sr);
  {
    const d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  }

  const pink = ctx.createBuffer(1, Math.floor(sr * 3), sr);
  {
    // Paul Kellet's economy pink filter
    const d = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    crossfadeLoop(d, Math.floor(sr * 0.05));
  }

  const brown = ctx.createBuffer(1, Math.floor(sr * 3), sr);
  {
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rnd() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    crossfadeLoop(d, Math.floor(sr * 0.05));
  }

  const droplets = ctx.createBuffer(1, Math.floor(sr * 4), sr);
  {
    const d = droplets.getChannelData(0);
    const count = 160;
    for (let k = 0; k < count; k++) {
      const start = Math.floor(rnd() * (d.length - sr * 0.05));
      const freq = 1800 + rnd() * 4200;
      const amp = 0.15 + rnd() * 0.5;
      const len = Math.floor(sr * (0.006 + rnd() * 0.02));
      const w = (2 * Math.PI * freq) / sr;
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-i / len) * 5);
        d[start + i] += Math.sin(w * i) * env * amp + (rnd() * 2 - 1) * env * amp * 0.3 * (i < 30 ? 1 : 0);
      }
    }
  }

  return { white, pink, brown, droplets };
}

function crossfadeLoop(d, n) {
  // blend the tail into the head so the loop point doesn't click
  const len = d.length;
  for (let i = 0; i < n; i++) {
    const a = i / n;
    d[i] = d[i] * a + d[len - n + i] * (1 - a);
  }
  // shorten effective loop by leaving tail as-is (small discontinuity is masked)
}

/** Stereo decaying-noise impulse response: a soft, dark "city street" reverb. */
export function createImpulseResponse(ctx, seconds = 2.2, decay = 3.2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  const rnd = mulberry32(0xc17e);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    const pre = Math.floor(sr * 0.012);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const w = rnd() * 2 - 1;
      // progressively darker tail (one-pole lowpass whose coefficient drops over time)
      const k = 0.65 - 0.5 * t;
      lp = lp + k * (w - lp);
      d[i] = lp * Math.pow(1 - t, decay);
    }
    // a few discrete early reflections (building facades)
    for (let r = 0; r < 6; r++) {
      const at = Math.floor(sr * (0.02 + rnd() * 0.09));
      d[at] += (rnd() * 0.6 + 0.2) * (rnd() < 0.5 ? -1 : 1);
    }
  }
  return ir;
}

/** tanh soft-clip curve. amount ~1 (clean) .. 10 (fuzzy) */
export function makeDriveCurve(amount = 2, n = 1024) {
  const c = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / norm;
  }
  return c;
}

/** Asymmetric crunchy curve for metal impacts / crackle pops. */
export function makeCrunchCurve(n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = x >= 0 ? 1 - Math.exp(-4 * x) : -(1 - Math.exp(3 * x)) * 0.8;
  }
  return c;
}
