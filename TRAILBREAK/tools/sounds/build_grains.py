#!/usr/bin/env python3
"""Grain banks for TRAILBREAK's engine sound (src/audio/engine-worklet.js).

Each bank is one engine's sound cut from real recordings (tools/sounds/sources.json, Freesound CC0 / CC BY), as a list
of firings: the audio, and a mark on every firing pulse with what the engine was doing there (its revs relative to
idle, accelerating / holding / slowing, how loud). The game plays the firings back one by one at the rate its own
engine fires (pitch-synchronous overlap-add), so the exhaust and the block keep their real resonances at any revs.

Usage (from TRAILBREAK): python3 -I tools/sounds/build_grains.py <cache_dir> [bank ...]
  <cache_dir>  where the Freesound previews are downloaded to and decoded (kept out of the repo)
Writes public/assets/audio/engines/<bank>.grains.wav (16-bit mono) and <bank>.grains.json.
"""
import base64, json, os, re, subprocess, sys, urllib.request, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from track import track, marks, coherence, follow  # noqa: E402

SR = 32000                     # bank sample rate
OUT = os.path.join(ROOT, 'public', 'assets', 'audio', 'engines')
PAD = int(0.04 * SR)           # silence between runs


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'trailbreak-sound-import'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def fetch(cache, part):
    """The Freesound HQ preview (128 kbps MP3), decoded to SR mono float32."""
    sid = part['id']
    page = os.path.join(cache, f'{sid}.html')
    if not os.path.exists(page):
        open(page, 'wb').write(get(f'https://freesound.org/s/{sid}/'))
    mp3 = os.path.join(cache, f'{sid}.mp3')
    if not os.path.exists(mp3):
        h = open(page, encoding='utf-8', errors='ignore').read()
        url = re.search(r'data-mp3="([^"]+)"', h).group(1).replace('-lq.mp3', '-hq.mp3')
        open(mp3, 'wb').write(get(url))
    raw = os.path.join(cache, f'{sid}.{SR}.f32')
    if not os.path.exists(raw):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', str(SR), '-f', 'f32le', raw], check=True)
    return np.fromfile(raw, dtype=np.float32).astype(np.float64)


def license_of(cache, part):
    if part['lic'] == 'CC0':
        return 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'
    h = open(os.path.join(cache, f"{part['id']}.html"), encoding='utf-8', errors='ignore').read()
    m = re.search(r'creativecommons.org/licenses/by/([0-9.]+)', h)
    v = m.group(1) if m else '4.0'
    return f'CC BY {v}', f'https://creativecommons.org/licenses/by/{v}/'


def analyse(x, part, bank):
    """Marks and what the engine does at each, for every stretch of one recording."""
    cyl, idle = part.get('cyl', bank['cyl']), bank['idleRpm']
    # a part from another engine (a donor) has its own idle: its revs count relative to that
    rel = idle / part.get('idleRpm', idle)
    h0 = part.get('h', 1)                                  # which multiple of the firing frequency the track follows
    out = []
    for st in part['t']:
        t0, t1 = st[0], st[1]
        f_lo, f_hi = (st[2], st[3]) if len(st) > 3 else part['f']   # (a stretch can narrow the pitch range)
        a, b = int(t0 * SR), int(t1 * SR)
        seg = x[a:b]
        anchors = [(ta - t0, fa) for ta, fa in part.get('anchor', []) if t0 <= ta <= t1]
        t, f, sal, lvl = track(seg, SR, f_lo, f_hi, slew=part.get('slew', 6), anchors=anchors,
                               hum=[tuple(hb) for hb in part.get('hum', [])])
        if part.get('follow'):
            mk = follow_marks(seg, t, f, sal, f_lo, f_hi, anchors)
            # the pitch at each mark from the marks themselves (what the grain engine will space them by)
            if len(mk) >= 8:
                per = np.diff(mk).astype(float)
                fm_k = np.r_[SR / per, SR / per[-1]]
                t = mk / SR; f = np.convolve(np.pad(fm_k, 2, mode='edge'), np.ones(5) / 5, mode='valid')
                sal = np.full(len(t), 2.0)
        elif part.get('rpmFromAnchors') and len(anchors) > 1:
            mk = anchor_marks(seg, anchors)
        else:
            mk = marks(seg, SR, t, f)
        # (tracking a whole multiple of the bank's marks, as a V10's single firings at idle where its pairs are faint:
        # every h-th firing starts a mark)
        if h0 > 1 and float(h0).is_integer(): mk = mk[::int(h0)]
        if len(mk) < 8: continue
        # the revs at each mark (relative to the bank's idle) and how fast they are changing
        tm = mk / SR
        fm = np.interp(tm, t, f)
        if part.get('rpmFromAnchors') and len(anchors) > 1:
            # (a recording traced finely by hand: the revs at each firing from the trace, not from a track that can
            # slip to a neighbouring harmonic for a firing or two)
            at = np.array(anchors, float)
            fm = np.exp(np.interp(tm, at[:, 0], np.log(at[:, 1])))
        rpm = fm / h0 * 120 / cyl * part.get('rpmScale', 1) * rel
        lr = np.log(np.maximum(rpm, 1))
        # ~0.12 s of firings (longer for a part whose marks jitter: a pull read as pulling, not pulling and slowing)
        k = max(3, int(part.get('slopeSpan', 0.12) * np.median(fm)))
        ls = np.convolve(np.pad(lr, k, mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), mode='valid')
        slope = np.gradient(ls, tm)                         # d ln rpm / dt
        # loudness around each firing (two periods), and the tracker's confidence there
        rms = np.array([np.sqrt(np.mean(seg[max(0, p - int(SR / q)):p + int(SR / q)] ** 2) + 1e-12) for p, q in zip(mk, fm)])
        conf = np.interp(tm, t, sal)
        coh, half = coherence(seg, mk)
        load = part.get('load', 'free')                     # 'free' revving in neutral, 'drive' on the road
        cls = np.where(rpm < idle * 1.12, 0, np.where(slope > 0.12, 1, np.where(slope < -0.12, 2, 3)))
        out.append({'pos': mk + a, 'rpm': rpm, 'slope': slope, 'rms': rms, 'conf': conf, 'coh': coh, 'half': half, 'cls': cls, 'load': load, 'seg': (a, b),
                    'cohMin': st[4] if len(st) > 4 else part.get('cohMin', bank.get('cohMin', 0.6)),
                    # (two alike halves to a mark: the pitch an octave low; unless a bank marks pairs of firings)
                    'halfMax': part.get('halfMax', bank.get('halfMax', 0.45)),
                    'rMin': part.get('rMin', 0) * idle,
                    # (a pull kept whole: one long run, not a firing or two per rev band that would loop)
                    'keep': bool(part.get('keep')), 'chunkGood': part.get('chunkGood', 0.85)})
    return out


def anchor_marks(seg, anchors):
    """Marks a firing apart along a pitch traced by hand (the anchors): where the firings' phase, the traced pitch
    summed over time, passes each whole number; the whole train shifted to sit on the firing pulses as best it can
    (a noisy recording's pulses wander, one by one, more than its pitch does)."""
    at = np.array(anchors, float)
    tt = np.arange(len(seg)) / SR
    ff = np.exp(np.interp(tt, at[:, 0], np.log(at[:, 1])))
    ph = np.cumsum(ff) / SR
    from scipy.signal import butter, sosfiltfilt
    env = sosfiltfilt(butter(2, float(np.median(ff)) * 2.5, 'lowpass', fs=SR, output='sos'), seg)
    best, bv = None, -1e9
    for o in np.linspace(0, 1, 24, endpoint=False):
        mk = np.flatnonzero(np.diff(np.floor(ph + o)) > 0) + 1
        v = np.mean(env[mk]) if len(mk) else -1e9
        if v > bv: best, bv = mk, v
    return best.astype(np.int64)


def follow_marks(seg, t, f, sal, f_lo, f_hi, anchors):
    """Marks by following the waveform (track.follow), seeded about once a second where the coarse track is sure of
    itself (and at the anchors). At each seed the follower tries the tracked pitch, its double and its half for a
    moment and keeps the one whose firings repeat best; then it follows from there to the next seed."""
    seeds = list(anchors)
    for ts in np.arange(0.3, t[-1] - 0.3, 1.0):
        if any(abs(ts - a) < 0.5 for a, _ in seeds): continue
        j = int(np.argmin(np.abs(t - ts)))
        if sal[j] > 1.2: seeds.append((float(t[j]), float(f[j])))
    seeds.sort()
    out = []
    for i, (ts, fs) in enumerate(seeds):
        stop = seeds[i + 1][0] if i + 1 < len(seeds) else t[-1]
        best, bv = None, -1
        for mul in ((1,) if any(abs(ts - a) < 1e-6 for a, _ in anchors) else (1, 2, 0.5)):
            fc = fs * mul
            if not (f_lo * 0.9 <= fc <= f_hi * 1.1): continue
            a, b = int(max(0, ts - 0.05) * SR), int(min(len(seg) / SR, ts + 0.9) * SR)
            mk, sc = follow(seg[a:b], SR, [(ts - a / SR, fc)], f_lo * 0.9, f_hi * 1.1)
            if len(mk) < 6: continue
            coh, half = coherence(seg[a:b], mk)
            v = np.median(coh) - (0.5 if np.median(half) > 0.45 else 0)
            if v > bv: best, bv = fc, v
        if best is None: continue
        a = int(max(0, ts - 0.05) * SR)
        mk, sc = follow(seg, SR, [(ts, best)], f_lo * 0.9, f_hi * 1.1, t_end=stop + 0.05)
        out.extend(mk[mk >= int(ts * SR) - 2].tolist() if i else mk.tolist())
    if not out: return np.zeros(0, np.int64)
    out = np.unique(np.array(out, dtype=np.int64))
    keep = np.r_[True, np.diff(out) > 0.5 * SR / f_hi]
    return out[keep]


def choose(stretches, budget_s, idle_s, cyl=4, coh_min=0.6):
    """Cut the stretches into ~0.4 s chunks and keep the ones that add the most revs / class coverage, within budget."""
    chunks = []
    for si, s in enumerate(stretches):
        pos = s['pos']
        c0 = 0
        while c0 < len(pos) - 4:
            c1 = c0
            while c1 < len(pos) - 1 and pos[c1] - pos[c0] < 0.4 * SR: c1 += 1
            sel = slice(c0, c1 + 1)
            # only firings that repeat (the pitch tracked right: not an octave or a fifth off) and a clear track
            good = (s['conf'][sel] > 0.6) & (s['coh'][sel] > s['cohMin']) & (s['half'][sel] < s['halfMax']) & (s['rpm'][sel] >= s['rMin'])
            if good.mean() > s['chunkGood']:
                chunks.append({'s': si, 'a': c0, 'b': c1, 'r': s['rpm'][sel], 'cls': s['cls'][sel], 'dur': (pos[c1] - pos[c0]) / SR})
            c0 = c1
    if not chunks: return []
    # coverage cells: (log-rpm bin of 8%, class); each wants a fifth of a second of firings
    lo = min(np.min(c['r']) for c in chunks)
    def cells(c):
        bins = np.floor(np.log(c['r']) / 0.08).astype(int)
        out = {}
        for bn, cl in zip(bins, c['cls']): out[(bn, int(cl))] = out.get((bn, int(cl)), 0) + 1
        return out
    have, picked, total = {}, [], 0.0
    cand = [(c, cells(c)) for c in chunks]
    # idle first (it is what is heard the most): the steadiest stretch of it, in one piece
    idle = [i for i, (c, ce) in enumerate(cand) if np.mean(c['cls'] == 0) > 0.8]
    if idle:
        by_s = {}
        for i in idle: by_s.setdefault(cand[i][0]['s'], []).append(i)
        s_best = max(by_s, key=lambda k: len(by_s[k]))
        run = sorted(by_s[s_best], key=lambda i: cand[i][0]['a'])
        mid = len(run) // 2
        n = max(1, int(idle_s / 0.4))
        take = set(run[max(0, mid - n // 2):max(0, mid - n // 2) + n])
        for i in sorted(take, reverse=True):
            c, ce = cand.pop(i)
            for key, k in ce.items(): have[key] = have.get(key, 0) + k
            picked.append(c); total += c['dur']
    # the pulls kept whole (on top of the budget: the rest of the bank is chosen as it would be without them)
    for i in range(len(cand) - 1, -1, -1):
        if stretches[cand[i][0]['s']]['keep']:
            c, ce = cand.pop(i)
            for key, n in ce.items(): have[key] = have.get(key, 0) + n
            picked.append(c)
    # then the revs, accelerating, holding and slowing: what adds the most coverage per second, joined up where it can
    while cand and total < budget_s:
        best, bv = None, 0
        for i, (c, ce) in enumerate(cand):
            if np.mean(c['cls'] == 0) > 0.6: continue
            v = 0
            for key, n in ce.items():
                # share it fills of the firings wanted per cell (at that cell's revs); the low revs
                # count double (crawling is spent there)
                want = max(6.0, 0.2 * np.exp((key[0] + 0.5) * 0.08) * cyl / 120)
                v += max(0, min(n, want - have.get(key, 0))) / want * (2 if key[0] * 0.08 < np.log(lo) + 0.75 else 1)
            v /= max(c['dur'], 0.05) ** 0.3                    # (low revs fire slower: don't make them pay for it)
            if any(p['s'] == c['s'] and (p['b'] == c['a'] or p['a'] == c['b']) for p in picked): v *= 1.35
            if v > bv: best, bv = i, v
        if best is None or bv <= 0: break
        c, ce = cand.pop(best)
        for key, n in ce.items(): have[key] = have.get(key, 0) + n
        picked.append(c); total += c['dur']
    return picked


def ltas(x, spans):
    """Long-term average spectrum (dB, 1/3-octave smoothed) of the audio in the given sample spans."""
    from scipy.signal import welch
    acc, n = None, 0
    for a, b in spans:
        if b - a < 4096: continue
        f, p = welch(x[a:b], fs=SR, nperseg=4096)
        acc = p * (b - a) if acc is None else acc + p * (b - a); n += b - a
    if acc is None: return None, None
    p = acc / n
    sm = np.array([p[(f >= fc / 1.12) & (f <= fc * 1.12)].mean() if ((f >= fc / 1.12) & (f <= fc * 1.12)).any() else p[i]
                   for i, fc in enumerate(np.maximum(f, 20))])
    return f, 10 * np.log10(sm + 1e-20)


def match_donor(x_own, own_spans, x_don, don_spans):
    """The donor recording filtered (zero phase) so its average spectrum matches the bank's own near where they meet:
    the mics and the engines differ, the join shouldn't."""
    f, own = ltas(x_own, own_spans)
    _, don = ltas(x_don, don_spans)
    if own is None or don is None: return x_don
    gain = np.clip(own - don, -12, 12)
    gain -= np.median(gain[(f > 100) & (f < 4000)])            # shape only (levels are evened out per firing)
    gain[f < 30] = gain[np.argmax(f >= 30)]
    X = np.fft.rfft(x_don)
    fx = np.fft.rfftfreq(len(x_don), 1 / SR)
    X *= 10 ** (np.interp(fx, f, gain) / 20)
    return np.fft.irfft(X, len(x_don))


def highpass(x, part):
    """A recording with rumble under the engine's own note (a dyno's rollers): cut below part['hp'] Hz, zero phase."""
    if not part.get('hp'): return x
    from scipy.signal import butter, sosfiltfilt
    return sosfiltfilt(butter(4, part['hp'], 'highpass', fs=SR, output='sos'), x)


def build(cache, name, bank):
    stretches, x_of = [], {}
    for part in bank['parts']:
        x = highpass(fetch(cache, part), part)
        x_of[part['id']] = x
        for s in analyse(x, part, bank):
            s['part'] = part['id']
            s['donor'] = bool(part.get('rMin'))
            stretches.append(s)
    # donors: tone-matched to the bank's own recordings at the top of their revs
    own = [s for s in stretches if not s['donor']]
    if own and any(s['donor'] for s in stretches):
        # the bank's own recording that reaches highest, at the top of its revs
        ref = max(own, key=lambda s: np.max(s['rpm']))['part']
        mine = [s for s in own if s['part'] == ref]
        top = np.percentile(np.concatenate([s['rpm'] for s in mine]), 70)
        own_x = x_of[ref]
        own_spans = [(s['pos'][k] - 400, s['pos'][k] + 400) for s in mine for k in range(len(s['pos'])) if s['rpm'][k] >= top]
        for part in bank['parts']:
            if not part.get('rMin'): continue
            ds = [s for s in stretches if s['part'] == part['id']]
            lo = part['rMin'] * bank['idleRpm']
            don_spans = [(s['pos'][k] - 400, s['pos'][k] + 400) for s in ds for k in range(len(s['pos'])) if lo <= s['rpm'][k] <= lo * 1.5]
            x_of[part['id']] = highpass(match_donor(own_x, own_spans, x_of[part['id']], don_spans), part)
            # (the loudness of each firing, again, from the matched recording)
            xd = x_of[part['id']]
            for s in ds:
                fm = np.r_[SR / np.maximum(np.diff(s['pos']), 1), SR / max(1, s['pos'][-1] - s['pos'][-2])]
                s['rms'] = np.array([np.sqrt(np.mean(xd[max(0, p - int(SR / q)):p + int(SR / q)] ** 2) + 1e-12) for p, q in zip(s['pos'], fm)])
    picked = choose(stretches, bank.get('budget', 14), bank.get('idleBudget', 3.5), bank['cyl'], bank.get('cohMin', 0.6))
    # runs: neighbouring picked chunks of one stretch join up
    picked.sort(key=lambda c: (c['s'], c['a']))
    runs = []
    for c in picked:
        if runs and runs[-1]['s'] == c['s'] and runs[-1]['b'] >= c['a'] - 1: runs[-1]['b'] = max(runs[-1]['b'], c['b'])
        else: runs.append(dict(c))
    audio, M = [np.zeros(PAD)], {'pos': [], 'r': [], 'g': [], 'cls': [], 'run': []}
    off = PAD
    where = []
    for ri, rn in enumerate(runs):
        s = stretches[rn['s']]
        x = x_of[s['part']]
        pos = s['pos']
        a = max(0, pos[rn['a']] - int(SR * 0.06))
        b = min(len(x), pos[rn['b']] + int(SR * 0.06))
        where.append([s['part'], round(a / SR, 2), round(b / SR, 2), round(off / SR, 2)])
        chunk = x[a:b].copy()
        w = int(SR * 0.01)
        chunk[:w] *= np.linspace(0, 1, w); chunk[-w:] *= np.linspace(1, 0, w)
        audio.append(chunk); audio.append(np.zeros(PAD))
        # the first and last firing of a run are context only (their neighbours bound the windows)
        for k in range(rn['a'] + 1, rn['b']):
            M['pos'].append(off + pos[k] - a)
            M['r'].append(s['rpm'][k] / bank['idleRpm'])
            M['cls'].append(int(s['cls'][k]) | (4 if s['load'] == 'drive' else 0))
            M['run'].append(ri)
            M['g'].append(s['rms'][k])
        off += len(chunk) + PAD
    if not M['pos']:
        print(f'{name:10} nothing usable (no stretch passed the checks)')
        return []
    data = np.concatenate(audio)
    # level: each firing evened out against the loudness of its neighbourhood (80%: a little natural lope stays)
    g = np.array(M['g']); run = np.array(M['run'])
    env = np.zeros_like(g)
    for ri in np.unique(run):
        k = run == ri
        v = g[k]
        n = max(1, min(len(v) // 2, 9))
        env[k] = np.convolve(np.pad(v, n, mode='edge'), np.ones(2 * n + 1) / (2 * n + 1), mode='valid')
    ref = np.median(env)
    gain = (ref / np.maximum(env, 1e-9)) ** 0.8
    peak = np.max(np.abs(data)) or 1
    q = np.clip(data / peak * 0.97 * 32767, -32767, 32767).astype('<i2')
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f'{name}.grains.wav'), 'wb') as wv:
        wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR); wv.writeframes(q.tobytes())
    b64 = lambda arr, dt: base64.b64encode(np.asarray(arr, dtype=dt).tobytes()).decode()
    import hashlib
    meta = {
        'ver': hashlib.sha1(q.tobytes()).hexdigest()[:10],          # (the audio's version: the game asks for this one)
        'sr': SR, 'cyl': bank['cyl'], 'idleRpm': bank['idleRpm'], 'n': len(M['pos']),
        # (marks per engine cycle are 'cyl'; the engine recorded may fire more often: a V10's bank marks every pair
        # of firings, one from each bank of cylinders, as its sound repeats)
        **({'engineCyl': bank['engineCyl']} if bank.get('engineCyl') else {}),
        'pos': b64(M['pos'], '<i4'), 'r': b64(np.round(M['r'], 4), '<f4'), 'g': b64(np.round(gain * ref / peak * 3, 4), '<f4'),
        'cls': b64(M['cls'], 'u1'), 'run': b64(M['run'], '<u2'),
        'runs': where,                                     # [recording id, from s, to s, at s in the bank]
    }
    json.dump(meta, open(os.path.join(OUT, f'{name}.grains.json'), 'w'), separators=(',', ':'))
    r = np.array(M['r']); cl = np.array(M['cls']) & 3
    cov = ' '.join(f"{lab}:{(cl == c).sum()}({np.percentile(r[cl == c], 5):.2f}-{np.percentile(r[cl == c], 95):.2f})" for c, lab in enumerate(['idle', 'on', 'off', 'hold']) if (cl == c).any())
    print(f'{name:10} {len(data) / SR:5.1f}s {os.path.getsize(os.path.join(OUT, name + ".grains.wav")) // 1024:5} KB  {len(runs)} runs  {len(r)} firings  {cov}')
    return [(p, license_of(cache, p)) for p in bank['parts']]


FALLBACK = [   # the recorded loops (from NIGHTSHIFT) the game falls back to without AudioWorklet
    ('v8_muscle', {'id': 232272, 'user': 'wikusv', 'title': 'Idle and Rev - Engine.wav', 'lic': 'CC-BY'}),
    ('i6_bmw', {'id': 415276, 'user': 'ikbenraar', 'title': 'BMWM3_01.wav', 'lic': 'CC-BY'}),
]


def write_credits(cache, src):
    """public/assets/audio/CREDITS.md: every recording the banks are cut from, with its licence."""
    lines = ['# Sound credits', '',
             'Engine recordings from [Freesound](https://freesound.org), used under their licences. Each engine bank is cut',
             'into single firings (tools/sounds/build_grains.py) that the game plays back at its own engine\'s revs',
             '(src/audio/engine-worklet.js); recordings from another engine fill the rev range where the bank\'s own stop,',
             'filtered to match it.', '']
    for name, bank in src['banks'].items():
        lines.append(f"- Bank `{name}` ({bank.get('about', '')}):")
        seen = set()
        for part in bank['parts']:
            if part['id'] in seen: continue                 # (one recording cut two ways is one credit)
            seen.add(part['id'])
            fetch(cache, part)
            ln, lu = license_of(cache, part)
            role = f" ({part.get('role', 'the top of the revs')})" if part.get('rMin') else ''
            lines.append(f"  - \"{part['title']}\" by {part['user']}, https://freesound.org/s/{part['id']}/ ({ln}, {lu}){role}")
    lines += ['', 'Fallback engine loops (browsers without AudioWorklet), cut at six rpm points for NIGHTSHIFT and reused here:']
    for name, part in FALLBACK:
        fetch(cache, part)
        ln, lu = license_of(cache, part)
        lines.append(f"- `{name}`: \"{part['title']}\" by {part['user']}, https://freesound.org/s/{part['id']}/ ({ln}, {lu}), trimmed.")
    lines += ['', 'All other sounds (the starter, turbo, gear whine, tyres, gravel, mud, water, wind, knocks, the winch, birds) are',
              'synthesised in the browser.', '']
    open(os.path.join(ROOT, 'public', 'assets', 'audio', 'CREDITS.md'), 'w').write('\n'.join(lines))


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    src = json.load(open(os.path.join(HERE, 'sources.json')))
    names = sys.argv[2:] or list(src['banks'])
    for name in names:
        build(cache, name, src['banks'][name])
    write_credits(cache, src)


if __name__ == '__main__':
    main()
