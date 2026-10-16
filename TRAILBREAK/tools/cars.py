#!/usr/bin/env python3
"""Convert a Sketchfab car download (glTF) into the game's truck body: a GLB in the design frame, and its layout.

usage: python3 -I tools/cars.py <download dir> tools/cars/<id>.json public/assets/trucks

The config (tools/cars/<id>.json) says how the model sits (its forward, up and left axes), the wheelbase it must have
(the scale), what each material is (its role: paint, trim, glass, head, tail, tyre, rim, ...) and what to leave out.
This writes:
  <id>.glb   the body at stock height in the design frame of physics/trucks.js (origin on the ground mid-wheelbase,
             +x left, +y up, +z forward), one mesh per role and material, named "<role>:<material>"; the road wheels
             (and the spare) taken off, since the game fits its own on its physics; one rim kept apart, as the mesh
             "rim:..." at unit radius with the axle along x and its face toward +x; textures as WebP, flat ones folded
             into their material's colour.
  <id>.json  what was measured: the wheel centres, radius and width, the tracks and wheelbase, the extent of the body,
             the head and tail lamps, the roof, the bumpers, the mirrors' reach; plus the config's own layout entries.
Needs numpy and Pillow; a config with "reduce" (the share of a dense mesh's triangles to take away) also needs
fast-simplification (pip install fast-simplification).
"""
import hashlib, io, json, math, os, struct, sys
import numpy as np
from PIL import Image

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
AXIS = {'+x': (0, 1), '-x': (0, -1), '+y': (1, 1), '-y': (1, -1), '+z': (2, 1), '-z': (2, -1)}
# roles the game draws with its own materials (the paint takes the player's colour and the mud; glass cracks; lamps
# light up), and the ones taken off
GAME_ROLES = {'paint', 'glass', 'screen', 'head', 'tail', 'reverse', 'amber'}
WHEEL_ROLES = {'tyre', 'rim', 'hub', 'spare'}           # ('spare': the parts of a spare wheel, when a config names them)


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'scale' in n: m = np.diag([*n['scale'], 1.0]) @ m
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        R = np.eye(4); R[:3, :3] = r; m = R @ m
    if 'translation' in n:
        T = np.eye(4); T[:3, 3] = n['translation']; m = T @ m
    return m


def load(path):
    """The glTF and its triangles in world space: [{node, name, mat, pos, nor, uv, tri}]."""
    g = json.load(open(path))
    d = os.path.dirname(path)
    bins = [open(os.path.join(d, b['uri']), 'rb').read() for b in g['buffers']]

    def acc(i):
        a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]; binary = bins[v.get('buffer', 0)]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0); dt = COMP[a['componentType']]; n = NC[a['type']]
        st = v.get('byteStride', 0); item = np.dtype(dt).itemsize * n
        if st and st != item:
            raw = np.frombuffer(binary, np.uint8, count=st * (a['count'] - 1) + item, offset=off)
            raw = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], item), strides=(st, 1))
            out = np.frombuffer(raw.copy().tobytes(), dt).reshape(a['count'], n)
        else:
            out = np.frombuffer(binary, dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
        if a.get('normalized'):
            out = out.astype(np.float64) / np.iinfo(dt).max
        return out

    prims = []

    def visit(i, parent, path=''):
        n = g['nodes'][i]; m = parent @ node_matrix(n)
        path = f"{path}/{n.get('name', '')}"
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4: continue
                pos = acc(p['attributes']['POSITION']).astype(np.float64)
                pw = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                nw = None
                if 'NORMAL' in p['attributes']:
                    nw = acc(p['attributes']['NORMAL']).astype(np.float64) @ np.linalg.inv(m[:3, :3])
                    nw /= np.linalg.norm(nw, axis=1, keepdims=True) + 1e-12
                uv = acc(p['attributes']['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in p['attributes'] else None
                tri = (acc(p['indices']).reshape(-1) if 'indices' in p else np.arange(len(pos))).astype(np.int64).reshape(-1, 3)
                if np.linalg.det(m[:3, :3]) < 0: tri = tri[:, [0, 2, 1]]
                prims.append({'node': i, 'name': path, 'mat': p.get('material', -1), 'pos': pw, 'nor': nw, 'uv': uv, 'tri': tri})
        for c in n.get('children', []): visit(c, m, path)

    for r in g['scenes'][g.get('scene', 0)]['nodes']: visit(r, np.eye(4))
    return g, prims


def axes_matrix(cfg):
    """Model coordinates -> design frame (x left, y up, z forward)."""
    A = np.zeros((3, 3))
    for row, key in enumerate(('left', 'up', 'forward')):
        k, s = AXIS[cfg['axes'][key]]
        A[row, k] = s
    assert abs(abs(np.linalg.det(A)) - 1) < 1e-9, 'axes must be a rotation or reflection'
    return A


def role_of(cfg, prim):
    for rule in cfg.get('nodes', []):                        # by name (the node's or its parents'): [substring, role, (materials)]
        if rule[0] in prim['name'] and (len(rule) < 3 or prim['mat'] in rule[2]): return rule[1]
    return cfg['materials'].get(str(prim['mat']), cfg.get('default', 'trim'))


def split_wheels(tris, roles, cfg):
    """Wheel triangles -> 'FL', 'FR', 'RL', 'RR' or 'spare' by where they are (None: not a wheel)."""
    wheel = np.array([r in WHEEL_ROLES for r in roles])
    c = tris[wheel].mean(1)
    sp = np.array([r == 'spare' for r in roles[wheel]])

    def axles(sel):
        zf, zr = np.percentile(c[sel, 2], 85), np.percentile(c[sel, 2], 15)
        for _ in range(8):
            front = np.abs(c[:, 2] - zf) < np.abs(c[:, 2] - zr)
            zf, zr = np.median(c[sel & front, 2]), np.median(c[sel & ~front, 2])
        return zf, zr, front

    zf, zr, front = axles(~sp)
    spare = cfg.get('spare')
    if spare and not sp.any():
        # the spare: past an axle (on the tailgate or the bonnet), above the road wheels (on the roof) or between them
        ylow = np.percentile(c[:, 1], 2)
        R = (np.percentile(c[:, 1], 60) - ylow)
        if spare == 'rear': sp = c[:, 2] < zr - 1.15 * R
        elif spare == 'front': sp = c[:, 2] > zf + 1.15 * R
        elif spare == 'high': sp = c[:, 1] > ylow + 2.3 * R
        elif spare == 'under': sp = np.abs(c[:, 2] - (zf + zr) / 2) < abs(zf - zr) * 0.3
        zf, zr, front = axles(~sp)
    # (left of the middle between the outermost wheel parts: a median can land inside one side's wheels when the two
    # sides are near-equal in triangles)
    left = c[:, 0] > (c[~sp, 0].min() + c[~sp, 0].max()) / 2
    lab = np.where(front, np.where(left, 'FL', 'FR'), np.where(left, 'RL', 'RR')).astype(object)
    lab[sp] = 'spare'
    out = np.full(len(tris), None, dtype=object)
    out[np.where(wheel)[0]] = lab
    return out


def parts_of(tris, mats):
    """Each triangle's connected part: triangles of one material sharing a corner (by position) are one part."""
    key = np.c_[np.round(tris.reshape(-1, 3) * 1e4).astype(np.int64), np.repeat(mats, 3)]
    _, vid = np.unique(key, axis=0, return_inverse=True)
    vid = vid.reshape(-1, 3)
    up = np.arange(vid.max() + 1)

    def root(v):
        while up[v] != v:
            up[v] = up[up[v]]; v = up[v]
        return v
    for a, b, c in vid.tolist():
        ra, rb, rc = root(a), root(b), root(c)
        up[rb] = ra; up[rc] = ra
    roots = np.array([root(v) for v in vid[:, 0].tolist()])
    return np.unique(roots, return_inverse=True)[1]


def tex_image(g, src_dir, tex_index):
    t = g['textures'][tex_index]
    src = t.get('source')
    if src is None:
        for e in t.get('extensions', {}).values():
            if 'source' in e: src = e['source']
    img = g['images'][src]
    return Image.open(os.path.join(src_dir, img['uri']))


class GLB:
    """A small glTF writer: meshes of indexed triangles, PBR materials, WebP textures in the binary chunk."""
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'TRAILBREAK tools/cars.py'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                  'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
                  'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}], 'extensionsUsed': ['EXT_texture_webp'], 'extensionsRequired': ['EXT_texture_webp']}
        self.bin = bytearray()

    def view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target: v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, kind, comp, target, minmax=False):
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': comp, 'count': int(arr.shape[0]), 'type': kind}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def image(self, im, quality=84):
        b = io.BytesIO()
        im.save(b, 'WEBP', quality=quality, method=6)
        self.j['images'].append({'bufferView': self.view(b.getvalue()), 'mimeType': 'image/webp'})
        self.j['textures'].append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(self.j['images']) - 1}}})
        return len(self.j['textures']) - 1

    def mesh(self, name, pos, nor, uv, tri, material):
        attrs = {'POSITION': self.accessor(pos.astype(np.float32), 'VEC3', 5126, 34962, True), 'NORMAL': self.accessor(nor.astype(np.float32), 'VEC3', 5126, 34962)}
        if uv is not None: attrs['TEXCOORD_0'] = self.accessor(uv.astype(np.float32), 'VEC2', 5126, 34962)
        idx = tri.reshape(-1)
        ind = self.accessor(idx.astype(np.uint16 if len(pos) < 65536 else np.uint32), 'SCALAR', 5123 if len(pos) < 65536 else 5125, 34963)
        self.j['meshes'].append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ind, 'material': material}]})
        self.j['nodes'].append({'name': name, 'mesh': len(self.j['meshes']) - 1})
        self.j['scenes'][0]['nodes'].append(len(self.j['nodes']) - 1)

    def save(self, path):
        while len(self.bin) % 4: self.bin.append(0)
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.j, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(self.bin)


def smooth_normals(pos, tri):
    n = np.zeros_like(pos)
    fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    for k in range(3): np.add.at(n, tri[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def main(src_dir, cfg_path, out_dir):
    cfg = json.load(open(cfg_path))
    tid = cfg['id']
    g, prims = load(os.path.join(src_dir, 'scene.gltf'))
    A = axes_matrix(cfg)
    # every triangle, in design axes (not yet scaled or placed), with its role and material
    T, N, U, R, MT, HASUV = [], [], [], [], [], []
    for p in prims:
        role = role_of(cfg, p)
        if role == 'drop': continue
        pos = p['pos'] @ A.T
        nor = p['nor'] @ A.T if p['nor'] is not None else None
        T.append(pos[p['tri']])
        N.append(nor[p['tri']] if nor is not None else np.repeat(np.cross(pos[p['tri'][:, 1]] - pos[p['tri'][:, 0]], pos[p['tri'][:, 2]] - pos[p['tri'][:, 0]])[:, None, :], 3, 1))
        U.append(p['uv'][p['tri']] if p['uv'] is not None else np.zeros((len(p['tri']), 3, 2)))
        R += [role] * len(p['tri']); MT += [p['mat']] * len(p['tri']); HASUV += [p['uv'] is not None] * len(p['tri'])
    tris, nors, uvs = np.concatenate(T), np.concatenate(N), np.concatenate(U)
    roles, mats, hasuv = np.array(R, dtype=object), np.array(MT), np.array(HASUV)
    # a body whose paint, glass and lamps are all one textured material: told apart by the texture under each
    # triangle (see-through: glass; glowing: a lamp, head or tail by which end; the paint's colour: paint)
    for tm in cfg.get('byTexture', []):
        sel = np.where(mats == tm['mat'])[0]
        src = g['materials'][tm['mat']]
        # where to look: the triangle's middle, or ("vote") its corners, its edges' middles and its middle, a role going
        # to what most of them show (a seam or a speck under a painted panel's triangle doesn't leave it unpainted)
        bary = np.array([[1 / 3, 1 / 3, 1 / 3]] + ([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]] if tm.get('vote') else []))
        def sample(tex_info, mode):
            im = np.asarray(tex_image(g, src_dir, tex_info['index']).convert(mode)).astype(np.float64) / 255.0
            uvk = np.einsum('kj,tjc->tkc', bary, uvs[sel])
            px = (np.mod(uvk[..., 0], 1.0) * (im.shape[1] - 1)).round().astype(int)
            py = (np.mod(uvk[..., 1], 1.0) * (im.shape[0] - 1)).round().astype(int)
            return im[py, px]                                 # [triangle, sample, channel]
        most = lambda hit: hit.mean(1) >= 0.5
        col = sample(src['pbrMetallicRoughness']['baseColorTexture'], 'RGBA')
        role = np.array([roles[i] for i in sel], dtype=object)
        if 'paint' in tm:
            near = most(np.linalg.norm(col[..., :3] - np.array(tm['paint']) / 255.0, axis=-1) < tm.get('tol', 0.25))
            role[near] = 'paint'
        # (and any colour to a role: [[r, g, b, tolerance, role], ...], e.g. a lamps' texture: red the tail, orange amber)
        for r, g_, b, tol, rl in tm.get('colors', []):
            role[most(np.linalg.norm(col[..., :3] - np.array([r, g_, b]) / 255.0, axis=-1) < tol)] = rl
        if 'emissiveTexture' in src and tm.get('lamps', True):
            em = sample(src['emissiveTexture'], 'RGB')
            lit = most(em.max(-1) > tm.get('lit', 0.5))
            zc = tris[sel].mean(1)[:, 2]
            role[lit] = np.where(zc[lit] > np.median(tris.reshape(-1, 3)[:, 2]), 'head', 'tail')
        if 'glass' in tm: role[most(col[..., 3] < tm['glass'])] = 'glass'
        roles[sel] = role
    if np.linalg.det(A) < 0:                                 # a mirroring axis swap turns the triangles inside out
        tris = tris[:, [0, 2, 1]]; nors = nors[:, [0, 2, 1]]; uvs = uvs[:, [0, 2, 1]]

    # a model whose wheels aren't parts of their own (a scan, one skin over the whole car; or its materials merged into
    # one): told apart by where they are, in the model's units and the design axes: {"z": [front, rear], "x": half the
    # track, "y": axle height, "r": tyre radius, "w": tyre width, "rim": rim radius}
    if cfg.get('wheelsAt'):
        W = cfg['wheelsAt']
        c0 = tris.mean(1)
        for z in W['z']:
            for sx in (1, -1):
                d = np.hypot(c0[:, 1] - W['y'], c0[:, 2] - z)
                inw = (np.abs(c0[:, 0] - sx * W['x']) < W['w'] / 2) & (d < W['r'])
                roles[inw] = 'tyre'
                # the rim: inside its radius on the wheel's outer half (on the inner half: the brake and the hub)
                outer = c0[:, 0] * sx > W['x'] - W['w'] * W.get('hubAt', 0.15)
                roles[inw & (d < W['rim']) & outer] = 'rim'
                roles[inw & (d < W['rim']) & ~outer] = 'hub'
    # (and the ground a scan caught around the wheels: below this height and not a wheel)
    if 'groundBelow' in cfg:
        roles[(tris.mean(1)[:, 1] < cfg['groundBelow']) & ~np.isin(roles, list(WHEEL_ROLES))] = 'drop'

    # ---- the wheels: where they are and how big, then the scale and the origin
    wl = split_wheels(tris, roles, cfg)
    if cfg.get('rimInTyre'):
        # a wheel modelled whole (tyre and rim one mesh): what lies within this share of the tyre's radius is its rim
        c0 = tris.mean(1)
        for k in ('FL', 'FR', 'RL', 'RR'):
            sel = (wl == k) & (roles == 'tyre')
            v = tris[sel].reshape(-1, 3); lo, hi = v.min(0), v.max(0); cc = (lo + hi) / 2
            roles[sel & (np.hypot(c0[:, 1] - cc[1], c0[:, 2] - cc[2]) < (hi[1] - lo[1]) / 2 * cfg['rimInTyre'])] = 'rim'
    wheels = {}
    for k in ('FL', 'FR', 'RL', 'RR', 'spare'):
        sel = wl == k
        tyre = sel & np.isin(roles, ['tyre', 'spare'])
        if not sel.any(): continue
        v = tris[tyre if tyre.any() else sel].reshape(-1, 3)
        lo, hi = v.min(0), v.max(0)
        wheels[k] = {'lo': lo, 'hi': hi, 'c': (lo + hi) / 2, 'r': (hi[1] - lo[1]) / 2, 'w': hi[0] - lo[0], 'n': int(sel.sum())}
    road = [wheels[k] for k in ('FL', 'FR', 'RL', 'RR')]
    zF = (wheels['FL']['c'][2] + wheels['FR']['c'][2]) / 2
    zR = (wheels['RL']['c'][2] + wheels['RR']['c'][2]) / 2
    s = cfg['wheelbase'] / (zF - zR)
    ground = min(w['lo'][1] for w in road)
    origin = np.array([np.mean([w['c'][0] for w in road]), ground, (zF + zR) / 2])
    # (a model drawn a little wide or narrow for its wheelbase: scaleX brings it to the real car's width)
    k3 = np.array([s * cfg.get('scaleX', 1.0), s * cfg.get('scaleY', 1.0), s])
    place = lambda p: (p - origin) * k3
    tris = place(tris)
    if cfg.get('scaleX', 1.0) != 1.0 or cfg.get('scaleY', 1.0) != 1.0:
        nors = nors / k3 * s                                 # (normals: by the inverse of the stretch)
        nors /= np.linalg.norm(nors, axis=-1, keepdims=True) + 1e-12
    for w in wheels.values():
        for k in ('lo', 'hi', 'c'): w[k] = place(w[k])
        w['r'] *= s * cfg.get('scaleY', 1.0); w['w'] *= s * cfg.get('scaleX', 1.0)

    # ---- one rim, apart: the front left's, centred, unit radius, face toward +x (outward on the left)
    # (or another left wheel's, rimFrom, where the model's front tyres carry their rims in them)
    rim_from = cfg.get('rimFrom', 'FL')
    rim_sel = (wl == rim_from) & np.isin(roles, ['rim', 'hub'])
    rim = None
    if rim_sel.any():
        W = wheels[rim_from]
        rv = tris[rim_sel] - W['c']
        rr = np.sqrt(rv[..., 1] ** 2 + rv[..., 2] ** 2).max()
        rim = {'tris': rv / rr, 'nors': nors[rim_sel], 'uvs': uvs[rim_sel], 'mats': mats[rim_sel], 'hasuv': hasuv[rim_sel], 'radius': rr, 'width': (rv[..., 0].max() - rv[..., 0].min())}

    keep = (wl == None) & (roles != 'drop')                   # noqa: E711 (object array)
    # parts to clear, each whole where it lies inside a box (design frame, after placing): [x0, y0, z0, x1, y1, z1,
    # (materials)] (a model's static axles, springs and arms: the game draws its own, moving with the wheels)
    if cfg.get('dropParts'):
        part = parts_of(tris, mats)
        n = part.max() + 1
        plo, phi = np.full((n, 3), np.inf), np.full((n, 3), -np.inf)
        np.minimum.at(plo, part, tris.min(1)); np.maximum.at(phi, part, tris.max(1))
        pmat = np.zeros(n, dtype=np.int64); pmat[part] = mats
        for b in cfg['dropParts']:
            inb = np.all((plo >= np.array(b[:3])) & (phi <= np.array(b[3:6])), axis=1)
            if len(b) > 6: inb &= np.isin(pmat, b[6])
            keep &= ~inb[part]
    for r in cfg.get('keepWheels', []): keep |= wl == r       # (e.g. a spare to leave on its carrier)
    tris, nors, uvs, roles, mats, hasuv = tris[keep], nors[keep], uvs[keep], roles[keep], mats[keep], hasuv[keep]

    # ---- glass: the windscreen apart (it cracks and stays in; the side and back glass bursts)
    c = tris.mean(1)
    fn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    if 'glassAbove' in cfg:
        # (see-through below the windows: the lamps' lenses, head lamps in front and tail lamps behind)
        low = (roles == 'glass') & (c[:, 1] < cfg['glassAbove'])
        roles[low] = np.where(c[low, 2] > 0, 'head', 'tail')
    gl = roles == 'glass'
    ws = gl & (np.abs(fn[:, 2]) > cfg.get('screenNormal', 0.5)) & (c[:, 2] > cfg.get('screenZ', 0.0))
    roles[ws] = 'screen'
    # lamps: the head lamps left and right apart (each can break alone)
    for lamp in ('head',):
        on = roles == lamp
        roles[on & (c[:, 0] > 0)] = lamp + '_l'
        roles[on & (c[:, 0] <= 0)] = lamp + '_r'

    # ---- what the game needs to know
    body = ~np.isin(roles, ['screen', 'glass'])
    bv = tris[body].reshape(-1, 3)
    lo, hi = bv.min(0), bv.max(0)
    mirror = cfg.get('mirrorHalf')
    core = bv[np.abs(bv[:, 1] - (lo[1] + hi[1]) / 2) < (hi[1] - lo[1]) * 0.25]          # (the waist: no mirrors)
    def lamp_info(name):
        sel = roles == name
        if not sel.any(): return None
        t = tris[sel]
        area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) / 2
        cc = (t.mean(1) * area[:, None]).sum(0) / area.sum()
        return [round(float(x), 4) for x in cc] + [round(float(math.sqrt(area.sum() / math.pi)), 4)]
    layout = {
        'id': tid, 'scale': s,
        'wheels': {k: {'c': [round(float(x), 4) for x in w['c']], 'r': round(float(w['r']), 4), 'w': round(float(w['w']), 4)} for k, w in wheels.items()},
        'wheelbase': cfg['wheelbase'],
        'track': [round(float(wheels['FL']['c'][0] - wheels['FR']['c'][0]), 4), round(float(wheels['RL']['c'][0] - wheels['RR']['c'][0]), 4)],
        'axleZ': [round(float(wheels['FL']['c'][2]), 4), round(float(wheels['RL']['c'][2]), 4)],
        'bbox': [[round(float(x), 4) for x in lo], [round(float(x), 4) for x in hi]],
        'half': round(float(np.abs(core[:, 0]).max()), 4),
        'heads': [x for x in [lamp_info('head_l')] if x],
        'tails': [x for x in [lamp_info('tail')] if x],
        'rim': {'radius': round(float(rim['radius']), 4), 'width': round(float(rim['width']), 4)} if rim else None,
        'tris': int(len(tris)) + (int(len(rim['tris'])) if rim else 0),
    }
    layout.update(cfg.get('layout', {}))

    # ---- the GLB: one mesh per role and material, textures resized and flat ones folded into the colour
    out = GLB()
    tex_cache, mat_cache = {}, {}
    tsize = cfg.get('texSize', 1024)

    def texture(ti, kind):
        key = (ti, kind)
        if key in tex_cache: return tex_cache[key]
        im = tex_image(g, src_dir, ti)
        im = im.convert('RGBA' if kind == 'color' and im.mode in ('RGBA', 'LA', 'P') else 'RGB')
        a = np.asarray(im.resize((32, 32))).astype(np.float64)
        flat = kind == 'color' and a[..., :3].std(axis=(0, 1)).max() < cfg.get('flatStd', 3.0) and (a.shape[-1] == 3 or a[..., 3].min() > 250)
        if flat:
            tex_cache[key] = ('flat', (a[..., :3].mean(axis=(0, 1)) / 255.0).tolist())
            return tex_cache[key]
        lim = tsize if kind != 'mr' else tsize // 2
        if max(im.size) > lim:
            k = lim / max(im.size)
            im = im.resize((max(4, round(im.size[0] * k)), max(4, round(im.size[1] * k))), Image.LANCZOS)
        tex_cache[key] = ('tex', out.image(im, 86 if kind == 'color' else 80))
        return tex_cache[key]

    def srgb_to_lin(c): return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]

    def material(mi, role):
        key = (mi, role)
        if key in mat_cache: return mat_cache[key]
        src = g['materials'][mi] if mi >= 0 else {}
        pbr = src.get('pbrMetallicRoughness', {})
        m = {'name': f'{role}:{src.get("name", mi)}', 'pbrMetallicRoughness': {'baseColorFactor': pbr.get('baseColorFactor', [1, 1, 1, 1]),
             'metallicFactor': pbr.get('metallicFactor', 1), 'roughnessFactor': pbr.get('roughnessFactor', 1)}, 'doubleSided': bool(src.get('doubleSided', False))}
        over = cfg.get('override', {}).get(str(mi), {})
        if role not in GAME_ROLES:
            if 'baseColorTexture' in pbr and 'color' not in over:
                kind, v = texture(pbr['baseColorTexture']['index'], 'color')
                if kind == 'flat':
                    f = m['pbrMetallicRoughness']['baseColorFactor']
                    m['pbrMetallicRoughness']['baseColorFactor'] = [a * b for a, b in zip(srgb_to_lin(v), f[:3])] + [f[3]]
                else: m['pbrMetallicRoughness']['baseColorTexture'] = {'index': v}
            if 'metallicRoughnessTexture' in pbr and not over.get('noMR'):
                kind, v = texture(pbr['metallicRoughnessTexture']['index'], 'mr')
                if kind == 'tex': m['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': v}
            if 'normalTexture' in src and not over.get('noNormal'):
                kind, v = texture(src['normalTexture']['index'], 'normal')
                if kind == 'tex': m['normalTexture'] = {'index': v, 'scale': src['normalTexture'].get('scale', 1)}
            if src.get('alphaMode') in ('BLEND', 'MASK'): m['alphaMode'] = src['alphaMode']
            if 'alphaCutoff' in src: m['alphaCutoff'] = src['alphaCutoff']
            # (no glow: the game lights the lamps itself)
        if 'color' in over: m['pbrMetallicRoughness']['baseColorFactor'] = srgb_to_lin(over['color'][:3]) + [over['color'][3] if len(over['color']) > 3 else 1]
        if 'alpha' in over:                                   # (e.g. an atlas marked see-through that isn't: "OPAQUE")
            m['alphaMode'] = over['alpha']
            if over['alpha'] != 'MASK': m.pop('alphaCutoff', None)
        for k in ('metallic', 'roughness'):
            if k in over: m['pbrMetallicRoughness'][k + 'Factor'] = over[k]
        out.j['materials'].append(m)
        mat_cache[key] = len(out.j['materials']) - 1
        return mat_cache[key]

    cell = cfg.get('cell', 0)

    def cluster(t, n, u, hu, cell):
        """Vertex clustering: corners in the same small cell (and, textured, near the same spot of the texture) become
        one, triangles left with fewer than three corners go (bolts, over-fine curves; the shape holds to the cell)."""
        k = np.floor(t.reshape(-1, 3) / cell).astype(np.int64)
        if hu: k = np.c_[k, np.floor(u.reshape(-1, 2) * 48).astype(np.int64)]
        _, first, inv = np.unique(k, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1, 3)
        keep = (inv[:, 0] != inv[:, 1]) & (inv[:, 1] != inv[:, 2]) & (inv[:, 0] != inv[:, 2])
        # each cluster at the mean of its corners
        flat = t.reshape(-1, 3); cnt = np.bincount(inv.reshape(-1), minlength=len(first)).astype(np.float64)
        mean = np.stack([np.bincount(inv.reshape(-1), flat[:, a], len(first)) for a in range(3)], 1) / cnt[:, None]
        return mean[inv[keep]], n[keep], u[keep]

    def emit(name, t, n, u, mi, role, hu):
        mat = material(mi, role)
        # (no texture on it: no uvs either, and the corners weld without them)
        mj = out.j['materials'][mat]
        if hu and not ('baseColorTexture' in mj['pbrMetallicRoughness'] or 'metallicRoughnessTexture' in mj['pbrMetallicRoughness'] or 'normalTexture' in mj):
            hu = False
            u = np.zeros_like(u)
        cm = cfg.get('cellMat', {}).get(str(mi), cell)                     # (per material too: {"0": 0.02})
        if cm and role not in ('glass', 'screen', 'rim') and len(t) > 64:
            t, n, u = cluster(t, n, u, hu, cm)
            if not len(t): return
        # (vertices shared where position, normal and uv all match: the source's own indexing comes back)
        flat = t.reshape(-1, 3); fnr = n.reshape(-1, 3); fuv = u.reshape(-1, 2)
        key = np.round(np.c_[flat * 1e4, fnr * 1e3, fuv * 1e4]).astype(np.int64)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        pos, nor, uv = flat[first], fnr[first], fuv[first]
        nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-12
        tri = inv.reshape(-1, 3)
        red = cfg.get('reduce', 0)
        if isinstance(red, dict): red = red.get(role, red.get('*', 0))      # (per role: {"paint": 0.5, "*": 0.75})
        red = cfg.get('reduceMat', {}).get(str(mi), red)                    # (and per material: {"0": 0.95})
        if role == 'rim': red = cfg.get('rimReduce', 0)                      # (a rim drawn on every wheel: only if asked)
        if red and len(tri) > cfg.get('reduceOver', 3000) and role not in ('glass', 'screen'):
            pos, nor, uv, tri = simplify(flat, fnr, fuv, hu, red)
        out.mesh(name, pos, nor, uv if hu else None, tri, mat)

    def simplify(flat, fnr, fuv, hu, red):
        """Quadric edge collapses on the surface welded whole (by position, and by uv where it is textured: the
        seams stay), then normals again with a crease: smooth across gentle bends, a hard edge where faces meet
        at more than 35 degrees (the panels' edges stay sharp). Corners whose normals point apart stay apart: a panel
        modelled with its inside face (a thin shell) is two surfaces, not one whose normals cancel out."""
        import fast_simplification as fs
        key = np.c_[np.round(flat * 1e4).astype(np.int64), np.round(fnr * 2).astype(np.int64)]
        if hu: key = np.c_[key, np.round(fuv * 1e4).astype(np.int64)]
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        P0, U0, T0 = flat[first], fuv[first], inv.reshape(-1, 3)
        _, _, coll = fs.simplify(P0.astype(np.float32), T0.astype(np.int32), target_reduction=red, return_collapses=True)
        P1, T1, mapping = fs.replay_simplification(P0.astype(np.float32), T0.astype(np.int32), coll)
        src = np.zeros(len(P1), dtype=np.int64); src[mapping] = np.arange(len(mapping))
        P1, T1, U1 = P1.astype(np.float64), T1.astype(np.int64), U0[src]
        fn = np.cross(P1[T1[:, 1]] - P1[T1[:, 0]], P1[T1[:, 2]] - P1[T1[:, 0]])
        vn = np.zeros_like(P1)
        for k in range(3): np.add.at(vn, T1[:, k], fn)
        fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        cn = vn[T1]                                          # (corner normals: the smooth one, or the face's on a crease)
        crease = (cn * fn[:, None, :]).sum(-1) < np.cos(np.radians(35))
        cn[crease] = np.repeat(fn[:, None, :], 3, 1)[crease]
        # back to an indexed mesh: corners shared where position, normal and uv agree
        cp, cuv = P1[T1].reshape(-1, 3), U1[T1].reshape(-1, 2)
        k2 = np.c_[np.round(cp * 1e4), np.round(cn.reshape(-1, 3) * 1e3), np.round(cuv * 1e4)].astype(np.int64)
        _, f2, i2 = np.unique(k2, axis=0, return_index=True, return_inverse=True)
        return cp[f2], cn.reshape(-1, 3)[f2], cuv[f2], i2.reshape(-1, 3)

    order = sorted(set(zip(roles.tolist(), mats.tolist())), key=lambda rm: (rm[0], rm[1]))
    for role, mi in order:
        sel = (roles == role) & (mats == mi)
        emit(f'{role}:{mi}', tris[sel], nors[sel], uvs[sel], mi, role.split('_')[0], bool(hasuv[sel].all()))
    if rim:
        for mi in sorted(set(rim['mats'].tolist())):
            sel = rim['mats'] == mi
            emit(f'rim:{mi}', rim['tris'][sel], rim['nors'][sel], rim['uvs'][sel], mi, 'rim', bool(rim['hasuv'][sel].all()))
    os.makedirs(out_dir, exist_ok=True)
    out.save(os.path.join(out_dir, f'{tid}.glb'))
    # (the browser keeps a .glb a day: the layout, never cached, names this one by its content)
    layout['glb'] = f'{tid}.glb?v={hashlib.sha1(open(os.path.join(out_dir, f"{tid}.glb"), "rb").read()).hexdigest()[:10]}'
    json.dump(layout, open(os.path.join(out_dir, f'{tid}.json'), 'w'), indent=1)
    size = os.path.getsize(os.path.join(out_dir, f'{tid}.glb'))
    layout['tris'] = int(sum(out.j['accessors'][pr['indices']]['count'] for m in out.j['meshes'] for pr in m['primitives']) // 3)
    print(f'{tid}: {layout["tris"]} triangles, {len(out.j["meshes"])} meshes, {len(out.j["images"])} textures, {size / 1e6:.2f} MB; scale {s:.4f}')
    print(' wheels', {k: (v['c'], v['r']) for k, v in layout['wheels'].items()})
    print(' track', layout['track'], 'bbox', layout['bbox'], 'half', layout['half'])
    print(' heads', layout['heads'], 'tails', layout['tails'], 'rim', layout['rim'])


if __name__ == '__main__':
    main(*sys.argv[1:4])
