#!/usr/bin/env python3
# Kerala world data: OpenStreetMap (roads, buildings, water, land use, places, the 14 districts) and SRTM
# elevation -> streamable 2 km binary tiles under public/assets/world/kerala/.
#
#   pip install osmium shapely numpy
#   curl -o .cache/osm/kerala.osm.pbf https://download.openstreetmap.fr/extracts/asia/india/kerala.osm.pbf
#   (SRTM 1" tiles N08..N12 E074..E077 from s3.amazonaws.com/elevation-tiles-prod/skadi into .cache/srtm)
#   python3 tools/kerala/build_tiles.py [--only-district Ernakulam]
#
# Streaming: every road / building / polygon is clipped and encoded into its tile's bytes as it is read,
# so memory stays small for all 2.6 million buildings. Tiles outside Kerala (+3 km) are dropped at the end.
#
# Coordinates: metres east (E) / north (N) of ORIGIN on a sinusoidal projection (true scale north-south and
# east-west at every latitude, slight shear far from the central meridian). The game uses x = -E (its +X is
# west), z = N. Tile coordinates are 0.2 m units from the tile's south-west corner, delta-coded varints.
# Format KLT1 (decoded by src/kerala/KeralaTile.js decodeBinary):
#   'KLT1' s(tx) s(tz) s(district) int16[33*33] heights*4 | names | roads | buildings | water | landuse | waterways | rails | pois
#
# Data (c) OpenStreetMap contributors, ODbL. Elevation: SRTM (NASA / USGS, public domain).
import gzip, json, math, os, sys, time, collections
import numpy as np
import osmium
from shapely import wkb as swkb
from shapely.geometry import box, LineString, Polygon, Point
from shapely.ops import unary_union, linemerge
from shapely.prepared import prep
import shapely

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PBF = os.path.join(ROOT, '.cache/osm/kerala.osm.pbf')
SRTM = os.path.join(ROOT, '.cache/srtm')
OUT = os.path.join(ROOT, 'public/assets/world/kerala')
TILE = 2000.0
GRID = 33                      # elevation samples per tile edge (62.5 m)
ORIGIN = (76.2786, 9.9816)     # Marine Drive, Kochi: the game starts near (0, 0)
R_LAT = 110574.0
R_LON = 111320.0
UNIT = 0.2                     # metres per stored coordinate unit
KERALA_LL = (74.80, 8.15, 77.45, 12.85)  # lon/lat box around the state: anything outside is skipped while reading


def inside_ll(g):
    x0, y0, x1, y1 = g.bounds
    return not (x1 < KERALA_LL[0] or x0 > KERALA_LL[2] or y1 < KERALA_LL[1] or y0 > KERALA_LL[3])


def rss_gb():
    try:
        return int(open('/proc/self/statm').read().split()[1]) * 4096 / 1e9
    except Exception:
        return 0

DISTRICTS = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam',
             'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod']
ROAD_CLS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
            'service', 'track', 'pedestrian']
ROAD_MAP = {'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2,
            'secondary': 3, 'secondary_link': 3, 'tertiary': 4, 'tertiary_link': 4, 'unclassified': 5, 'road': 5,
            'residential': 6, 'living_street': 7, 'service': 8, 'track': 9, 'pedestrian': 10}
LANDUSE = {'paddy': 1, 'farmland': 1, 'meadow': 1, 'orchard': 2, 'plantation': 2, 'forest': 3, 'wood': 3,
           'residential': 4, 'commercial': 5, 'retail': 5, 'industrial': 6, 'grass': 7, 'recreation_ground': 7,
           'park': 7, 'village_green': 7, 'cemetery': 7, 'beach': 8, 'sand': 8, 'quarry': 9, 'bare_rock': 9,
           'religious': 10, 'scrub': 11, 'grassland': 11, 'wetland': 12}
POI = {'hindu': 1, 'christian': 2, 'muslim': 3}
POI_OTHER = {'bus_station': 4, 'fuel': 5, 'hospital': 6, 'school': 7, 'college': 7, 'university': 7, 'police': 8}
WATERWAY_W = {'river': 22, 'canal': 10, 'stream': 3, 'drain': 2}
BLD_KIND = {'house': 1, 'residential': 1, 'detached': 1, 'hut': 2, 'shed': 2, 'roof': 2, 'garage': 2,
            'apartments': 3, 'commercial': 4, 'retail': 4, 'office': 4, 'industrial': 5, 'warehouse': 5,
            'church': 6, 'temple': 7, 'mosque': 8, 'school': 9, 'college': 9, 'hospital': 10}
BLD_H = {'house': 6.5, 'residential': 7, 'apartments': 18, 'commercial': 10, 'retail': 8, 'industrial': 9, 'warehouse': 9,
         'church': 14, 'temple': 9, 'mosque': 12, 'school': 10, 'hospital': 16, 'hut': 3.5, 'shed': 3.5, 'roof': 4, 'garage': 3}


def proj_arr(lon, lat):
    lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
    return (lon - ORIGIN[0]) * R_LON * np.cos(np.radians(lat)), (lat - ORIGIN[1]) * R_LAT


def proj(lon, lat):
    return ((lon - ORIGIN[0]) * R_LON * math.cos(math.radians(lat)), (lat - ORIGIN[1]) * R_LAT)


def unproj_arr(e, n):
    lat = ORIGIN[1] + np.asarray(n) / R_LAT
    return ORIGIN[0] + np.asarray(e) / (R_LON * np.cos(np.radians(lat))), lat


def P(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(proj_arr(xy[:, 0], xy[:, 1])))


def num(s, d=None):
    try:
        return float(str(s).split(';')[0].replace('m', '').strip())
    except Exception:
        return d


def parts(g):
    if g.is_empty:
        return []
    if g.geom_type in ('LineString', 'Polygon'):
        return [g]
    if hasattr(g, 'geoms'):
        r = []
        for x in g.geoms:
            r += parts(x)
        return r
    return []


# ---------------------------------------------------------------------------------------- byte encoding
def uv(b, v):
    v = max(0, int(v))  # unsigned: a negative value would never terminate (OSM has buildings with height=-3)
    while True:
        x = v & 0x7f
        v >>= 7
        if v:
            b.append(x | 0x80)
        else:
            b.append(x)
            return


def sv(b, v):
    v = int(v)
    uv(b, -2 * v - 1 if v < 0 else 2 * v)


def line(b, coords, e0, n0):
    pts = []
    for (e, n) in coords:
        q = (int(round((e - e0) / UNIT)), int(round((n - n0) / UNIT)))
        if not pts or pts[-1] != q:
            pts.append(q)
    uv(b, len(pts))
    px = pz = 0
    for qx, qz in pts:
        sv(b, qx - px); sv(b, qz - pz)
        px, pz = qx, qz
    return len(pts)


class Tile:
    __slots__ = ('names', 'sec', 'cnt')
    SECS = ('r', 'b', 'w', 'lu', 'wl', 'rl', 'p')

    def __init__(self):
        self.names = {}
        self.sec = {k: bytearray() for k in self.SECS}
        self.cnt = {k: 0 for k in self.SECS}

    def name(self, s):
        if not s:
            return -1
        if s not in self.names:
            self.names[s] = len(self.names)
        return self.names[s]


tiles = collections.defaultdict(Tile)


def tile_ranges(bounds):
    x0, y0, x1, y1 = bounds
    for tx in range(math.floor(x0 / TILE), math.floor(x1 / TILE) + 1):
        for tz in range(math.floor(y0 / TILE), math.floor(y1 / TILE) + 1):
            yield tx, tz


def clip_lines(g, put):
    x0, y0, x1, y1 = g.bounds
    for tx, tz in tile_ranges(g.bounds):
        if x0 >= tx * TILE and x1 < (tx + 1) * TILE and y0 >= tz * TILE and y1 < (tz + 1) * TILE:
            pieces = [g]
        else:
            pieces = parts(g.intersection(box(tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE)))
        for pc in pieces:
            if pc.geom_type == 'LineString' and pc.length > 0.5:
                put(tiles[(tx, tz)], tx, tz, pc)


def clip_poly(g, put, simp, keep=None):
    for tx, tz in tile_ranges(g.bounds):
        if keep is not None and (tx, tz) not in keep:
            continue
        pc = g.intersection(box(tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE))
        for p in parts(pc):
            if p.geom_type != 'Polygon' or p.area < 40:
                continue
            p = p.simplify(simp)
            if p.is_empty or p.geom_type != 'Polygon':
                continue
            rings = [list(p.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in p.interiors if Polygon(r).area > 40]
            put(tiles[(tx, tz)], tx, tz, rings)


def put_poly(sec, kind):
    def put(T, tx, tz, rings):
        b = T.sec[sec]
        uv(b, kind); uv(b, len(rings))
        for ring in rings:
            line(b, ring, tx * TILE, tz * TILE)
        T.cnt[sec] += 1
    return put


# ---------------------------------------------------------------------------------------- read OSM
class Reader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.wkb = osmium.geom.WKBFactory()
        self.coast, self.districts, self.places, self.pois, self.majors = [], {}, [], [], []
        self.n = collections.Counter()

    def node(self, nd):
        t = nd.tags
        if not t:
            return
        loc = nd.location
        if t.get('place') in ('city', 'town', 'suburb', 'village', 'neighbourhood', 'quarter'):
            self.places.append((t['place'], t.get('name:en') or t.get('name'), t.get('name:ml') or '', loc.lon, loc.lat, int(num(t.get('population'), 0) or 0)))
        k = None
        if t.get('amenity') == 'place_of_worship':
            k = POI.get(t.get('religion'))
        elif t.get('amenity') in POI_OTHER:
            k = POI_OTHER[t['amenity']]
        elif t.get('railway') == 'station':
            k = 9
        if k:
            self.pois.append((k, loc.lon, loc.lat, t.get('name:en') or t.get('name') or ''))

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        try:
            if hw in ROAD_MAP and t.get('area') != 'yes':
                g0 = swkb.loads(self.wkb.create_linestring(w), hex=True)
                if not inside_ll(g0):
                    return
                g = P(g0)
                cls = ROAD_MAP[hw]
                lanes = int(num(t.get('lanes'), 0) or 0)
                one = t.get('oneway') in ('yes', '1', 'true') or t.get('junction') == 'roundabout' or hw in ('motorway', 'motorway_link')
                flags = (1 if one else 0) | (2 if t.get('bridge') not in (None, 'no') else 0) | (4 if t.get('tunnel') not in (None, 'no') else 0) | (8 if t.get('junction') == 'roundabout' else 0) | (16 if hw.endswith('_link') else 0)
                layer = int(num(t.get('layer'), 0) or 0)
                name = t.get('name:en') or t.get('name') or ''
                ref = t.get('ref') or ''
                surf = 1 if t.get('surface') in ('unpaved', 'dirt', 'gravel', 'ground', 'earth', 'mud', 'sand') or hw == 'track' else 0
                simp = 0.6 if cls <= 4 else 1.0

                def put(T, tx, tz, pc):
                    b = T.sec['r']
                    for v in (cls, lanes, flags, layer, T.name(name), T.name(ref), surf):
                        sv(b, v)
                    line(b, pc.simplify(simp).coords, tx * TILE, tz * TILE)
                    T.cnt['r'] += 1
                clip_lines(g, put)
                if cls <= 3:
                    s = g.simplify(25)
                    self.majors.append([cls, ref or name] + [int(v) for xy in s.coords for v in xy])
                self.n['road'] += 1
            elif t.get('waterway') in WATERWAY_W:
                g0 = swkb.loads(self.wkb.create_linestring(w), hex=True)
                if not inside_ll(g0):
                    return
                g = P(g0)
                kind = {'river': 0, 'canal': 1, 'stream': 2, 'drain': 3}[t['waterway']]
                wd = num(t.get('width'), None) or WATERWAY_W[t['waterway']]

                def put(T, tx, tz, pc):
                    b = T.sec['wl']; uv(b, kind); uv(b, int(round(wd * 10)))
                    line(b, pc.simplify(2).coords, tx * TILE, tz * TILE); T.cnt['wl'] += 1
                clip_lines(g, put)
            elif t.get('railway') in ('rail', 'light_rail', 'subway'):
                g0 = swkb.loads(self.wkb.create_linestring(w), hex=True)
                if not inside_ll(g0):
                    return
                g = P(g0)
                br = 2 if t.get('bridge') not in (None, 'no') else 0

                def put(T, tx, tz, pc):
                    b = T.sec['rl']; uv(b, br); line(b, pc.simplify(1).coords, tx * TILE, tz * TILE); T.cnt['rl'] += 1
                clip_lines(g, put)
            elif t.get('natural') == 'coastline':
                self.coast.append(P(swkb.loads(self.wkb.create_linestring(w), hex=True)))
        except Exception:
            self.n['bad_way'] += 1

    def area(self, a):
        t = a.tags
        try:
            if 'building' in t:
                kind = t.get('building')
                lv = num(t.get('building:levels'), None)
                h = num(t.get('height'), None)
                if h is None or h <= 0:
                    h = (lv * 3.3 + 1.0) if lv and lv > 0 else BLD_H.get(kind, 6.5)
                bk = BLD_KIND.get(kind, 0)
                if t.get('amenity') == 'place_of_worship':
                    bk = {'christian': 6, 'hindu': 7, 'muslim': 8}.get(t.get('religion'), bk)
                g0 = swkb.loads(self.wkb.create_multipolygon(a), hex=True)
                if not inside_ll(g0):
                    return
                g = P(g0)
                self.n['building'] += 1
                if self.n['building'] % 250000 == 0:
                    print('  buildings %d, tiles %d, rss %.1f GB' % (self.n['building'], len(tiles), rss_gb()), flush=True)
                for p in parts(g):
                    if p.geom_type != 'Polygon' or p.area < 20:
                        continue
                    c = p.centroid
                    tx, tz = math.floor(c.x / TILE), math.floor(c.y / TILE)
                    p = p.simplify(0.4)
                    if p.is_empty or p.geom_type != 'Polygon':
                        continue
                    ring = list(p.exterior.coords)[:-1]
                    if len(ring) < 3:
                        continue
                    T = tiles[(tx, tz)]
                    b = T.sec['b']; uv(b, bk); uv(b, int(round(min(h, 250) * 10)))
                    line(b, ring, tx * TILE, tz * TILE); T.cnt['b'] += 1
                return
            if t.get('boundary') == 'administrative' and t.get('admin_level') == '5':
                nm = t.get('name:en') or t.get('name')
                if nm in DISTRICTS:
                    self.districts[nm] = P(swkb.loads(self.wkb.create_multipolygon(a), hex=True)).buffer(0)
                return
            if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') in ('reservoir', 'basin', 'aquaculture'):
                g0 = swkb.loads(self.wkb.create_multipolygon(a), hex=True)
                if not inside_ll(g0):
                    return
                clip_poly(P(g0).buffer(0), put_poly('w', 0), 2.5)
                self.n['water'] += 1
                return
            k = LANDUSE.get(t.get('landuse')) or LANDUSE.get(t.get('natural')) or LANDUSE.get(t.get('leisure'))
            if k:
                g0 = swkb.loads(self.wkb.create_multipolygon(a), hex=True)
                if not inside_ll(g0):
                    return
                clip_poly(P(g0).buffer(0), put_poly('lu', k), 5)
                self.n['landuse'] += 1
        except Exception:
            self.n['bad_area'] += 1


# ---------------------------------------------------------------------------------------- SRTM
class Srtm:
    def __init__(self, d):
        self.tiles, self.dir = {}, d

    def tile(self, la, lo):
        k = (la, lo)
        if k not in self.tiles:
            f = os.path.join(self.dir, 'N%02dE%03d.hgt.gz' % (la, lo))
            if os.path.exists(f):
                a = np.frombuffer(gzip.open(f).read(), dtype='>i2').astype(np.float32)
                n = int(round(math.sqrt(a.size)))
                a = a.reshape(n, n)
                a[a < -1000] = 0
                self.tiles[k] = a
            else:
                self.tiles[k] = None
        return self.tiles[k]

    def heights(self, lons, lats):
        out = np.zeros(lons.shape, dtype=np.float32)
        las, los = np.floor(lats).astype(int), np.floor(lons).astype(int)
        for la, lo in set(zip(las.ravel().tolist(), los.ravel().tolist())):
            t = self.tile(la, lo)
            if t is None:
                continue
            m = (las == la) & (los == lo)
            n = t.shape[0] - 1
            fx = (lons[m] - lo) * n
            fy = (1 - (lats[m] - la)) * n
            x0 = np.clip(fx.astype(int), 0, n - 1); y0 = np.clip(fy.astype(int), 0, n - 1)
            ax, ay = fx - x0, fy - y0
            out[m] = (t[y0, x0] * (1 - ax) + t[y0, x0 + 1] * ax) * (1 - ay) + (t[y0 + 1, x0] * (1 - ax) + t[y0 + 1, x0 + 1] * ax) * ay
        return out


def main():
    args = sys.argv[1:]
    only = args[args.index('--only-district') + 1] if '--only-district' in args else None
    t0 = time.time()
    rd = Reader()
    rd.apply_file(PBF, locations=True, idx='sparse_mem_array')
    print('read', dict(rd.n), 'districts', len(rd.districts), 'tiles touched', len(tiles), '%.0fs' % (time.time() - t0), flush=True)
    missing = [d for d in DISTRICTS if d not in rd.districts]
    if missing:
        print('WARNING missing districts', missing)

    dist = rd.districts
    state = unary_union(list(dist.values())).buffer(0)
    area_src = dist[only] if only else state
    pa = prep(area_src.buffer(3000))
    keep = set()
    minE, minN, maxE, maxN = area_src.bounds
    for tx in range(math.floor(minE / TILE) - 2, math.floor(maxE / TILE) + 3):
        for tz in range(math.floor(minN / TILE) - 2, math.floor(maxN / TILE) + 3):
            if pa.intersects(box(tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE)):
                keep.add((tx, tz))
    print('tiles kept', len(keep), flush=True)

    # the sea: west of the coastline (OSM: land on the left of the way's direction)
    try:
        coast = linemerge(rd.coast)
        main_c = sorted(parts(coast), key=lambda l: -l.length)[0]
        cs = list(main_c.coords)
        a, b = cs[0], cs[-1]
        sea = Polygon(cs + [(min(minE, b[0]) - 60000, b[1]), (min(minE, a[0]) - 60000, a[1])]).buffer(0)
        print('sea polygon %.0f km2' % (sea.area / 1e6), flush=True)
        clip_poly(sea, put_poly('w', 9), 8, keep)
    except Exception as ex:
        print('WARNING sea:', ex)

    for k, lon, lat, nm in rd.pois:
        e, n = proj(lon, lat)
        tx, tz = math.floor(e / TILE), math.floor(n / TILE)
        if (tx, tz) in keep:
            T = tiles[(tx, tz)]
            b = T.sec['p']; uv(b, k); sv(b, round((e - tx * TILE) / UNIT)); sv(b, round((n - tz * TILE) / UNIT)); sv(b, T.name(nm)); T.cnt['p'] += 1

    # elevation + write
    srtm = Srtm(SRTM)
    os.makedirs(os.path.join(OUT, 't'), exist_ok=True)
    dprep = {nm: prep(g) for nm, g in dist.items()}
    total, index = 0, []
    for (tx, tz) in sorted(keep):
        T = tiles.get((tx, tz)) or Tile()
        es = np.linspace(tx * TILE, (tx + 1) * TILE, GRID)
        ns = np.linspace(tz * TILE, (tz + 1) * TILE, GRID)
        E, N = np.meshgrid(es, ns)
        lons, lats = unproj_arr(E, N)
        h = srtm.heights(lons, lats)
        hq = np.clip(np.round(h * 4), -32000, 32000).astype('<i2')
        c = Point((tx + 0.5) * TILE, (tz + 0.5) * TILE)
        did = next((i for i, nm in enumerate(DISTRICTS) if nm in dprep and dprep[nm].contains(c)), -1)
        b = bytearray(b'KLT1')
        sv(b, tx); sv(b, tz); sv(b, did)
        b += hq.tobytes()
        names = sorted(T.names, key=lambda s: T.names[s])
        uv(b, len(names))
        for nm in names:
            bb = nm.encode('utf-8')[:255]
            uv(b, len(bb)); b += bb
        for k in ('r', 'b', 'w', 'lu', 'wl', 'rl', 'p'):
            uv(b, T.cnt[k]); b += T.sec[k]
        with open(os.path.join(OUT, 't', '%d_%d.bin' % (tx, tz)), 'wb') as f:
            f.write(b)
        total += len(b)
        index.append([tx, tz, did, int(hq.max() / 4), T.cnt['r'], T.cnt['b']])

    def simp_poly(g, tol):
        out = []
        for p in parts(g.simplify(tol)):
            if p.geom_type == 'Polygon':
                out.append([[int(x), int(y)] for x, y in p.exterior.coords])
        return out
    places = []
    for kind, nm, ml, lon, lat, pop in rd.places:
        e, n = proj(lon, lat)
        if (math.floor(e / TILE), math.floor(n / TILE)) in keep and nm:
            places.append([kind, nm, ml, int(e), int(n), pop])
    sp = prep(state.buffer(3000))
    majors = [m for m in rd.majors if len(m) >= 6 and sp.contains(Point(m[2], m[3]))]
    idx = {'v': 2, 'format': 'bin', 'origin': ORIGIN, 'tile': TILE, 'grid': GRID, 'districts': DISTRICTS,
           'tiles': index,
           'outlines': {nm: simp_poly(g, 400) for nm, g in dist.items()},
           'places': places, 'majors': majors,
           'credit': 'Map data (c) OpenStreetMap contributors (ODbL). Elevation: SRTM (NASA/USGS).'}
    s = json.dumps(idx, separators=(',', ':'))
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        f.write(s)
    print('wrote %d tiles, %.1f MB tiles + %.1f MB index, %.0fs' % (len(keep), total / 1e6, len(s) / 1e6, time.time() - t0))


if __name__ == '__main__':
    main()
