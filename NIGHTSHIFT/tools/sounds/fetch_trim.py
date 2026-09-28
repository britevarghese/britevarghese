#!/usr/bin/env python3
# Downloads the Freesound previews listed in sources.json (128 kbps MP3), trims the engine recordings to
# their revving part by cutting whole MP3 frames (no re-encoding), copies the SFX files, and writes the
# credits. Usage: python3 tools/sounds/fetch_trim.py   (downloads are cached in .cache/sounds)
import json, os, re, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = json.load(open(os.path.join(ROOT, 'tools/sounds/sources.json')))
CACHE = os.path.join(ROOT, '.cache/sounds')
OUT = os.path.join(ROOT, 'public/assets/audio')
os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.join(OUT, 'engines'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'sfx'), exist_ok=True)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'nightshift-sound-import'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def page(item):
    p = os.path.join(CACHE, f"{item['id']}.html")
    if not os.path.exists(p):
        open(p, 'wb').write(get(f"https://freesound.org/people/{item['user']}/sounds/{item['id']}/"))
    return open(p, encoding='utf-8', errors='ignore').read()

def fetch(item):
    p = os.path.join(CACHE, f"{item['id']}.mp3")
    if not os.path.exists(p):
        html = page(item)
        m = re.search(r'data-mp3="([^"]+)"', html)
        url = m.group(1).replace('-lq.mp3', '-hq.mp3')
        open(p, 'wb').write(get(url))
    return p

def license_of(item):
    if item['lic'] == 'CC0':
        return 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'
    m = re.search(r'creativecommons.org/licenses/by/([0-9.]+)', page(item))
    v = m.group(1) if m else '4.0'
    return f'CC BY {v}', f'https://creativecommons.org/licenses/by/{v}/'

# ---- MPEG-1/2 layer III frame walker
BR = {1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]}
SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
def frames(data):
    i = 0
    if data[:3] == b'ID3':
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        i = 10 + size
    out = []
    while i + 4 <= len(data):
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1; continue
        ver = (data[i + 1] >> 3) & 3; layer = (data[i + 1] >> 1) & 3
        bri = (data[i + 2] >> 4) & 15; sri = (data[i + 2] >> 2) & 3; pad = (data[i + 2] >> 1) & 1
        if layer != 1 or bri in (0, 15) or sri == 3 or ver == 1:
            i += 1; continue
        br = BR[1 if ver == 3 else 2][bri] * 1000; sr = SR[ver][sri]
        spf = 1152 if ver == 3 else 576
        ln = (144 if ver == 3 else 72) * br // sr + pad
        out.append((i, ln, sr, spf))
        i += ln
    return out

def trim(src, dst, t0, t1):
    data = open(src, 'rb').read()
    fr = frames(data)
    if not fr: raise RuntimeError('no mp3 frames in ' + src)
    sr, spf = fr[0][2], fr[0][3]
    # keep one extra frame each side (bit reservoir warm-up), skip a Xing/LAME info frame at the start
    a = max(1, int(t0 * sr / spf) - 1); b = min(len(fr), int(t1 * sr / spf) + 2)
    open(dst, 'wb').write(b''.join(data[o:o + l] for o, l, _, _ in fr[a:b]))
    return (b - a) * spf / sr

credits = ['# Sound credits', '', 'Recorded sounds from [Freesound](https://freesound.org), used under their licenses. Engine recordings were trimmed; the game plays them through a granular engine (pitch and position follow the rpm), and SFX clips are cut from the files listed.', '']
for e in SRC['engines']:
    src = fetch(e)
    dur = trim(src, os.path.join(OUT, 'engines', e['name'] + '.mp3'), *e['t'])
    ln, lu = license_of(e)
    credits.append(f"- Engine `{e['name']}`: \"{e['title']}\" by {e['user']}, https://freesound.org/s/{e['id']}/ ({ln}, {lu}), trimmed.")
    print(f"engine {e['name']:14} {dur:5.1f}s {os.path.getsize(os.path.join(OUT, 'engines', e['name'] + '.mp3')) // 1024} KB  {ln}")
credits.append('')
for s in SRC['sfx']:
    src = fetch(s)
    open(os.path.join(OUT, 'sfx', f"{s['id']}.mp3"), 'wb').write(open(src, 'rb').read())
    ln, lu = license_of(s)
    credits.append(f"- SFX ({', '.join(s['clips'].keys())}): \"{s['title']}\" by {s['user']}, https://freesound.org/s/{s['id']}/ ({ln}, {lu}), clips cut.")
    print(f"sfx {s['id']:>7} {os.path.getsize(src) // 1024} KB  {ln}  {s['title'][:40]}")
open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(credits) + '\n')
