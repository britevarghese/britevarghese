#!/usr/bin/env python3
"""The Konkan Coast's real ground: 8 x 8 km of the coast of Raigad, Maharashtra, round Kashid beach (18.44 N, 72.922 E),
from open data, as the grids the game builds the map on (src/world/maps/coast.js).

  python3 -I tools/konkan.py fetch <download dir>            fetch the source data (once)
  python3 -I tools/konkan.py bake <download dir> <out dir>   write height.bin, far.bin, cover.bin into <out dir>
                                                              (public/assets/maps/coast)
  python3 -I tools/konkan.py roads <out dir> <roads.js>       route the roads over the baked ground, written as
                                                              src/world/maps/coastRoads.js

Sources (both free to use with credit; see README, Credits):
  - heights: SRTM 1 arc-second (NASA/NGA, courtesy of the U.S. Geological Survey; public domain), as served by the
    AWS Terrain Tiles (skadi tiles, Mapzen)
  - land cover: ESA WorldCover 2021 v200, 10 m (CC BY 4.0): what grows or stands on every 10 m (tree cover, grass,
    crops, built-up, bare ground, water, wetland, mangroves), read by HTTP range requests from its 3 x 3 degree tile

The game's frame: +x east, +z south, metres from the centre (a local flat projection; 8 km is small enough).
What this does to the data: the SRTM is lightly smoothed (it comes in whole metres) and sampled bicubically. Its
coastline is blocky and lies out at sea in places, so the coastline is WorldCover's: the sea is its open water
reaching the map's west edge, its floor falls away gently from the waterline, and the land is shaped down to the
water over its last few tens of metres (a beach where WorldCover sees bare sand, a steeper shore elsewhere). Inland
water (the reservoir) is given a level and a basin.

Outputs (little-endian):
  height.bin  841 x 841 uint16, the ground every 10 m over 8.4 km (x from -4200 to 4200 east, z the same south),
              in 5 cm steps from -50 m, each row stored as differences from the sample before it (it compresses)
  far.bin     601 x 601 uint16, the same every 40 m over 24 km (the land and sea beyond the map's edge)
  cover.bin   801 x 801 uint8, the land cover every 10 m over the map's 8 km (WorldCover's classes; 80 the sea,
              81 inland water)
"""
import sys, os, gzip, json, math, struct, zlib, urllib.request
import numpy as np
from scipy import ndimage

LAT, LON = 18.44, 72.922
MX, MZ = 111320 * math.cos(math.radians(LAT)), 110574          # metres per degree of longitude, of latitude
SKADI = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi/{0}/{1}.hgt.gz'
TILES = ['N18E072', 'N18E073']
WC_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N18E072_Map.tif'
HALF, H_RES, H_EXT, F_RES, F_EXT, C_RES = 4000, 10, 4200, 40, 12000, 10
SEA_LEVEL = 0.0


# ---------------------------------------------------------------- the GeoTIFF's tile index (enough of TIFF for it)
def tiff_ifd(buf):
    bo = '<' if buf[:2] == b'II' else '>'
    T = {1: ('B', 1), 3: ('H', 2), 4: ('I', 4), 12: ('d', 8), 16: ('Q', 8)}
    off = struct.unpack(bo + 'I', buf[4:8])[0]
    n = struct.unpack(bo + 'H', buf[off:off + 2])[0]
    tags = {}
    for i in range(n):
        e = buf[off + 2 + i * 12: off + 14 + i * 12]
        tag, typ, cnt = struct.unpack(bo + 'HHI', e[:8])
        if typ not in T: continue
        f, sz = T[typ]
        data = e[8:8 + sz * cnt] if sz * cnt <= 4 else buf[struct.unpack(bo + 'I', e[8:12])[0]:][:sz * cnt]
        if len(data) == sz * cnt: tags[tag] = struct.unpack(bo + f * cnt, data)
    return tags


def get(url, rng=None):
    req = urllib.request.Request(url, headers={'Range': 'bytes=%d-%d' % rng} if rng else {})
    return urllib.request.urlopen(req, timeout=120).read()


def wc_window():
    """The WorldCover window to read: the map and a little round it (lat0, lat1, lon0, lon1)."""
    m = HALF + 300
    return LAT - m / MZ, LAT + m / MZ, LON - m / MX, LON + m / MX


def fetch(dl):
    os.makedirs(os.path.join(dl, 'skadi'), exist_ok=True)
    os.makedirs(os.path.join(dl, 'worldcover'), exist_ok=True)
    for t in TILES:
        p = os.path.join(dl, 'skadi', t + '.hgt.gz')
        if not os.path.exists(p): open(p, 'wb').write(get(SKADI.format(t[:3], t)))
    head = os.path.join(dl, 'worldcover', 'head.bin')
    if not os.path.exists(head): open(head, 'wb').write(get(WC_URL, (0, 524287)))
    t = tiff_ifd(open(head, 'rb').read())
    W, TW, TH, offs, cnts = t[256][0], t[322][0], t[323][0], t[324], t[325]
    sx, sy, X0, Y0 = t[33550][0], t[33550][1], t[33922][3], t[33922][4]
    lat0, lat1, lon0, lon1 = wc_window()
    r0, r1, c0, c1 = int((Y0 - lat1) / sy), int((Y0 - lat0) / sy), int((lon0 - X0) / sx), int((lon1 - X0) / sx)
    across = math.ceil(W / TW)
    for tr in range(r0 // TH, (r1 - 1) // TH + 1):
        for tc in range(c0 // TW, (c1 - 1) // TW + 1):
            p = os.path.join(dl, 'worldcover', 'tile_%d_%d.bin' % (tr, tc))
            i = tr * across + tc
            if not os.path.exists(p): open(p, 'wb').write(get(WC_URL, (offs[i], offs[i] + cnts[i] - 1)))
    print('fetched into', dl)


# ---------------------------------------------------------------- reading the sources
def srtm(dl):
    """The SRTM mosaic (1 arc-second; north-west corner at 19 N, 72 E) and a sampler at (lat, lon) arrays."""
    tiles = []
    for t in TILES:
        a = np.frombuffer(gzip.open(os.path.join(dl, 'skadi', t + '.hgt.gz')).read(), '>i2')
        n = int(round(math.sqrt(a.size)))
        tiles.append(a.reshape(n, n).astype(np.float64))
    M = np.concatenate([tiles[0][:, :-1], tiles[1]], axis=1)
    assert (M > -1000).all(), 'voids in the SRTM'
    Ms = ndimage.gaussian_filter(M, 0.8)                     # (whole metres, and speckle)
    def at(lat, lon):
        return ndimage.map_coordinates(Ms, [(19 - lat) * 3600, (lon - 72) * 3600], order=3, mode='nearest')
    return at


def worldcover(dl):
    """WorldCover's classes over the window, and a nearest sampler at (lat, lon) arrays (0 outside it)."""
    t = tiff_ifd(open(os.path.join(dl, 'worldcover', 'head.bin'), 'rb').read())
    W, TW, TH = t[256][0], t[322][0], t[323][0]
    sx, sy, X0, Y0 = t[33550][0], t[33550][1], t[33922][3], t[33922][4]
    assert t[259][0] == 8 and t[258][0] == 8, 'deflate, 8 bit'
    lat0, lat1, lon0, lon1 = wc_window()
    r0, r1, c0, c1 = int((Y0 - lat1) / sy), int((Y0 - lat0) / sy), int((lon0 - X0) / sx), int((lon1 - X0) / sx)
    out = np.zeros((r1 - r0, c1 - c0), np.uint8)
    for tr in range(r0 // TH, (r1 - 1) // TH + 1):
        for tc in range(c0 // TW, (c1 - 1) // TW + 1):
            a = np.frombuffer(zlib.decompress(open(os.path.join(dl, 'worldcover', 'tile_%d_%d.bin' % (tr, tc)), 'rb').read()), np.uint8).reshape(TH, TW)
            ys, xs = tr * TH, tc * TW
            a0, a1, b0, b1 = max(r0, ys), min(r1, ys + TH), max(c0, xs), min(c1, xs + TW)
            out[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = a[a0 - ys:a1 - ys, b0 - xs:b1 - xs]
    def at(lat, lon):
        r = np.floor((Y0 - lat) / sy).astype(int) - r0
        c = np.floor((lon - X0) / sx).astype(int) - c0
        ok = (r >= 0) & (c >= 0) & (r < out.shape[0]) & (c < out.shape[1])
        res = np.zeros(lat.shape, np.uint8)
        res[ok] = out[r[ok], c[ok]]
        return res
    return at


def grid(ext, res):
    """A grid's sample points: x east and z south (m), and their latitude and longitude."""
    v = np.arange(-ext, ext + res / 2, res, dtype=np.float64)
    X, Z = np.meshgrid(v, v)
    return X, Z, LAT - Z / MZ, LON + X / MX


# ---------------------------------------------------------------- the ground
def shape(h, cov, res):
    """The ground from the SRTM heights and the land cover on one grid: the sea from the waterline out, the shore,
    inland water's basin. Returns heights and the cover with the sea (80) told from inland water (81)."""
    water = cov == 80
    lab, n = ndimage.label(water)
    west = set(np.unique(lab[:, 0])) - {0}
    sea = np.isin(lab, list(west))
    cov = cov.copy()
    cov[water & ~sea] = 81
    # the waterline: the cells' edge smoothed (the signed distance to it, blurred over about 20 m), so the coast is a
    # curve and not the cells' stairs
    sd = ndimage.gaussian_filter(np.where(sea, -ndimage.distance_transform_edt(sea), ndimage.distance_transform_edt(~sea)) * res, 2.0)
    was = sea
    sea = sd < 0
    cov[was & ~sea] = np.where(cov[was & ~sea] == 80, 60, cov[was & ~sea])
    cov[sea & ~was] = 80
    dl = np.maximum(sd, 0)                                    # on land: how far to the sea
    ds = np.maximum(-sd, 0)                                   # at sea: how far to the land
    # the shore: a beach rises gently from the waterline (3 m in its first 60 m), other shores more steeply; the
    # SRTM takes over within 150 m (its coastal band, too low or out at sea, is not trusted nearer)
    # (the two blended over about 30 m, so there is no step where WorldCover's sand ends)
    sand = ndimage.gaussian_filter(ndimage.binary_dilation(cov == 60, iterations=3).astype(np.float64), 3.0)
    beach = 0.6 + np.minimum(dl, 60) * 0.05 + np.maximum(0, dl - 60) * 0.03
    rocky = 0.6 + dl * 0.22
    shore = sand * beach + (1 - sand) * np.minimum(rocky, np.maximum(beach, h))
    k = np.clip(dl / 150, 0, 1); k = k * k * (3 - 2 * k)
    land = np.maximum(shore * (1 - k) + h * k, 0.6 + np.minimum(dl, 40) * 0.02)
    # the sea floor: shelving out from the waterline
    floor = SEA_LEVEL - np.minimum(14, 0.5 + ds * 0.028)
    H = np.where(sea, floor, land)
    # inland water: its level a little under the lowest of its shore; a basin under it, deeper toward its middle
    lake = cov == 81
    if lake.any():
        llab, ln = ndimage.label(lake)
        for i in range(1, ln + 1):
            m = llab == i
            if m.sum() < 8: cov[m] = 30; continue           # (a pond too small to drive into: grass)
            ring = ndimage.binary_dilation(m, iterations=2) & ~m
            level = float(np.percentile(h[ring], 15)) - 0.6
            din = ndimage.distance_transform_edt(m) * res
            H[m] = level - np.minimum(6, 0.4 + din[m] * 0.05)
            H[ring] = np.maximum(H[ring], level + 0.3)
            print('inland water %d: %d cells, level %.1f m' % (i, m.sum(), level))
    return H, cov, sea


def encode(H):
    """Heights as uint16 (5 cm steps from -50 m), each row as differences along it."""
    q = np.clip(np.round((H + 50) * 20), 0, 65535).astype(np.int32)
    d = q.copy(); d[:, 1:] = q[:, 1:] - q[:, :-1]
    return (d & 0xffff).astype('<u2').tobytes()


def bake(dl, out):
    os.makedirs(out, exist_ok=True)
    hat, cat = srtm(dl), worldcover(dl)
    # the map: heights over 8.4 km, cover over 8 km (the same 10 m grid, trimmed)
    X, Z, la, lo = grid(H_EXT, H_RES)
    h = hat(la, lo)
    cov = cat(la, lo)
    cov[cov == 0] = np.where(h[cov == 0] <= 0.5, 80, 10)     # (outside WorldCover's window: SRTM's sea, else trees)
    H, cov, sea = shape(h, cov, H_RES)
    open(os.path.join(out, 'height.bin'), 'wb').write(encode(H))
    t = (H_EXT - HALF) // C_RES
    C = cov[t:-t, t:-t]
    assert C.shape == (2 * HALF // C_RES + 1,) * 2
    open(os.path.join(out, 'cover.bin'), 'wb').write(C.astype(np.uint8).tobytes())
    # beyond the map: SRTM's sea is wherever it is at sea level (its coast is coarse, and far away)
    FX, FZ, fla, flo = grid(F_EXT, F_RES)
    fh = hat(fla, flo)
    fsea = fh <= 0.5
    lab, n = ndimage.label(fsea)
    fsea = np.isin(lab, list(set(np.unique(lab[:, 0])) - {0}))
    fds = ndimage.distance_transform_edt(fsea) * F_RES
    FH = np.where(fsea, SEA_LEVEL - np.minimum(25, 1.5 + fds * 0.02), np.maximum(fh, 0.8))
    open(os.path.join(out, 'far.bin'), 'wb').write(encode(FH))
    names = {10: 'trees', 20: 'shrubs', 30: 'grass', 40: 'crops', 50: 'built-up', 60: 'bare', 80: 'sea', 81: 'inland water', 90: 'wetland', 95: 'mangrove'}
    cls, cnt = np.unique(C, return_counts=True)
    print('map %d x %d at %d m: heights %.1f to %.1f m;' % (H.shape[0], H.shape[1], H_RES, H.min(), H.max()), ', '.join('%s %.1f%%' % (names.get(int(c), c), 100 * k / C.size) for c, k in zip(cls, cnt)))
    print('far %d x %d at %d m: %.1f to %.1f m' % (FH.shape[0], FH.shape[1], F_RES, FH.min(), FH.max()))
    for f in ('height.bin', 'far.bin', 'cover.bin'):
        b = open(os.path.join(out, f), 'rb').read()
        print('%s %.2f MB (%.2f MB deflated)' % (f, len(b) / 1e6, len(zlib.compress(b, 9)) / 1e6))
    return H, cov


# ---------------------------------------------------------------- the roads
# Each road is routed over the baked ground between the places it must pass (a via can be a point on a road routed
# before it, so the two join): the least costly way on the 10 m grid, in steps of up to 45 m in 24 directions, a
# step costing its length times (1 + a penalty for its grade, steep past the road's limit, and for the fall across
# it) plus a little for the woods it goes through and a little for being a step at all (so it takes long straight
# steps where it can); never across water. Then the line is pulled smooth, each point toward its neighbours' middle
# except where that would make it steeper than its limit (a hairpin stays where the slope needs it), and cut down to
# its corners.
ROADS = [
    {'name': 'Coast Road', 'gmax': 0.07, 'via': [[-1900, -3960], [-2450, -1900], [-1760, -700], [-1560, 700], [-1330, 3960]]},
    {'name': 'Kashid Ghat', 'gmax': 0.09, 'via': [{'on': 'Coast Road', 'near': [-1800, -900]}, [-900, -1050], [-300, -1350], [700, -1000], [3960, -700]]},
    {'name': 'South Ghat', 'gmax': 0.09, 'via': [{'on': 'Coast Road', 'near': [-1560, 1100]}, [-600, 1200], [300, 1250], [1100, 1200], [3960, 1300]]},
    {'name': 'Plateau Road', 'gmax': 0.07, 'via': [{'on': 'Kashid Ghat', 'near': [330, -935]}, [470, -500], [850, 400], {'on': 'South Ghat', 'near': [1150, 1385]}]},
    {'name': 'Ridge Track', 'gmax': 0.14, 'via': [{'on': 'Kashid Ghat', 'near': [-300, -1350]}, [200, -2400], [600, -3150], [400, -3960]]},
]
COVER_COST = {10: 0.12, 20: 0.15, 30: 0.0, 40: 0.05, 50: 0.0, 60: 3.0, 90: 2.0, 95: 3.0}
STEPS = [(1, 0), (0, 1), (1, 1), (1, -1), (2, 1), (1, 2), (2, -1), (1, -2), (3, 1), (1, 3), (3, -1), (1, -3), (3, 2), (2, 3), (3, -2), (2, -3),
         (4, 1), (1, 4), (4, -1), (1, -4), (4, 3), (3, 4), (4, -3), (3, -4)]


def read_grids(out):
    raw = np.frombuffer(open(os.path.join(out, 'height.bin'), 'rb').read(), '<u2').reshape(841, 841).astype(np.int64)
    q = np.cumsum(np.where(raw > 32767, raw - 65536, raw), axis=1) & 0xffff
    t = (H_EXT - HALF) // H_RES
    H = (q / 20 - 50)[t:-t, t:-t]
    C = np.frombuffer(open(os.path.join(out, 'cover.bin'), 'rb').read(), np.uint8).reshape(801, 801)
    return H, C


def route_all(out, js):
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    H, C = read_grids(out)
    n, R = H.shape[0], float(C_RES)
    idx = np.arange(n * n).reshape(n, n)
    gy, gx = np.gradient(H, R); S = np.hypot(gx, gy)
    cp = np.zeros_like(H)
    for k, v in COVER_COST.items(): cp[C == k] = v
    bad = (C == 80) | ((C >= 81) & (C < 90))
    edge = np.zeros_like(bad); edge[:3, :] = edge[-3:, :] = edge[:, :3] = edge[:, -3:] = True
    graphs = {}

    def graph(gmax, over=8.0):
        if gmax in graphs: return graphs[gmax]
        rows, cols, vals = [], [], []
        for di, dk in STEPS:
            L = R * math.hypot(di, dk)
            a = (slice(max(0, -dk), n - max(0, dk)), slice(max(0, -di), n - max(0, di)))
            b = (slice(a[0].start + dk, a[0].stop + dk), slice(a[1].start + di, a[1].stop + di))
            m = max(abs(di), abs(dk))
            sh = lambda A, oi, ok: A[slice(a[0].start + ok, a[0].stop + ok), slice(a[1].start + oi, a[1].stop + oi)]
            g = np.zeros(H[a].shape); cross = np.zeros(H[a].shape); cov = np.zeros(H[a].shape); blocked = np.zeros(H[a].shape, bool)
            prev = H[a]
            for t in range(1, m + 1):
                fi, fk = di * t / m, dk * t / m
                i0, k0 = int(math.floor(fi)), int(math.floor(fk)); ti, tk = fi - i0, fk - k0
                i1, k1 = i0 + (1 if ti > 0 else 0), k0 + (1 if tk > 0 else 0)
                hh = sh(H, i0, k0) * (1 - ti) * (1 - tk) + sh(H, i1, k0) * ti * (1 - tk) + sh(H, i0, k1) * (1 - ti) * tk + sh(H, i1, k1) * ti * tk
                g = np.maximum(g, np.abs(hh - prev) / (L / m)); prev = hh
                ri, rk = int(round(fi)), int(round(fk))
                cross = np.maximum(cross, sh(S, ri, rk)); cov += sh(cp, ri, rk) / m
                blocked |= sh(bad, ri, rk) | sh(edge, ri, rk)
            cross = np.sqrt(np.maximum(0, cross * cross - g * g))
            cost = L * (1 + 25 * (g / gmax) ** 2 + np.where(g > gmax, 400 * (g - gmax), 0) + 6 * cross ** 2 + cov) + over
            ok = ~(bad[a] | blocked)
            ia, ib = idx[a][ok], idx[b][ok]
            rows += [ia, ib]; cols += [ib, ia]; vals += [cost[ok], cost[ok]]
        graphs[gmax] = csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n * n, n * n))
        return graphs[gmax]

    cell = lambda x, z: int(round((z + HALF) / R)) * n + int(round((x + HALF) / R))

    def path(G, a, b):
        d, pred = dijkstra(G, indices=cell(*a), return_predecessors=True)
        t = cell(*b); out_ = [t]
        assert np.isfinite(d[t]), 'no way from %s to %s' % (a, b)
        while out_[-1] != cell(*a): out_.append(pred[out_[-1]])
        return [((c % n) * R - HALF, (c // n) * R - HALF) for c in reversed(out_)]

    def hat(x, z):
        fx = np.clip((x + HALF) / R, 0, n - 1.001); fz = np.clip((z + HALF) / R, 0, n - 1.001)
        i = np.floor(fx).astype(int); k = np.floor(fz).astype(int); tx = fx - i; tz = fz - k
        return (H[k, i] * (1 - tx) + H[k, i + 1] * tx) * (1 - tz) + (H[k + 1, i] * (1 - tx) + H[k + 1, i + 1] * tx) * tz

    def resample(P, step=10.0):
        P = np.array(P, float); seg = np.hypot(*np.diff(P, axis=0).T); t = np.concatenate([[0], np.cumsum(seg)])
        s = np.linspace(0, t[-1], max(2, int(round(t[-1] / step)) + 1))
        return np.stack([np.interp(s, t, P[:, 0]), np.interp(s, t, P[:, 1])], 1)

    def wet(P):
        i = np.clip(((P[:, 0] + HALF) / R).round().astype(int), 0, n - 1); k = np.clip(((P[:, 1] + HALF) / R).round().astype(int), 0, n - 1)
        return bad[k, i]

    def grade(h, P, span=3):
        seg = np.hypot(*np.diff(P, axis=0).T); t = np.concatenate([[0], np.cumsum(seg)])
        a = np.arange(len(P)); lo = np.clip(a - span, 0, len(P) - 1); hi = np.clip(a + span, 0, len(P) - 1)
        return np.maximum(np.abs(h - h[lo]) / np.maximum(1, t - t[lo]), np.abs(h[hi] - h) / np.maximum(1, t[hi] - t))

    def relax(P, gmax, iters=400, alpha=0.4):
        P = resample(P)
        for it in range(iters):
            Q = P.copy(); Q[1:-1] += alpha * ((P[:-2] + P[2:]) / 2 - P[1:-1])
            ok = (grade(hat(Q[:, 0], Q[:, 1]), Q) <= np.maximum(gmax, grade(hat(P[:, 0], P[:, 1]), P)) + 1e-4) & ~wet(Q)
            ok[0] = ok[-1] = False
            P = np.where(ok[:, None], Q, P)
            if it % 20 == 19: P = resample(P)
        return P

    def corners(P, tol):
        if len(P) < 3: return P
        a, b = P[0], P[-1]; ab = b - a; L = math.hypot(*ab) or 1
        d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L
        i = int(np.argmax(d))
        return np.vstack([corners(P[:i + 1], tol)[:-1], corners(P[i:], tol)]) if d[i] > tol else np.array([a, b])

    done = {}
    for r in ROADS:
        def snap(v):
            if not isinstance(v, dict): return v
            Q = resample(done[v['on']], 5); d = np.hypot(Q[:, 0] - v['near'][0], Q[:, 1] - v['near'][1])
            return [float(c) for c in Q[int(np.argmin(d))]]
        via = [snap(v) for v in r['via']]
        pts = []
        for a, b in zip(via[:-1], via[1:]):
            p = path(graph(r['gmax']), a, b)
            pts += p if not pts else p[1:]
        P = relax(resample(pts), r['gmax'] * 1.05)
        P[0], P[-1] = via[0], via[-1]
        done[r['name']] = corners(P, 2)
        L = np.hypot(*np.diff(done[r['name']], axis=0).T).sum()
        print('%-14s %5.0f m, %d corners' % (r['name'], L, len(done[r['name']])))
    with open(js, 'w') as f:
        f.write('// The Konkan Coast\'s roads, as routed over its real ground by tools/konkan.py (roads): each road\'s corners [x, z]\n')
        f.write('// (m, +x east, +z south). Written by the tool: route them again rather than editing them by hand.\n')
        f.write('export const ROUTES = {\n')
        for name, P in done.items():
            f.write('  %s: [%s],\n' % (json.dumps(name), ', '.join('[%.1f, %.1f]' % (x, z) for x, z in P)))
        f.write('};\n')
    print('wrote', js)


if __name__ == '__main__':
    if sys.argv[1] == 'fetch': fetch(sys.argv[2])
    elif sys.argv[1] == 'bake': bake(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'roads': route_all(sys.argv[2], sys.argv[3])
    else: sys.exit(__doc__)
