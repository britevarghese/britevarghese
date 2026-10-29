#!/usr/bin/env python3
# Downloads the recordings build_audio.py works from into <src> (see client/assets/audio/README.md for credits).
# Freesound: the page is fetched and its licence must be CC0, then the HQ preview is saved as dl_fs/<id>_<title>.mp3.
# The Free Firearm Sound Library (194 MB .7z) is only downloaded; extract it to '<src>/ffsl/' (7z x / py7zr).
#   python3 scripts/audio/fetch_sources.py <src>
import sys, os, re, html, json, subprocess, time

SRC = sys.argv[1]
FREESOUND = [
    'wadaltmon/sounds/263513', 'michorvath/sounds/427599', 'michorvath/sounds/427593', 'baconandbeans/sounds/609668',
    'Zott820/sounds/370345', 'qubodup/sounds/842748', 'NoonerBear/sounds/589848', 'ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725402',
    'ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725403', 'Kohnn/sounds/701049', 'ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725400',
    'F3ather/sounds/725813', 'nicktermer/sounds/259553', 'IENBA/sounds/875462', 'Fission9/sounds/521587', 'Fission9/sounds/521588',
    'Nox_Sound/sounds/556002', 'Fission9/sounds/521590', 'SecureSubset/sounds/813622', 'SpliceSound/sounds/150444', 'IENBA/sounds/834029',
    'martian/sounds/182263', 'deleted_user_1371021/sounds/161001', 'worthahep88/sounds/319222', 'worthahep88/sounds/319229',
    'worthahep88/sounds/319223', 'worthahep88/sounds/319226', 'worthahep88/sounds/319228', 'JustInvoke/sounds/138481',
    'u1769092/sounds/423301', 'cedarstudios/sounds/148840', 'GrayJoy/sounds/210102', 'GryffDavid/sounds/318964', 'Danwardvs/sounds/205126',
    'qubodup/sounds/855798', 'qubodup/sounds/855893', 'qubodup/sounds/855898', 'qubodup/sounds/182429', 'qubodup/sounds/182431',
    'qubodup/sounds/855896',
]
OGA = [  # all CC0
    'https://opengameart.org/sites/default/files/reload.wav',  # zer0_sol, Handgun Reload Sound Effect
    'https://opengameart.org/sites/default/files/clipload1.wav', 'https://opengameart.org/sites/default/files/clipload2.wav',  # BMacZero
    'https://opengameart.org/sites/default/files/sfx_breaking_and_falling.zip',  # rubberduck, 75 CC0 breaking / falling / hit sfx
]
FFSL = 'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z'

def get(url, out=None):
    for k in range(4):
        r = subprocess.run(['curl', '-sS', '-f', '-L', url] + (['-o', out] if out else []), capture_output=True)
        if not r.returncode: time.sleep(0.7); return r.stdout
        time.sleep(3 + 4 * k)
    raise RuntimeError(f'{url}: {r.stderr.decode()[:200]}')

fs = os.path.join(SRC, 'dl_fs'); os.makedirs(fs, exist_ok=True)
man_path = os.path.join(fs, 'manifest.json')
man = json.load(open(man_path)) if os.path.exists(man_path) else {}
for path in FREESOUND:
    sid = path.rsplit('/', 1)[1]
    if sid in man and os.path.exists(os.path.join(fs, man[sid]['file'])): continue
    url = f'https://freesound.org/people/{path}/'
    page = get(url).decode('utf-8', 'replace')
    lic = re.search(r'title="Go to the full license text" href="([^"]+)"', page)
    prev = re.search(r'https://cdn\.freesound\.org/previews/\d+/' + sid + r'_\d+-hq\.mp3', page)
    title = html.unescape(re.search(r'og:audio:title" content="([^"]*)"', page).group(1))
    if not lic or 'publicdomain/zero' not in lic.group(1) or not prev:
        print('SKIP (not CC0 / no preview)', url); continue
    fn = f"{sid}_{re.sub(r'[^a-z0-9]+', '_', title.lower()).strip('_')[:40]}.mp3"
    get(prev.group(0), os.path.join(fs, fn))
    man[sid] = {'file': fn, 'title': title, 'page': url, 'license': lic.group(1)}
    json.dump(man, open(man_path, 'w'), indent=1)
    print('ok', sid, title)
oga = os.path.join(SRC, 'dl_oga'); os.makedirs(oga, exist_ok=True)
for u in OGA:
    out = os.path.join(oga, u.rsplit('/', 1)[1])
    if not os.path.exists(out): get(u, out)
if not os.path.exists(os.path.join(oga, 'breaking')):
    subprocess.run(['unzip', '-q', '-o', os.path.join(oga, 'sfx_breaking_and_falling.zip'), '-d', os.path.join(oga, 'breaking')], check=True)
if not os.path.exists(os.path.join(SRC, 'ffsl')):
    out = os.path.join(SRC, 'prepared.7z')
    if not os.path.exists(out): get(FFSL, out)
    print(f'extract {out} into {os.path.join(SRC, "ffsl")} (7z x / py7zr), then run build_audio.py')
