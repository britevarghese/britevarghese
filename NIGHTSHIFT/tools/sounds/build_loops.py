#!/usr/bin/env python3
# Engine loop sets for the loop-crossfade engine (src/audio/EngineSynth.js, "loop" mode).
# From each analysed engine recording (analyze.py: f0 track + rev direction per frame) this cuts steady
# stretches at LEVELS rpm points between idle and redline, separately for on-throttle (revs rising /
# held) and off-throttle (revs falling) sound, pitch-flattens each one (resampled so its firing
# frequency is exactly constant), and turns it into a seamless loop (a whole number of engine periods,
# tail crossfaded into the head). Output per engine: one 16-bit mono WAV with all loops back to back
# + <name>.loops.json {sr, f0:[..], on:[[start, len], ..], off:[..], gain}.
# Usage (from NIGHTSHIFT, after build.mjs has decoded + analysed): python3 tools/sounds/build_loops.py
import json, os, wave
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = json.load(open(os.path.join(ROOT, 'tools/sounds/sources.json')))
CACHE = os.path.join(ROOT, '.cache/sounds')
OUT = os.path.join(ROOT, 'public/assets/audio/engines')
LEVELS = 6
LOOP_S = 0.8      # loop length
XF_S = 0.12       # loop crossfade
WIN_S = 1.0       # source stretch examined around each candidate


def load(name):
    meta = json.load(open(os.path.join(CACHE, name + '.f32.json')))
    x = np.fromfile(os.path.join(CACHE, name + '.f32'), dtype=np.float32)[:meta['n']].astype(np.float64)
    return x, meta['sr']


def flatten(x, sr, t, f, t0, target, n_out):
    """Resample from source time t0 so the tracked f0 plays at exactly `target` Hz (rate updated every
    32 samples from the f0 track)."""
    out = np.empty(n_out)
    pos, C = t0 * sr, 32
    for i in range(0, n_out, C):
        m = min(C, n_out - i)
        rate = target / np.interp(pos / sr, t, f)
        p = pos + rate * np.arange(m)
        k = p.astype(int)
        if k[-1] + 1 >= len(x): return None
        a = p - k
        out[i:i + m] = x[k] * (1 - a) + x[k + 1] * a
        pos += rate * m
    return out


def make_loop(seg, sr, target):
    """Seamless loop: a whole number of periods long, tail crossfaded (equal power) into the head."""
    period = sr / target
    n = int(round(round(LOOP_S * target) * period))
    xf = int(XF_S * sr)
    if len(seg) < n + xf: return None
    body = seg[:n].copy()
    tail = seg[n:n + xf]
    w = np.linspace(0, 1, xf)
    body[:xf] = body[:xf] * np.sqrt(w) + tail * np.sqrt(1 - w)
    return body


def pick(t, f, d, v, target, want):
    """Best source time for a steady stretch near `target` Hz of the wanted rev direction."""
    best, bestc = None, 1e9
    dt = t[1] - t[0] if len(t) > 1 else 0.023
    need = int((LOOP_S + XF_S) * 1.6 / dt) + 2   # frames the (resampled) stretch may span
    for i in range(len(t) - need):
        j = i + need
        if t[j - 1] - t[i] > (LOOP_S + XF_S) * 1.8: continue          # gap in the analysed audio
        ff = f[i:j]
        dl = np.log(ff / target)
        c = abs(np.mean(dl)) * 4 + np.std(np.log(ff)) * 3             # on pitch, and steady
        dd = d[i:j]
        if want == 'on': c += np.mean(dd < 0) * 0.6                   # avoid falling revs
        else: c += np.mean(dd > 0) * 0.8 + np.mean(dd == 0) * 0.1     # prefer falling revs
        c += max(0, -np.min(v[i:j]) - 12) * 0.03                      # loud enough throughout
        if c < bestc: bestc, best = c, i
    return best, bestc


manifest = {}
for e in SRC['engines']:
    name = e['name']
    an = json.load(open(os.path.join(CACHE, name + '.json')))
    t, f, d, v = (np.array(an[k], dtype=float) for k in ('t', 'f', 'd', 'v'))
    x, sr = load(name)
    f0idle, f0max = an['f0idle'], an['f0max']
    levels = [f0idle * (f0max / f0idle) ** (k / (LEVELS - 1)) for k in range(LEVELS)]
    pcm, sets, report = [], {'on': [], 'off': []}, []
    off = 0
    for cls in ('on', 'off'):
        for L in levels:
            i, c = pick(t, f, d, v, L, cls)
            seg = flatten(x, sr, t, f, t[i], L, int((LOOP_S + XF_S + 0.12) * sr)) if i is not None else None
            loop = make_loop(seg, sr, L) if seg is not None else None
            if loop is None:
                sets[cls].append(sets[cls][-1] if sets[cls] else None)
                report.append(f'{cls}{L:.0f}:-'); continue
            pcm.append(loop)
            sets[cls].append([off, len(loop)])
            off += len(loop)
            report.append(f'{cls}{L:.0f}@{t[i]:.1f}s c{c:.2f}')
    # normalise all loops of an engine together (keeps the natural level differences between them)
    allpcm = np.concatenate(pcm)
    peak = np.max(np.abs(allpcm)) or 1
    q = np.clip(allpcm / peak * 0.95 * 32767, -32767, 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name + '.loops.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(q.tobytes())
    rms = [float(np.sqrt(np.mean((p / peak) ** 2))) for p in pcm]
    json.dump({'sr': sr, 'f0': [round(L, 2) for L in levels], 'on': sets['on'], 'off': sets['off'],
               'rms': round(float(np.median(rms)), 4)},
              open(os.path.join(OUT, name + '.loops.json'), 'w'), separators=(',', ':'))
    print(f'{name:14} {len(q) / sr:5.1f}s {os.path.getsize(os.path.join(OUT, name + ".loops.wav")) // 1024:5} KB  ' + ' '.join(report))
