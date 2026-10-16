"""Engine recordings: the firing frequency over time, and a mark at every firing (TRAILBREAK's grain engine).

track(): the firing frequency ff (Hz) per analysis frame. A harmonic-sum tracker over rpm: each candidate's salience is
the whitened log spectrum summed at the firing harmonics (ff, 2ff, ...; weights fall off as 1/sqrt(h)), smoothed over
time by a Viterbi path that lets the revs move as fast as a free-revving engine can. Lines that don't belong to the
engine (a hum) can be notched.

marks(): one mark per firing, on the same point of every firing pulse. The tracked phase 2*pi*integral(ff) spaces the
marks; the pulse position within the cycle (the envelope of the 250-4000 Hz band, folded over a few cycles) pins them
to the pulse, so marks from different stretches of a recording line up with each other.
"""
import numpy as np
from scipy.signal import stft, butter, sosfiltfilt, resample_poly, medfilt


def to_rate(x, sr, sr2):
    from math import gcd
    g = gcd(int(sr), int(sr2))
    return resample_poly(x, int(sr2) // g, int(sr) // g)


def track(x, sr, f_lo, f_hi, hum=(), win_s=0.1, hop_s=0.008, hmax=10, fmax=1000, slew=10, anchors=()):
    """The engine's pitch per frame (the firing frequency, or whichever multiple of it the recording carries: a
    consistent one is all the grain engine needs). anchors: [(t, Hz)] the path must pass (+-4%). Returns t (s),
    f (Hz), salience (z-score), level (dB)."""
    sa = 4000
    y = to_rate(x, sr, sa)
    nper = int(win_s * sa); hop = int(hop_s * sa)
    f, t, Z = stft(y, fs=sa, nperseg=nper, noverlap=nper - hop, nfft=nper * 4, padded=False, boundary=None)
    M = np.abs(Z) + 1e-9
    L = np.log(M)
    # whiten along frequency: take off the broad spectral shape (formants, rumble), keep the lines
    df = f[1] - f[0]
    k = max(3, int(12 / df)) | 1
    from scipy.ndimage import median_filter
    Lw = L - median_filter(L, size=(k, 1), mode='nearest')
    for h0, bw in hum:                                  # notch lines that aren't the engine's
        Lw[(f > h0 - bw) & (f < h0 + bw)] = 0
    cands = np.exp(np.arange(np.log(f_lo), np.log(f_hi), 0.005))
    S = np.zeros((len(cands), Lw.shape[1]))
    Lp = np.maximum(Lw, -1.0)                           # (a missing harmonic costs a little, a line pays a lot)
    for i, ff in enumerate(cands):
        acc = 0
        for h in range(1, hmax + 1):
            fh = h * ff
            if fh >= min(fmax, f[-1] - df): break
            b = fh / df; b0 = int(b); a = b - b0
            acc = acc + ((1 - a) * Lp[b0] + a * Lp[b0 + 1]) * 0.84 ** (h - 1)
        # a subharmonic (half the true rate) also collects every line: it pays for the empty ones in between
        S[i] = acc
    S = (S - S.mean(0)) / (S.std(0) + 1e-9)
    for ta, fa in anchors:
        j = int(np.argmin(np.abs(t - ta)))
        S[np.abs(np.log(cands / fa)) > 0.04, j] -= 50
    n = S.shape[1]; K = len(cands)
    pen = 0.08
    D = S[:, 0].copy(); back = np.zeros((K, n), dtype=np.int32); idx = np.arange(K)
    for j in range(1, n):
        best = np.full(K, -1e9); arg = np.zeros(K, dtype=np.int32)
        for d in range(-slew, slew + 1):
            sh = np.roll(D, d); valid = (idx - d >= 0) & (idx - d < K)
            val = sh - pen * abs(d)
            m = valid & (val > best); best[m] = val[m]; arg[m] = (idx - d)[m]
        D = best + S[:, j]; back[:, j] = arg
    path = np.zeros(n, dtype=int); path[-1] = int(np.argmax(D))
    for j in range(n - 1, 0, -1): path[j - 1] = back[path[j], j]
    lvl = 20 * np.log10(np.sqrt(np.mean(M ** 2, axis=0)) + 1e-9)
    return t, cands[path], S[path, np.arange(n)], lvl


def marks(x, sr, t, ff, fold=6):
    """Sample positions of the firings (one per period of ff), pinned to the pulse."""
    n = len(x)
    ffs = np.interp(np.arange(n) / sr, t, ff)
    phase = 2 * np.pi * np.cumsum(ffs) / sr               # radians, the tracked firing phase
    # pulse envelope: the 250-4000 Hz band (the exhaust and combustion bark), rectified and smoothed
    sos = butter(4, [250, min(4000, sr / 2 - 100)], btype='band', fs=sr, output='sos')
    e = np.abs(sosfiltfilt(sos, x))
    sm = butter(2, 120, fs=sr, output='sos')
    e = sosfiltfilt(sm, e)
    # fold the envelope over each stretch of `fold` cycles: where in the cycle the pulse sits
    cyc = phase / (2 * np.pi)
    ci = np.floor(cyc).astype(np.int64)
    frac = cyc - ci
    NB = 64
    bins = np.minimum(NB - 1, (frac * NB).astype(int))
    total = ci[-1] + 1
    hist = np.zeros((total, NB)); cnt = np.zeros((total, NB))
    np.add.at(hist, (ci, bins), e); np.add.at(cnt, (ci, bins), 1)
    prof = hist / np.maximum(cnt, 1)
    # smooth over neighbouring cycles, then find the pulse peak per cycle (circular)
    kern = np.ones(fold) / fold
    from scipy.ndimage import convolve1d
    prof = convolve1d(prof, kern, axis=0, mode='nearest')
    prof = convolve1d(prof, np.array([0.25, 0.5, 0.25]), axis=1, mode='wrap')
    # unwrap the peak position across cycles so it moves smoothly (no jumps of a whole cycle)
    ang = np.angle(np.sum(prof * np.exp(2j * np.pi * (np.arange(NB) + 0.5) / NB), axis=1))
    off = np.unwrap(ang) / (2 * np.pi)                     # cycles
    off = medfilt(off, 5)
    # a mark where cyc - off(cycle) crosses an integer
    target = np.arange(total) + off
    pos = np.interp(target, cyc, np.arange(n))
    ok = (target > cyc[0]) & (target < cyc[-1])
    return pos[ok].astype(np.int64)


def coherence(x, mk, n=8, pts=64):
    """How alike neighbouring firings look between the marks (1: identical, 0: unrelated) over windows of n firings,
    and how alike the two halves of each firing are (high: the marks are two firings apart, the pitch an octave low).
    A pitch tracked wrong (3/4 or 3/2 of the real one, or an octave) shows up as firings that don't repeat."""
    m = len(mk)
    shapes = np.zeros((m - 1, pts))
    for k in range(m - 1):
        a, b = mk[k], mk[k + 1]
        seg = x[a:b]
        if len(seg) < 8: continue
        v = np.interp(np.linspace(0, len(seg) - 1, pts), np.arange(len(seg)), seg)
        v = v - v.mean()
        nv = np.sqrt(np.sum(v * v)) + 1e-12
        shapes[k] = v / nv
    coh = np.zeros(m)
    half = np.zeros(m)
    for k in range(m - 1):
        lo, hi = max(0, k - n // 2), min(m - 1, k + n // 2 + 1)
        mean = shapes[lo:hi].mean(axis=0)
        coh[k] = np.sum(mean * mean)                       # (each shape has unit energy)
        sh = shapes[k]
        h1, h2 = sh[:pts // 2], sh[pts // 2:]
        half[k] = np.sum(h1 * h2) / (np.sqrt(np.sum(h1 * h1) * np.sum(h2 * h2)) + 1e-12)
    coh[-1] = coh[-2] if m > 1 else 0
    half[-1] = half[-2] if m > 1 else 0
    return coh, half


def follow(x, sr, seeds, f_lo, f_hi, t_end=None, lost=0.25, patience=6):
    """Firing marks by following the waveform: from each seed (t, Hz) the next firing is where the recording looks
    most like it did around the last one, a period on (searched -22%..+28%, normalised cross-correlation on the
    band that carries the firings). Fast revs are followed the way the waveform moves, and it can't slip an octave a
    step at a time without the halves test seeing it. Returns sorted mark positions (samples) and each one's score."""
    sos = butter(4, [max(20, f_lo * 0.8), min(sr / 2 - 100, 2500)], btype='band', fs=sr, output='sos')
    y = sosfiltfilt(sos, x)
    n = len(y)
    t_end = n / sr if t_end is None else t_end
    seeds = sorted(seeds)
    out_p, out_s = [], []
    for si, (ts, fs) in enumerate(seeds):
        stop = int((seeds[si + 1][0] if si + 1 < len(seeds) else t_end) * sr)
        # start on the pulse: the envelope peak within one period of the seed
        P = sr / fs
        a = int(ts * sr)
        w = np.abs(y[a:a + int(P)])
        if len(w) < 4: continue
        c = a + int(np.argmax(w))
        for direction in ((1, -1) if si == 0 else (1,)):
            cc, PP, bad = c, P, 0
            while True:
                W = int(0.6 * PP)
                lo_o, hi_o = int(PP * 0.78), int(PP * 1.28)
                if direction > 0 and cc + hi_o + W >= min(n, stop + int(PP)): break
                if direction < 0 and cc - hi_o - W < 0: break
                ci = int(round(cc))
                ref = y[ci - W:ci + W]
                if len(ref) < 2 * W or W < 4: break
                if direction > 0: win = y[ci + lo_o - W:ci + hi_o + W]
                else: win = y[ci - hi_o - W:ci - lo_o + W]
                num = np.correlate(win, ref, mode='valid')
                e2 = np.convolve(win * win, np.ones(2 * W), mode='valid') + 1e-12
                sc = num / np.sqrt(e2 * (np.dot(ref, ref) + 1e-12))
                j = int(np.argmax(sc))
                # parabolic refinement
                if 0 < j < len(sc) - 1:
                    d = sc[j - 1] - 2 * sc[j] + sc[j + 1]
                    frac = 0.5 * (sc[j - 1] - sc[j + 1]) / d if d < 0 else 0
                else: frac = 0
                o = (lo_o + j + frac) if direction > 0 else (hi_o - j - frac)
                if not (sr / f_hi <= o <= sr / f_lo): break
                score = sc[j]
                bad = bad + 1 if score < lost else 0
                if bad >= patience: break
                cc = cc + direction * o
                PP = o
                out_p.append(cc); out_s.append(score)
            if direction > 0: out_p.append(c); out_s.append(1.0)
    order = np.argsort(out_p)
    p = np.array(out_p)[order]; s = np.array(out_s)[order]
    # duplicates where two seeds' runs meet: keep marks at least 0.5 of the shortest period apart
    keep = np.ones(len(p), bool)
    for i in range(1, len(p)):
        if p[i] - p[i - 1] < 0.5 * sr / f_hi: keep[i] = False
    return np.round(p[keep]).astype(np.int64), s[keep]
