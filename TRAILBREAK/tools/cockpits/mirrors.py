# Each car's door mirrors, from its model: the parts standing out from the side ahead of the door window, near its
# sill; the mirror's glass is the face of them turned back. python3 -I mirrors.py <trucks dir> <id>...
import sys, json, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
from glbread import load
import subprocess, os
D = sys.argv[1]
meas = {}
out = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(__file__), 'cabmeasure.py'), D, *sys.argv[2:]], capture_output=True, text=True, check=True).stdout
for line in out.splitlines(): id, js = line.split(' ', 1); meas[id] = json.loads(js)
for id in sys.argv[2:]:
    m = meas[id]; ms = load(f'{D}/{id}.glb')
    T = np.concatenate([t for n, mt, t in ms if not mt.split(':')[0] in ('glass', 'screen', 'rim', 'tyre', 'hub')])
    names = np.concatenate([[mt] * len(t) for n, mt, t in ms if not mt.split(':')[0] in ('glass', 'screen', 'rim', 'tyre', 'hub')])
    c = T.mean(1); nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ar = np.linalg.norm(nrm, axis=1); nrm /= ar[:, None] + 1e-12
    yB, xB = m['belt']; z1 = m['sideZ'][1]
    res = []
    for side in (1, -1):
        sel = (c[:, 0] * side > max(m['doorX'], xB) + 0.02) & (c[:, 1] > yB - 0.12) & (c[:, 1] < yB + 0.3) & (c[:, 2] > z1 - 0.6) & (c[:, 2] < z1 + 0.35)
        if sel.sum() < 10: res.append(None); continue
        # a material the model names as the mirror's: that; else the head standing furthest out, its face turned back
        named = sel & np.array(['mirror' in n.lower() for n in names])
        if named.sum() >= 3: near = named & (nrm[:, 2] < -0.3)
        else:
            xmax = (c[sel, 0] * side).max()
            head = sel & (c[:, 0] * side > xmax - 0.17)
            near = head & (nrm[:, 2] < -0.4)
        if near.sum() < 3: res.append(None); continue
        P = T[near].reshape(-1, 3)
        lo, hi = np.percentile(P, 4, axis=0), np.percentile(P, 96, axis=0)
        # its width along the face (turned about the upright, its span across x alone is less)
        q = P[:, [0, 2]] - P[:, [0, 2]].mean(0); ev = np.linalg.eigh(q.T @ q)[1][:, -1]
        span = np.percentile(q @ ev, 96) - np.percentile(q @ ev, 4)
        mats = sorted(set(names[near]))[:3]
        res.append({'c': [round(float(v), 3) for v in (lo + hi) / 2], 'w': round(float(span), 3), 'h': round(float(hi[1] - lo[1]), 3), 'mats': mats})
    # the rear-view mirror on the windscreen's top, middle: the face of what hangs there turned back
    rv = None
    if 'wsTop' in m:
        yT, zT = m['wsTop']
        sel = (np.abs(c[:, 0]) < 0.2) & (c[:, 1] > yT - 0.2) & (c[:, 1] < yT + 0.01) & (c[:, 2] > zT - 0.3) & (c[:, 2] < zT + 0.02) & (nrm[:, 2] < -0.4)
        if sel.sum() >= 6:
            P = T[sel].reshape(-1, 3); lo, hi = np.percentile(P, 4, axis=0), np.percentile(P, 96, axis=0)
            if 0.1 < hi[0] - lo[0] < 0.4 and 0.03 < hi[1] - lo[1] < 0.12: rv = {'c': [round(float(v), 3) for v in (lo + hi) / 2], 'w': round(float(hi[0] - lo[0]), 3), 'h': round(float(hi[1] - lo[1]), 3)}
    res.append(rv)
    print(id, json.dumps(res))
