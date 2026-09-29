#!/usr/bin/env python3
# Analyses each trimmed engine recording for the loop builder (build_loops.py):
# tracks the firing frequency f0 over time (harmonic-sum salience + Viterbi smoothing), classifies every
# frame as rising (on throttle), falling (off throttle) or steady, and writes
# .cache/sounds/<name>.json = { f0idle, f0max, gain, t:[s], f:[Hz], d:[-1|0|1], v:[dB re loud] }.
import json, os, sys
import numpy as np
from scipy.signal import decimate, stft, medfilt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = json.load(open(os.path.join(ROOT, 'tools/sounds/sources.json')))
CACHE = os.path.join(ROOT, '.cache/sounds')
OUT = CACHE  # analysis is build input for build_loops.py
PLOTS = '--plots' in sys.argv

def track(x, sr, fmin=18, fmax=600, win=2048, hop=256):
    y = decimate(x, 2) if sr > 30000 else x
    sr2 = sr / 2 if sr > 30000 else sr
    f, t, Z = stft(y, fs=sr2, nperseg=win, noverlap=win - hop, padded=False, boundary=None)
    M = np.abs(Z) + 1e-9
    L = np.log(M)
    df = f[1] - f[0]
    cands = np.exp(np.arange(np.log(fmin), np.log(fmax), 1 / 74))
    S = np.zeros((len(cands), M.shape[1]))
    for ci, f0 in enumerate(cands):
        acc = 0
        for h in range(1, 9):
            k = h * f0 / df
            if k >= M.shape[0] - 1: break
            k0 = int(k); a = k - k0
            acc = acc + ((1 - a) * L[k0] + a * L[k0 + 1]) / h ** 0.5
        S[ci] = acc
    S = (S - S.mean(0)) / (S.std(0) + 1e-9)
    n = S.shape[1]; K = len(cands); pen = 0.35
    D = S[:, 0].copy(); back = np.zeros((K, n), dtype=np.int32); idx = np.arange(K)
    for j in range(1, n):
        best = np.full(K, -1e9); arg = np.zeros(K, dtype=np.int32)
        for d in range(-14, 15):
            sh = np.roll(D, d); valid = (idx - d >= 0) & (idx - d < K)
            val = sh - pen * abs(d)
            m = valid & (val > best); best[m] = val[m]; arg[m] = (idx - d)[m]
        D = best + S[:, j]; back[:, j] = arg
    path = np.zeros(n, dtype=int); path[-1] = int(np.argmax(D))
    for j in range(n - 1, 0, -1): path[j - 1] = back[path[j], j]
    rms = np.sqrt(np.mean(np.abs(Z) ** 2, axis=0))
    # stft time is the window centre (boundary=None): t already points at the middle of each window
    return t, cands[path], S[path, np.arange(n)], 20 * np.log10(rms + 1e-9), (f, M)

for e in SRC['engines']:
    name = e['name']
    meta = json.load(open(os.path.join(CACHE, name + '.f32.json')))
    x = np.fromfile(os.path.join(CACHE, name + '.f32'), dtype=np.float32)[:meta['n']]
    sr = meta['sr']
    t, f0, sal, db, spec = track(x, sr, *e['band'])
    lf = medfilt(np.log(f0), 9)
    k = np.ones(7) / 7
    ls = np.convolve(np.pad(lf, 3, mode='edge'), k, mode='valid')
    dt = t[1] - t[0]
    slope = np.gradient(ls, dt)                          # d ln f0 / dt
    d = np.where(slope > 0.18, 1, np.where(slope < -0.18, -1, 0))
    # time-domain level around each frame centre
    hw = int(0.025 * sr)
    c2 = np.concatenate([[0], np.cumsum(x.astype(np.float64) ** 2)])
    ci = np.clip((t * sr).astype(int), hw, len(x) - hw)
    lvl = np.sqrt((c2[ci + hw] - c2[ci - hw]) / (2 * hw))
    ldb = 20 * np.log10(lvl + 1e-9)
    loud = ldb > np.percentile(ldb, 97) - 36
    good = loud & (sal > np.percentile(sal, 4))
    fs_ = np.exp(ls)
    f0idle = float(np.percentile(fs_[good], 4))
    f0max = float(np.percentile(fs_[good], 98.5))
    # loudness normalisation from the upper half of the rev range
    hi = good & (fs_ > (f0idle + f0max) / 2)
    ref = np.median(ldb[hi]) if hi.sum() > 20 else np.median(ldb[good])
    step = 2
    sel = np.where(good)[0][::1]
    sel = sel[sel % step == 0]
    res = {
        'name': name, 'f0idle': round(f0idle, 2), 'f0max': round(f0max, 2),
        'gain': round(float(10 ** ((-16 - ref) / 20)), 3),
        't': [round(float(v), 3) for v in t[sel]],
        'f': [round(float(v), 1) for v in fs_[sel]],
        'd': [int(v) for v in d[sel]],
        'v': [int(round(float(v))) for v in (ldb[sel] - ref)],
    }
    json.dump(res, open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'))
    cnt = {c: int((d[sel] == c).sum()) for c in (-1, 0, 1)}
    print(f"{name:14} idle {f0idle:6.1f} Hz  max {f0max:6.1f} Hz  ratio {f0max / f0idle:4.1f}  frames {len(sel)}  up {cnt[1]} down {cnt[-1]} steady {cnt[0]}  gain {res['gain']}")
    if PLOTS:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        f, M = spec; s = f < 1200
        fig, ax = plt.subplots(2, 1, figsize=(14, 6), sharex=True, gridspec_kw={'height_ratios': [3, 1]})
        Ld = 20 * np.log10(M[s])
        ax[0].pcolormesh(t, f[s], Ld, shading='auto', cmap='magma', vmin=np.percentile(Ld, 40))
        cols = np.array(['#4af', '#ccc', '#f44'])[d + 1]
        ax[0].scatter(t[sel], fs_[sel], c=cols[sel], s=2)
        ax[0].set_yscale('log'); ax[0].set_ylim(15, 1200); ax[0].set_title(name)
        ax[0].axhline(f0idle, color='w', lw=0.5); ax[0].axhline(f0max, color='w', lw=0.5)
        ax[1].plot(t, ldb, 'k')
        plt.tight_layout(); plt.savefig(os.path.join(CACHE, f'plot_{name}.png'), dpi=55); plt.close()
