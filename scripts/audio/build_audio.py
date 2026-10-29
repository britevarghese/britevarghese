# Builds client/assets/audio (packed sets + sounds.json) from the CC0 / public-domain recordings listed in
# client/assets/audio/README.md.   python3 scripts/audio/fetch_sources.py <src>   then
#   python3 scripts/audio/build_audio.py <src> client/assets/audio      (needs ffmpeg, numpy, scipy)
# <src> holds: 'ffsl/Prepared SFX Library/' (The Free Firearm Sound Library, extracted), dl_fs/<freesound id>_*.mp3,
# dl_oga/ (zer0_sol reload.wav, BMacZero clipload*.wav, rubberduck pack in dl_oga/breaking/).
# Gunshots + mechanical foley -> 32 kHz mono 16-bit WAV (sample-accurate onsets); footsteps / impacts / casings /
# explosions / handling -> 44.1 kHz mono MP3 (VBR). Prints a summary (durations, hit offsets, levels).
import sys, os, json, subprocess, functools
from fractions import Fraction
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, sfx
from scipy.signal import resample_poly, butter, sosfilt

S = sys.argv[1]; OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
FF = os.path.join(S, 'ffsl', 'Prepared SFX Library')
FS = os.path.join(S, 'dl_fs'); OGA = os.path.join(S, 'dl_oga')
fsf = {f.split('_')[0]: os.path.join(FS, f) for f in os.listdir(FS) if f.endswith('.mp3')}
summary = {}; levels = {}

def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
def hp(x, sr, f, order=2): return sosfilt(butter(order, f, 'high', fs=sr, output='sos'), x)
def lp(x, sr, f, order=2): return sosfilt(butter(order, f, 'low', fs=sr, output='sos'), x)

def shelf(x, sr, f0, gain_db, kind='low', S_=0.8):
    # RBJ cookbook shelving biquad
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / sr; cw, sw = np.cos(w0), np.sin(w0)
    al = sw / 2 * np.sqrt((A + 1 / A) * (1 / S_ - 1) + 2); k = 2 * np.sqrt(A) * al
    if kind == 'low':
        b = [A * ((A + 1) - (A - 1) * cw + k), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - k)]
        a = [(A + 1) + (A - 1) * cw + k, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - k]
    else:
        b = [A * ((A + 1) + (A - 1) * cw + k), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - k)]
        a = [(A + 1) - (A - 1) * cw + k, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - k]
    sos = np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1, a[1] / a[0], a[2] / a[0]]])
    return sosfilt(sos, x)

def peaking(x, sr, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / sr; al = np.sin(w0) / (2 * q); cw = np.cos(w0)
    b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]
    return sosfilt(np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1, a[1] / a[0], a[2] / a[0]]]), x)

def resamp(x, sr_in, sr_out, rate=1.0):
    """resample sr_in -> sr_out while playing `rate` times faster (rate<1: lower + longer, tape-style)"""
    fr = Fraction(sr_out, 1) / Fraction(sr_in, 1) / Fraction(rate).limit_denominator(200)
    fr = fr.limit_denominator(2000)
    return resample_poly(x, fr.numerator, fr.denominator)

def tail_fade(x, sr, frac=0.35, fin=0.0005):
    n = len(x); b = int(n * frac); a = max(1, int(sr * fin)); x = x.copy()
    x[:a] *= np.linspace(0, 1, a); x[-b:] *= np.linspace(1, 0, b) ** 2
    return x

def hit_offset(x, sr, k=0.5):
    return float(np.argmax(np.abs(x) >= k * np.max(np.abs(x))) / sr)

def loud(x, sr, win=0.03):
    n = max(1, int(sr * win)); c = np.convolve(x ** 2, np.ones(n) / n, 'valid')
    return 10 * np.log10(np.max(c) + 1e-12)

def write_wav(name, x, sr, peak=-1.0):
    p = os.path.join(OUT, name + '.wav'); sfx.save(p, x, sr, peak); return p

def write_mp3(name, x, sr, peak=-1.0, q=4):
    tmp = os.path.join(OUT, '_tmp.wav'); sfx.save(tmp, x, sr, peak)
    p = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-ac', '1', '-ar', str(sr), '-c:a', 'libmp3lame', '-q:a', str(q), p], check=True)
    os.remove(tmp); return p

# Every set (all takes of one sound) is packed into ONE file: takes back to back with GAP s of silence, the
# manifest stores [start, duration, hit] per take. Fewer requests, and tiny MP3s (< ~0.15 s) don't decode reliably.
# The gap also absorbs an MP3 decoder delay that a browser might not trim (slices are cut with a 60 ms tail).
GAP = 0.1
PACK = {}
def put(group, name, x, sr, fmt='wav', hit=None, peak=-1.0):
    x = np.asarray(x, dtype=np.float64)
    if peak is not None: x = x * (10 ** (peak / 20) / (np.max(np.abs(x)) + 1e-12))
    p = PACK.setdefault(group, {'sr': sr, 'fmt': fmt, 'takes': []})
    assert p['sr'] == sr and p['fmt'] == fmt, group
    p['takes'].append((x, hit))

def flush():
    for g, p in PACK.items():
        sr = p['sr']; parts = []; takes = []; pos = 0
        for x, hit in p['takes']:
            takes.append([round(pos / sr, 4), round(len(x) / sr, 4)] + ([round(hit, 3)] if hit is not None else []))
            parts += [x, np.zeros(int(GAP * sr))]; pos += len(x) + int(GAP * sr)
        y = np.concatenate(parts)
        path = write_wav(g, y, sr, None) if p['fmt'] == 'wav' else write_mp3(g, y * 10 ** (-0.5 / 20), sr, None)
        summary[g] = {'f': os.path.basename(path), 'kb': round(os.path.getsize(path) / 1024, 1), 't': takes}

@functools.lru_cache(None)
def stereo96(rel):
    return sfx.load(os.path.join(FF, rel), 96000, 'stereo')

# ---------------------------------------------------------------- gunshots
SRG = 32000
def gun_take(rel, t, ch, length, rate=1.0):
    X = stereo96(rel)[:, ch]; R = 96000
    w0 = int((t - 0.1) * R); w = X[w0:int((t + 0.3) * R)]
    on = w0 + int(np.argmax(np.abs(w) > 0.2 * np.max(np.abs(w))))
    a = on - int(0.004 * R)
    seg = X[a:a + int(length * rate * R)]
    y = resamp(seg, R, SRG, rate)
    return hp(y, SRG, 25)

def norm_set(takes, sr, punch_win=0.15):
    """equal punch (RMS of the first 150 ms) across takes, then the set's loudest peak at -1 dBFS"""
    out = [y * 10 ** ((-12 - rms_db(y[:int(sr * punch_win)])) / 20) for y in takes]
    m = max(np.max(np.abs(y)) for y in out); g = 10 ** (-1 / 20) / m
    return [y * g for y in out]

def gunset(name, specs, length, rate=1.0, post=None):
    takes = []
    for rel, t, ch in specs:
        y = gun_take(rel, t, ch, length, rate)
        if post: y = hp(post(y), SRG, 32, 2) # processing can push energy below the audible band
        takes.append(tail_fade(y, SRG))
    takes = norm_set(takes, SRG)
    for i, y in enumerate(takes): put(name, f'{name}_{i}', y, SRG, 'wav', peak=None)
    levels[name] = round(float(np.mean([rms_db(y[:int(SRG * 0.15)]) for y in takes])), 2)

AR_N, AR_M = 'AR-15/D_32P.wav', 'AR-15/D_24P.wav'
MO_N, MO_M = 'Mosin Nagant/M_21P.wav', 'Mosin Nagant/M_26P.wav'
PQ_N, PQ_M = 'Walther PPQ/X_39P.wav', 'Walther PPQ/X_31P.wav'
# near: mics left/right of the shooter (first person); mid: forward/back mics further out (distant soldiers).
# Each stereo channel is a separate microphone (inter-channel correlation ~0), so it is used as its own take.
gunset('ar_near', [(AR_N, 0.70, 0), (AR_N, 0.70, 1), (AR_N, 5.65, 0), (AR_N, 5.65, 1)], 1.4)
gunset('ar_far', [(AR_M, 0.55, 0), (AR_M, 0.55, 1), (AR_M, 3.91, 0), (AR_M, 3.91, 1)], 1.9)
gunset('sniper_near', [(MO_N, 1.03, 0), (MO_N, 5.02, 1), (MO_N, 9.16, 0), (MO_N, 14.14, 1), (MO_N, 5.02, 0)], 2.0)
gunset('sniper_far', [(MO_M, 1.14, 0), (MO_M, 6.10, 1), (MO_M, 10.74, 0), (MO_M, 1.14, 1)], 2.4)
gunset('pistol_near', [(PQ_N, 1.40, 0), (PQ_N, 6.44, 1), (PQ_N, 10.66, 0), (PQ_N, 1.40, 1)], 1.2)
gunset('pistol_far', [(PQ_M, 1.08, 0), (PQ_M, 1.08, 1), (PQ_M, 5.24, 0), (PQ_M, 5.24, 1)], 1.6)

def thump(n, sr, f0, f1, dur, att=0.002):
    t = np.arange(n) / sr
    f = f0 * (f1 / f0) ** np.minimum(1, t / dur)
    ph = 2 * np.pi * np.cumsum(f) / sr
    env = np.minimum(1, t / att) * np.exp(-t / (dur / 4))
    return np.sin(ph) * env

def sat(y, k):
    return np.tanh(k * y / np.max(np.abs(y))) / np.tanh(k) * np.max(np.abs(y))

# .50 cal M2 on the jeep: .30-06 (Springfield 1917, Tikka) shots slowed to 0.80 (deeper, longer report), the
# low band of the same shot slowed again for a heavy body, slight saturation, low shelf
def m2_post(y):
    body = resamp(lp(y, SRG, 200, 4), SRG, SRG, 0.7)[:len(y)]
    body = np.pad(body, (0, len(y) - len(body))) * (BODY * np.max(np.abs(y)) / (np.max(np.abs(lp(y, SRG, 200, 4))) + 1e-9))
    z = sat(y + body, 1.4)
    z = shelf(z, SRG, 150, 3, 'low'); z = shelf(z, SRG, 7000, -3, 'high')
    return z
BODY = 0.25
gunset('m2', [('1917/B_24P.wav', 1.31, 0), ('1917/B_24P.wav', 6.73, 1), ('Tikka/W_29P.wav', 0.57, 0), ('Tikka/W_29P.wav', 5.66, 1)], 1.6, 0.82, m2_post)

# coaxial 7.62x51 tank MG: AK-47 (7.62x39) near shots a little lower and fuller
def mg_post(y): return shelf(peaking(y, SRG, 180, 2.5, 0.9), SRG, 9000, -2, 'high')
gunset('mg762', [('AK-47/C_28P.wav', 0.61, 0), ('AK-47/C_28P.wav', 3.26, 1), ('AK-47/C_28P.wav', 6.02, 0), ('AK-47/C_28P.wav', 9.16, 1)], 1.4, 0.93, mg_post)

# 30 mm helicopter chain gun: 12-gauge shotgun blasts (big low-pressure boom, little supersonic crack) slowed to
# 0.58, a pitched-down sine thump for the chest-hit body, softened top end
def c30_post(y):
    th = thump(len(y), SRG, 75, 38, 0.3) * np.max(np.abs(y)) * THUMP
    z = sat(y, 1.3) + th
    z = peaking(shelf(z, SRG, 140, 2, 'low'), SRG, 300, 3, 0.8); z = lp(z, SRG, 7500)
    return z
THUMP = 0.07
gunset('c30', [('CD/H_21P.wav', 0.46, 0), ('CD/H_21P.wav', 3.07, 1), ('Model 12/K_22P.wav', 0.84, 0), ('Model 12/K_22P.wav', 7.44, 1)], 1.8, 0.7, c30_post)

# ---------------------------------------------------------------- recorded explosions (US DoD b-roll, public domain)
SRE = 44100
def ex_take(sid, t0, t1, rate=1.0, hpf=30):
    x = sfx.load(fsf[sid], SRE, None, t0, t1 - t0)
    x = resamp(x, SRE, SRE, rate) if rate != 1.0 else x
    x = hp(x, SRE, hpf)
    x = sfx.trim_tail(x, SRE, -48)
    return tail_fade(x, SRE, 0.3, 0.001)
for i, (sid, a, b) in enumerate([('855798', 0.0, 1.71), ('855893', 0.0, 1.78), ('855898', 0.0, 1.23), ('182429', 0.0, 2.2), ('182431', 0.0, 1.4)]):
    y = ex_take(sid, a, b)
    put('expl', f'expl_{i}', y, SRE, 'mp3')
# 120 mm tank gun: blast + shock wave rolling back (EOD charge, slowed a little for size)
for i, (sid, a, b, r) in enumerate([('855896', 0.0, 3.1, 0.85), ('855893', 0.0, 1.78, 0.72)]):
    put('cannon', f'cannon_{i}', ex_take(sid, a, b, r), SRE, 'mp3')

# ---------------------------------------------------------------- mechanical foley (gun handling)
SRF = 32000
def fol(name, src, t0, t1, hpf=70, rate=1.0, gain_db=0.0, group=None, fmt='wav', sr=SRF, lpf=None):
    path = fsf.get(src) or os.path.join(OGA, src)
    x = sfx.load(path, sr, None, t0, t1 - t0)
    if rate != 1.0: x = resamp(x, sr, sr, rate)
    x = hp(x, sr, hpf)
    if lpf: x = lp(x, sr, lpf)
    x = sfx.trim_tail(x, sr, -50)
    x = tail_fade(x, sr, 0.3, 0.002)
    put(group or name.rsplit('_', 1)[0], name, x, sr, fmt, hit=hit_offset(x, sr), peak=-1.0 + gain_db)

# AR-15: magazine release + drop (wadaltmon, real AR-15), magazine seated, bolt carrier slamming home
fol('ar_magout_0', '263513', 0.225, 0.62); fol('ar_magout_1', '263513', 2.245, 2.62)
fol('ar_magin_0', '263513', 1.545, 1.95); fol('ar_magin_1', '263513', 2.855, 3.25); fol('ar_magin_2', '427599', 2.005, 2.42)
fol('ar_bolt_0', '263513', 3.645, 4.05); fol('ar_bolt_1', '427599', 4.265, 4.7)
# 9 mm pistol: mag drop, mag in, slide slamming forward (zer0_sol handgun reload, michorvath 9 mm, baconandbeans)
fol('pistol_magout_0', 'reload.wav', 0.08, 0.42)
fol('pistol_magin_0', 'reload.wav', 0.56, 0.98); fol('pistol_magin_1', '427593', 0.545, 0.9)
fol('pistol_slide_0', '427593', 1.695, 2.05); fol('pistol_slide_1', '609668', 4.43, 4.8); fol('pistol_slide_2', 'reload.wav', 1.09, 1.5)
# Mosin-Nagant bolt cycle (Zott820): handle up, bolt back, bolt forward, handle down — 4 cycles each
for i, (u, b_, f, d) in enumerate([(1.926, 2.249, 2.556, 2.855), (5.798, 6.133, 6.476, 6.855), (7.664, 8.003, 8.358, 8.725), (9.436, 9.839, 10.170, 10.465)]):
    for nm, t in (('up', u), ('back', b_), ('fwd', f), ('down', d)):
        fol(f'bolt_{nm}_{i}', '370345', t - 0.03, t + 0.22, group=f'bolt_{nm}')
# stripper clip pushed into the magazine (BMacZero)
fol('clip_0', 'clipload1.wav', 0.0, 0.26); fol('clip_1', 'clipload2.wav', 0.0, 0.21)
# dry fire: Glock 17 / Taurus G2c trigger (9 mm), Ruger 10/22 hammer fall (rifle)
fol('dry_pistol_0', '842748', 0.0, 0.25); fol('dry_pistol_1', '589848', 0.09, 0.45)
fol('dry_rifle_0', '725402', 0.0, 0.5); fol('dry_rifle_1', '589848', 1.88, 2.2, rate=0.9)

# handling: weapon drawn / shouldered (rifle + pistol handling, sling and cloth), as MP3
fol('draw_rifle_0', '725403', 0.56, 1.2, fmt='mp3', sr=44100, group='draw_rifle')
fol('draw_rifle_1', '725403', 1.76, 2.7, fmt='mp3', sr=44100, group='draw_rifle')
fol('draw_rifle_2', '701049', 9.75, 10.5, fmt='mp3', sr=44100, group='draw_rifle')
fol('draw_rifle_3', '701049', 13.98, 14.6, fmt='mp3', sr=44100, group='draw_rifle')
fol('draw_pistol_0', '725400', 1.38, 2.05, fmt='mp3', sr=44100, group='draw_pistol')
fol('draw_pistol_1', '725400', 2.12, 2.45, fmt='mp3', sr=44100, group='draw_pistol')
# grenade: pin pull (F3ather), spoon flying off (nicktermer), throw whoosh (IENBA rope swing)
fol('nade_pin_0', '725813', 1.03, 1.55, fmt='mp3', sr=44100, group='nade_pin')
fol('nade_pin_1', '725813', 11.36, 11.75, fmt='mp3', sr=44100, group='nade_pin')
fol('nade_spoon_0', '259553', 0.14, 0.95, fmt='mp3', sr=44100, group='nade_spoon')
fol('nade_throw_0', '875462', 0.02, 0.6, fmt='mp3', sr=44100, group='nade_throw')
fol('nade_throw_1', '875462', 1.0, 1.6, fmt='mp3', sr=44100, group='nade_throw')
fol('nade_throw_2', '875462', 3.95, 4.55, fmt='mp3', sr=44100, group='nade_throw')

# grenade body clunking off the ground (rubberduck metal hits, a little lower)
fol('nade_bounce_0', 'breaking/bfh1_metal_hit_01.ogg', 0, 0.24, rate=0.8, fmt='mp3', sr=44100, group='nade_bounce')
fol('nade_bounce_1', 'breaking/bfh1_metal_hit_03.ogg', 0, 0.46, rate=0.8, fmt='mp3', sr=44100, group='nade_bounce')

# ---------------------------------------------------------------- footsteps (boots), MP3
SRS = 44100
def steps(surf, items, L=0.34, hpf=60, lpf=None):
    takes = []
    for src, t in items:
        x = sfx.load(fsf[src], SRS, None, max(0, t - 0.012), L + 0.012)
        x = hp(x, SRS, hpf)
        if lpf: x = lp(x, SRS, lpf)
        x = sfx.trim_tail(x, SRS, -45)
        takes.append(tail_fade(x, SRS, 0.5, 0.002))
    # equal loudness (loudest 30 ms) across the set, set peak at -1 dBFS
    ref = np.median([loud(y, SRS) for y in takes])
    takes = [y * 10 ** ((ref - loud(y, SRS)) / 20) for y in takes]
    m = max(np.max(np.abs(y)) for y in takes); takes = [y * 10 ** (-1 / 20) / m for y in takes]
    for i, y in enumerate(takes): put('step_' + surf, f'step_{surf}_{i}', y, SRS, 'mp3', peak=None)
steps('grass', [('521587', t) for t in (0.104, 0.802, 1.493, 2.279, 3.057, 3.795)], 0.42)
steps('dirt', [('521588', t) for t in (0.100, 0.858, 1.564, 2.235)] + [('556002', t) for t in (0.483, 1.62, 3.732, 4.789, 5.891, 7.04)], 0.4)
steps('concrete', [('521590', t) for t in (0.100, 0.694, 1.257, 1.812, 2.399, 3.017)] + [('813622', t) for t in (0.036, 1.046, 3.46)], 0.3)
steps('wood', [('150444', t) for t in (0.307, 1.872, 2.650, 4.278, 5.839, 6.685, 8.325, 9.179)], 0.3, hpf=110)
steps('metal', [('834029', t) for t in (0.603, 1.117, 1.644, 2.199, 3.273, 3.783, 4.993)], 0.4, hpf=80)

# ---------------------------------------------------------------- bullet impacts / ricochets / casings, MP3
def imp(group, items, hpf=80, lpf=None, L=None):
    takes = []
    for i, (src, t0, t1) in enumerate(items):
        path = fsf.get(src) or os.path.join(OGA, 'breaking', src)
        x = sfx.load(path, SRS, None, t0, t1 - t0)
        x = hp(x, SRS, hpf, 2)
        if lpf: x = lp(x, SRS, lpf)
        x = sfx.trim_tail(x, SRS, -48)
        takes.append(tail_fade(x, SRS, 0.4, 0.001))
    # takes from different recordings: equal loudness (loudest 30 ms) across the set, then the set peak at -1 dBFS
    ref = np.median([loud(y, SRS) for y in takes])
    takes = [y * 10 ** ((ref - loud(y, SRS)) / 20) for y in takes]
    m = max(np.max(np.abs(y)) for y in takes)
    for i, y in enumerate(takes): put(group, f'{group}_{i}', y * 10 ** (-1 / 20) / m, SRS, 'mp3', peak=None)
imp('imp_metal', [('182263', 0.09, 0.6), ('182263', 2.66, 3.1), ('182263', 4.44, 4.9), ('182263', 7.26, 7.7), ('bfh1_metal_hit_02.ogg', 0, 0.45)], 120)
imp('imp_concrete', [('161001', 1.405, 1.75), ('161001', 3.385, 3.75), ('161001', 4.545, 4.9), ('161001', 5.895, 6.25), ('bfh1_rock_hit_01.ogg', 0, 0.13)], 250)
imp('imp_dirt', [('319222', 0.29, 0.75), ('319222', 0.82, 1.3), ('319229', 0.64, 1.1)], 60)
imp('imp_wood', [('319223', 0, 0.13), ('319226', 0.14, 0.38), ('319228', 0.06, 0.27), ('bfh1_wood_hit_01.ogg', 0, 0.25)], 90)
imp('imp_glass', [('bfh1_glass_hit_01.ogg', 0, 0.3), ('bfh1_glass_hit_02.ogg', 0, 0.33)], 300)
imp('imp_flesh', [('138481', 0, 0.22), ('423301', 1.19, 1.38), ('423301', 1.89, 2.08)], 90, 7000)
imp('ricochet', [('148840', 0.01, 0.42), ('148840', 0.42, 0.84), ('148840', 0.835, 1.34), ('148840', 1.345, 1.78)], 400)
imp('glass_break', [('bfh1_glass_breaking_01.ogg', 0, 0.76), ('bfh1_glass_breaking_02.ogg', 0, 0.39)], 200)
# spent brass bouncing: on concrete (GrayJoy), tile (GryffDavid, shooting-range casings), wood desk (Danwardvs)
imp('brass_hard', [('210102', 2.31, 2.95), ('210102', 4.08, 4.6), ('210102', 7.62, 8.0), ('318964', 0.08, 0.75), ('318964', 4.48, 5.15), ('318964', 11.17, 11.95)], 300)
imp('brass_wood', [('205126', 0.44, 1.3), ('205126', 2.88, 3.7), ('205126', 7.06, 7.9)], 250)

flush()
# runtime manifest: set -> [file, [[start, dur, hit?], ...]]
json.dump({g: [v['f'], v['t']] for g, v in summary.items()}, open(os.path.join(OUT, 'sounds.json'), 'w'), separators=(',', ':'))
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(('.wav', '.mp3', '.json')))
for g, v in summary.items(): print(g.ljust(14), v['f'].ljust(18), f"{v['kb']:7.1f} KB", ' '.join(f"{t[1]}" + (f"@{t[2]}" if len(t) > 2 else '') for t in v['t']))
print('punch dB (first 150 ms RMS):', levels)
print('TOTAL', round(tot / 1024 / 1024, 2), 'MB in', len([f for f in os.listdir(OUT) if f.endswith(('.wav', '.mp3', '.json'))]), 'files')
