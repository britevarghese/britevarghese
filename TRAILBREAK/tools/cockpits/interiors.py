# Each sports car's cockpit, as layout.interior: what was measured of the car (cabmeasure.py), where the floor and the
# rear seats are, the regions its own unfinished cockpit is cut out of, and the style of the one built for it.
#   python3 -I interiors.py <TRAILBREAK root>      (writes tools/cars/<id>.json's layout and public/assets/trucks/<id>.json)
import sys, os, json, subprocess, re
ROOT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = {
    # the real cars' cockpits, roughly: their colours, analog dials or a screen, a stick or a selector, paddles
    'm4csl': dict(seat='#18181a', bolster='#202023', stripe='#b0141a', accent='#3a3b3e', cluster='digital', screen=True, stick='auto', paddles=True, accentText='#e2232a', rear=True),
    'amggt': dict(seat='#151516', bolster='#1c1c1e', stripe='#9e1b1b', accent='#a3a7ab', cluster='analog', screen=True, stick='auto', paddles=True, rear=False),
    'c8': dict(seat='#141415', bolster='#8f1d1a', accent='#4a4c50', cluster='digital', screen=True, stick='auto', paddles=True, accentText='#e8442a', rear=False),
    'r8': dict(seat='#141415', bolster='#1a1a1c', stripe='#a3191d', accent='#3b3d40', cluster='digital', screen=False, stick='auto', paddles=True, accentText='#e2232a', rear=False),
    'm3e30': dict(seat='#3b3c3f', bolster='#232325', stripe='#2a4f9e', accent='#2a2a2b', accentMetal=0, lining='#5f5e5a', cluster='analog', screen=False, stick='manual', rear=True),
    'nsx': dict(seat='#1a1a1b', bolster='#222224', accent='#2b2b2c', accentMetal=0, lining='#4a4a4c', cluster='analog', screen=False, stick='manual', rear=False),
    'p930': dict(seat='#6b4a2f', bolster='#5a3d26', accent='#2a2624', accentMetal=0, lining='#2c2724', carpet='#3a2a1f', cluster='tach', screen=False, stick='manual', rear=True),
    'r34': dict(seat='#2a2c31', bolster='#1c1d20', accent='#3a3c40', lining='#3d3d40', cluster='analog', screen=True, stick='manual', rear=True),
    'sti': dict(seat='#2b3446', bolster='#1d2230', accent='#2b2b2c', accentMetal=0, lining='#55555a', cluster='analog', screen=False, stick='manual', rear=True),
    'supra': dict(seat='#1a1a1b', bolster='#232325', accent='#2b2b2c', accentMetal=0, lining='#47474a', cluster='tach', screen=False, stick='manual', rear=True),
    'rx7': dict(seat='#19191a', bolster='#222224', accent='#2b2b2c', accentMetal=0, lining='#2e2e30', cluster='tach', screen=False, stick='manual', rear=False),
    'gclass': dict(seat='#19191a', bolster='#1f1f21', stripe='#6e6a64', accent='#8f9397', cluster='digital', screen=True, stick='auto', rear=True),
    # the Hummer H1: its model's cabin is all body paint and blocks; the Alpha's tan cloth, grey plastics, round dials
    'hummer': dict(seat='#5b5246', bolster='#463f36', accent='#3b3c3e', accentMetal=0, lining='#5e5a52', cluster='analog', screen=False, stick='auto', rear=True, paintCut=True),
}
# door mirrors the detector (mirrors.py) misses or misjudges: the glass as measured off the model by hand
MIRROR = {'hummer': {'c': [1.165, 1.63, 0.697], 'w': 0.17, 'h': 0.27}}
KEEP = ['huracan', 'r35', 'senna']                     # (cockpits of their own, finished: only their mirrors)
EYE = json.loads(subprocess.run(['node', '-e', f"""import('{ROOT}/src/physics/trucks.js').then((T) => console.log(JSON.stringify(Object.fromEntries({json.dumps(list(STYLES))}.map((id) => [id, T.truckSpec(id).eye])))))"""], capture_output=True, text=True, check=True).stdout)
mirr = {}
out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'mirrors.py'), f'{ROOT}/public/assets/trucks', *STYLES, *KEEP], capture_output=True, text=True, check=True).stdout
for line in out.splitlines():
    id, js = line.split(' ', 1); mirr[id] = json.loads(js)
def glass(m, k=(0.9, 0.88)):
    # a door mirror's glass (the left one; the right is its mirror image): a little inside its housing's face
    if not m: return None
    return {'c': m['c'], 'w': round(min(0.2, max(0.06, m['w'] * k[0])), 3), 'h': round(min(0.14, max(0.05, m['h'] * k[1])), 3)}
meas = {}
out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'cabmeasure.py'), f'{ROOT}/public/assets/trucks', *STYLES], capture_output=True, text=True, check=True).stdout
for line in out.splitlines():
    id, js = line.split(' ', 1); meas[id] = json.loads(js)
r3 = lambda v: round(float(v), 3)
for id, style in STYLES.items():
    m = meas[id]; pub = f'{ROOT}/public/assets/trucks/{id}.json'; L = json.load(open(pub)); eye = EYE[id]
    yC, zC = m['cowl']; yT, zT = m['wsTop']; yB, xB = m['belt']; doorX = m['doorX']
    floor = (m['cabin'] or {}).get('floorY') or max(L.get('sill', 0.15), 0.12) + 0.03
    rear = r3(eye[2] - 0.85) if style.pop('rear') else None
    paintCut = style.pop('paintCut', False)            # (its dash and seats modelled in body paint: cut out too)
    W = L['wheels']; aF, aR = L['axleZ']; R = W['FL']['r']; wF = W['FL']['c'][0] - W['FL']['w'] / 2 - 0.08; wR = W['RL']['c'][0] - W['RL']['w'] / 2 - 0.08
    xc = doorX - 0.025
    zBack = (rear - 0.45) if rear is not None else m['sideZ'][0] - 0.08
    zArch = aR + R + 0.12                                   # (behind here the rear wheels' arches stand in)
    cut = []
    # below the windscreen's foot, inside the doors: the dash, the seats, the console, the door cards
    cut.append({'box': [-xc, floor - 0.12, max(zBack, zArch), xc, yC + 0.02, zC - 0.01]})
    if zBack < zArch: cut.append({'box': [-wR, floor - 0.12, zBack, wR, yC + 0.02, zArch]})
    # the rear quarters above the rear wheels' arches
    archTop = 2 * R + 0.08
    if zBack < zArch and archTop < yC: cut.append({'box': [-xc, archTop, zBack, xc, yC + 0.02, zArch]})
    # above it, behind the windscreen (as it curves back at its sides) and inside the side windows, up to the roof:
    # seat tops, the mirror, the lining; in a car with seats behind, in front of the rear window too
    n = (zC - zT, yT - yC); k = (n[0] ** 2 + n[1] ** 2) ** 0.5; n = (n[0] / k, n[1] / k)
    front = [0, r3(n[0]), r3(n[1]), r3(n[0] * yC + n[1] * zC - 0.03), -m.get('wsCurve', 0)]
    if rear is not None and 'rearLow' in m:
        (y0, z0), (y1, z1) = m['rearLow'], m['rearTop']
        nb = (z1 - z0, y0 - y1); kb = (nb[0] ** 2 + nb[1] ** 2) ** 0.5; nb = (nb[0] / kb, nb[1] / kb)      # (up and back)
        back = [0, r3(nb[0]), r3(nb[1]), r3(nb[0] * y0 + nb[1] * z0 - 0.04)]
        zTop = min(z0, z1) - 0.02
    else: back, zTop = None, zBack
    cut.append({'box': [-(xB - 0.02), yC - 0.01, zTop, xB - 0.02, L['roofY'] - 0.012, zC], 'plane': front, **({'plane2': back} if back else {})})
    # the footwells forward under the cowl, short of the front wheels' arches
    z1 = min(zC + 0.3, aF - R - 0.08)
    if z1 > zC: cut.append({'box': [-wF, floor - 0.12, zC - 0.02, wF, yC - 0.08, z1]})
    for c in cut: c['box'] = [r3(v) for v in c['box']]
    # (the body paint cut out short of the doors: their linings face in, cut as the inner skins are, and their outer
    # skins are body paint too: the dash and seats it is for stand inside the doors' depth)
    xp = doorX - 0.15
    paint = [{**c, 'box': [r3(max(c['box'][0], -xp)), *c['box'][1:3], r3(min(c['box'][3], xp)), *c['box'][4:]]} for c in cut if 'plane' not in c]
    I = {'replace': True, 'mirrors': [MIRROR.get(id) or glass(mirr[id][0])], 'cowl': [r3(yC), r3(zC)], 'top': [r3(yT), r3(zT)], 'wsHalf': r3(m['wsHalf']), 'belt': [r3(yB), r3(xB)],
         'sideZ': [r3(v) for v in m['sideZ']], 'doorX': r3(doorX), 'floorY': r3(floor), 'rear': rear, 'style': style, 'cut': cut,
         **({'cutPaint': paint} if paintCut else {})}
    L['interior'] = I
    json.dump(L, open(pub, 'w'), indent=1)
    # the converter's config: its layout carries the same (one line, the file's own formatting kept)
    cp = f'{ROOT}/tools/cars/{id}.json'; s = open(cp).read()
    s = re.sub(r'\n  "interior": \{.*\},\n', '\n', s)
    i = s.index('"layout": {') + len('"layout": {')
    s = s[:i] + '\n  "interior": ' + json.dumps(I, separators=(', ', ': ')) + ',' + s[i:]
    json.loads(s)
    open(cp, 'w').write(s)
    print(id, 'floor', I['floorY'], 'rear', rear, 'cuts', len(cut))
for id in KEEP:
    pub = f'{ROOT}/public/assets/trucks/{id}.json'; L = json.load(open(pub)); r = mirr[id]
    I = {'replace': False, 'mirrors': [glass(r[0])], **({'rearView': glass(r[2], (0.92, 0.85))} if r[2] else {})}
    L['interior'] = I
    json.dump(L, open(pub, 'w'), indent=1)
    cp = f'{ROOT}/tools/cars/{id}.json'; s = open(cp).read()
    s = re.sub(r'\n  "interior": \{.*\},\n', '\n', s)
    i = s.index('"layout": {') + len('"layout": {')
    s = s[:i] + '\n  "interior": ' + json.dumps(I, separators=(', ', ': ')) + ',' + s[i:]
    json.loads(s); open(cp, 'w').write(s)
    print(id, 'mirrors', I)
