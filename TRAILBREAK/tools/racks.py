#!/usr/bin/env python3
"""Measure where a roof rack or a bed rack can stand on each truck body: the roof's top surface and the bed's rails.

usage: python3 -I tools/racks.py public/assets/trucks [ids...]

Reads each <id>.glb (the converted body, tools/cars.py) and writes into its layout, both tools/cars/<id>.json (so a
new conversion keeps it) and public/assets/trucks/<id>.json:
  roofMap  the height of the body's top surface over the roof, every 10 cm: {x0, z0, d, nx, nz, h: [a row of heights
           across x (cm, '-' where the roof isn't) for each step along z]}: the roof rack's feet stand on it
           (render/TruckModel.js)
  bedRail  a pickup's bed rails: [half the distance between their tops, their height]: a bed rack's legs stand on them
Needs numpy.
"""
import json, os, struct, sys
import numpy as np

COMP = {5120: (np.int8, 127), 5121: (np.uint8, 255), 5122: (np.int16, 32767), 5123: (np.uint16, 65535), 5125: (np.uint32, None), 5126: (np.float32, None)}
WHEELS = ('rim', 'tyre', 'hub', 'spare')


def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64); s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t
    return M


def body_triangles(path):
    """The body's triangles in the design frame (node transforms applied, quantized corners decoded), less the wheels."""
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); binb = b[20 + n + 8:]

    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        dt, norm = COMP[a['componentType']]
        k = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        size = np.dtype(dt).itemsize
        stride = v.get('byteStride', 0) or k * size
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (a['count'] - 1) + k * size, offset=off)
        out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], k * size), strides=(stride, 1)).copy().view(dt).reshape(a['count'], k)
        out = out.astype(np.float64)
        if a.get('normalized') and norm: out = np.maximum(out / norm, -1.0)
        return out

    T = []
    for nd in j['nodes']:
        if 'mesh' not in nd: continue
        M = node_matrix(nd)
        for pr in j['meshes'][nd['mesh']]['primitives']:
            role = j['materials'][pr['material']].get('name', '').split(':')[0]
            if role in WHEELS: continue
            P = acc(pr['attributes']['POSITION']) @ M[:3, :3].T + M[:3, 3]
            I = acc(pr['indices']).astype(np.int64).reshape(-1, 3)
            T.append(P[I])
    return np.concatenate(T)


def heights(T, xs, z):
    """The top surface's height along x at one z (nan where no triangle is under or over the point)."""
    lo, hi = T.min(1), T.max(1)
    S = T[(lo[:, 2] <= z) & (hi[:, 2] >= z)]
    out = np.full(len(xs), np.nan)
    if not len(S): return out
    slo, shi = S[:, :, 0].min(1), S[:, :, 0].max(1)
    a, b, c = S[:, 0], S[:, 1], S[:, 2]
    d = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2])
    ok = np.abs(d) > 1e-12
    for i, x in enumerate(xs):
        s = ok & (slo <= x) & (shi >= x)
        if not s.any(): continue
        A, B, C, D = a[s], b[s], c[s], d[s]
        l1 = ((B[:, 2] - C[:, 2]) * (x - C[:, 0]) + (C[:, 0] - B[:, 0]) * (z - C[:, 2])) / D
        l2 = ((C[:, 2] - A[:, 2]) * (x - C[:, 0]) + (A[:, 0] - C[:, 0]) * (z - C[:, 2])) / D
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if inside.any(): out[i] = (l1 * A[:, 1] + l2 * B[:, 1] + l3 * C[:, 1])[inside].max()
    return out


def measure(glb, L):
    T = body_triangles(glb)
    out = {}
    lo, hi = np.array(L['bbox'][0]), np.array(L['bbox'][1])
    # the roof: over the layout's roof run, as wide as the body; a height counts as roof where it is within 0.35 m of
    # the top there (lower: the body's sides, the windscreen's foot)
    d = 0.1
    z0, z1 = L['roofZ'][0] - 0.2, L['roofZ'][1] + 0.2
    zs = np.round(np.arange(z0, z1 + 1e-6, d), 3)
    half = min(abs(lo[0]), abs(hi[0]))
    xs = np.round(np.arange(-np.floor(half / d) * d, half + 1e-6, d), 3)
    rows, top = [], hi[1]
    for z in zs:
        h = heights(T, xs, z)
        rows.append(' '.join('-' if not np.isfinite(v) or v < top - 0.35 else str(int(round(v * 100))) for v in h))
    out['roofMap'] = {'x0': float(xs[0]), 'z0': float(zs[0]), 'd': d, 'nx': len(xs), 'nz': len(zs), 'h': rows}
    # a pickup's bed rails: along each side of the bed, the outermost line still at the top (the bed floor lies well
    # below between them; a hard cover, as the Ram's, is level with them)
    if L.get('bedZ'):
        bz0, bz1 = L['bedZ']
        xs2 = np.arange(0.3, half + 0.02, 0.01)
        tops = []
        for z in np.linspace(bz0 + 0.25, bz1 - 0.25, 7):
            for sx in (1, -1):
                h = heights(T, sx * xs2, z)
                if not np.isfinite(h).any(): continue
                at = np.where(np.isfinite(h) & (h > np.nanmax(h) - 0.04))[0].max()
                k = max(0, at - 6) + int(np.nanargmax(h[max(0, at - 6):at + 1]))
                tops.append((xs2[at] - 0.03, h[k]))
        if tops:
            t = np.array(tops)
            out['bedRail'] = [round(float(np.median(t[:, 0])), 3), round(float(np.median(t[:, 1])), 3)]
    return out


def update_config(path, m):
    """Put the measurements in a car config's layout, keeping a hand-formatted config's layout as it was written."""
    text = open(path).read()
    j = json.loads(text)
    if json.dumps(j, indent=1) == text.rstrip('\n') or 'layout' not in j:
        j.setdefault('layout', {}).update(m)
        with open(path, 'w') as f: json.dump(j, f, indent=1)
        return
    # (a line each, at the top of the layout, or in place of the line a measurement had before)
    lines = text.split('\n')
    for k, v in m.items():
        line = f'  "{k}": {json.dumps(v)},'
        at = next((i for i, l in enumerate(lines) if l.lstrip().startswith(f'"{k}":')), None)
        if at is not None: lines[at] = line if lines[at].rstrip().endswith(',') else line[:-1]
        else: lines.insert(next(i for i, l in enumerate(lines) if l.lstrip().startswith('"layout":')) + 1, line)
    with open(path, 'w') as f: f.write('\n'.join(lines))
    assert json.load(open(path))['layout'][next(iter(m))] == next(iter(m.values()))


def main(root, ids):
    here = os.path.dirname(os.path.abspath(__file__))
    for tid in ids:
        lp = os.path.join(root, f'{tid}.json')
        L = json.load(open(lp))
        m = measure(os.path.join(root, f'{tid}.glb'), L)
        L.update(m)
        with open(lp, 'w') as f: json.dump(L, f, indent=1)
        cp = os.path.join(here, 'cars', f'{tid}.json')
        if os.path.exists(cp): update_config(cp, m)
        rm = m['roofMap']
        cells = sum(v != '-' for r in rm['h'] for v in r.split())
        print(f"{tid}: roof {rm['nx']} x {rm['nz']} ({cells} on the roof)" + (f", bed rails at x {m['bedRail'][0]}, y {m['bedRail'][1]}" if 'bedRail' in m else ''))


if __name__ == '__main__':
    root = sys.argv[1]
    ids = sys.argv[2:] or sorted(f[:-4] for f in os.listdir(root) if f.endswith('.glb'))
    main(root, ids)
