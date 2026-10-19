# Measure a converted car's cabin from its GLB (design frame: +x left, +y up, +z forward):
#   python3 -I cabmeasure.py <trucks dir> <id>...
# the windscreen (its bottom at the middle: the cowl; its top), the side windows (their bottom: the belt line, how far
# in they are there, and from where to where along the car), from the glass; the roof and the eye from the layout.
import sys, json, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
from glbread import load
D = sys.argv[1]
for id in sys.argv[2:]:
    lay = json.load(open(f'{D}/{id}.json'))
    ms = load(f'{D}/{id}.glb')
    G = np.concatenate([t for n, m, t in ms if m.startswith('glass') or m.startswith('screen')] or [np.zeros((0, 3, 3))])
    P = np.concatenate([t for n, m, t in ms if m.startswith('paint')] or [np.zeros((0, 3, 3))])
    nrm = np.cross(G[:, 1] - G[:, 0], G[:, 2] - G[:, 0]); area = np.linalg.norm(nrm, axis=1); nrm = nrm / (area[:, None] + 1e-12); c = G.mean(1)
    st = lay.get('steering') or {}
    # the windscreen: glass ahead of the steering wheel facing forward and up (either way round: double-sided)
    fz = np.abs(nrm[:, 2]); fx = np.abs(nrm[:, 0])
    ws = (fz > 0.25) & (fx < 0.5) & (c[:, 2] > st.get('z', 0) - 0.1) & (np.abs(c[:, 0]) < 0.6) & (c[:, 1] > 0.6)
    side = (fx > 0.6) & (c[:, 1] > 0.6)
    out = {}
    if ws.any():
        W = G[ws].reshape(-1, 3); mid = W[np.abs(W[:, 0]) < 0.25]
        if not len(mid): mid = W
        lo = mid[np.argmin(mid[:, 1])]; hi = mid[np.argmax(mid[:, 1])]
        out['cowl'] = [round(float(lo[1]), 3), round(float(lo[2]), 3)]; out['wsTop'] = [round(float(hi[1]), 3), round(float(hi[2]), 3)]
        out['wsHalf'] = round(float(np.abs(W[:, 0]).max()), 3)
        # how far back the screen curves at its sides: n.p (n square to the line from its foot to its top, outward)
        # across x, as d0 + a x^2
        n = np.array([0, lo[2] - hi[2], hi[1] - lo[1]]); n /= np.linalg.norm(n)
        dv = W @ n; xs = W[:, 0]
        A = np.c_[np.ones_like(xs), xs ** 2]; coef = np.linalg.lstsq(A, dv, rcond=None)[0]
        out['wsCurve'] = round(float(coef[1]), 4)
    # the rear window: glass facing back (either way round), across the middle, above the belt
    rw = (fz > 0.25) & (fx < 0.5) & (c[:, 2] < st.get('z', 0) - 0.6) & (np.abs(c[:, 0]) < 0.6) & (c[:, 1] > 0.6)
    if rw.any():
        Rw = G[rw].reshape(-1, 3); mid = Rw[np.abs(Rw[:, 0]) < 0.25]
        if not len(mid): mid = Rw
        lo = mid[np.argmin(mid[:, 1])]; hi = mid[np.argmax(mid[:, 1])]
        out['rearLow'] = [round(float(lo[1]), 3), round(float(lo[2]), 3)]; out['rearTop'] = [round(float(hi[1]), 3), round(float(hi[2]), 3)]
    if side.any():
        Sd = G[side].reshape(-1, 3); Sd = Sd[Sd[:, 0] > 0]   # the left side
        # the front side window: from the A-pillar back past the driver
        near = Sd[(Sd[:, 2] > lay.get('steering', {}).get('z', 0) - 1.2)]
        out['belt'] = [round(float(np.percentile(near[:, 1], 3)), 3), round(float(np.percentile(near[:, 0], 50)), 3)]
        out['sideZ'] = [round(float(near[:, 2].min()), 3), round(float(near[:, 2].max()), 3)]
        out['sideTop'] = round(float(np.percentile(near[:, 1], 97)), 3)
    # the body's inside width at the belt: the paint's half-width around there, in the cabin
    if len(P) and 'belt' in out:
        pv = P.reshape(-1, 3); k = (np.abs(pv[:, 1] - (out['belt'][0] - 0.1)) < 0.08) & (pv[:, 2] > out['sideZ'][0]) & (pv[:, 2] < out['sideZ'][1])
        if k.any(): out['doorX'] = round(float(np.percentile(np.abs(pv[k, 0]), 95)), 3)
    out['steer'] = [st.get(k) for k in ('x', 'y', 'z', 'tilt', 'r')]
    out['half'] = lay.get('half'); out['sill'] = lay.get('sill'); out['roofY'] = lay.get('roofY'); out['roofZ'] = lay.get('roofZ'); out['cabin'] = lay.get('cabin')
    print(id, json.dumps(out))
