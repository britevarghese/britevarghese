#!/usr/bin/env python3
"""Convert the Sketchfab tree downloads (glTF) into the game's compact tree files.

usage: python3 tools/trees.py <download dir> public/assets/trees [name[=folder] ...]

<download dir> holds one folder per tree, each the unzipped glTF download of the model listed in
public/assets/trees/CREDITS.md (the folder is the tree's name unless given: mango=oak converts the oak download as the
game's mango tree). Without names: Ashwood's pine, fir, spruce and birch. For each tree this writes <name>.json (layout), <name>.bin (geometry,
normalised to 1 m tall with the trunk at the origin) and its textures as WebP: colour (with alpha for foliage) and
normal maps. A tree in THIN keeps only that share of its leaf cards, each grown to cover what its neighbours did (a
lighter model with as full a crown). Needs numpy and Pillow.
"""
import json, os, struct, sys
import numpy as np
from PIL import Image

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# the share of leaf cards kept (the rainforest giant comes with tens of thousands)
THIN = {'jungle': 0.4}


def thin(pos, nor, uv, idx, keep, seed):
    """Keep a share of the cards (the pieces of connected triangles) of a leaf group, each scaled up about its middle."""
    tri = idx.reshape(-1, 3)
    parent = np.arange(len(pos))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b, c in tri:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra; parent[find(rc)] = ra
    card = np.array([find(v) for v in range(len(pos))])
    ids = np.unique(card[tri[:, 0]])
    kept = set(ids[np.random.default_rng(seed).random(len(ids)) < keep].tolist())
    keep_tri = np.array([card[t[0]] in kept for t in tri])
    tri = tri[keep_tri]
    used = np.unique(tri)
    remap = -np.ones(len(pos), dtype=np.int64); remap[used] = np.arange(len(used))
    grow = min(1.5, 1 / np.sqrt(keep))
    pos = pos.copy()
    for cid in kept:
        vs = np.where(card == cid)[0]
        mid = pos[vs].mean(axis=0)
        pos[vs] = mid + (pos[vs] - mid) * grow
    return pos[used], nor[used], uv[used], remap[tri].reshape(-1).astype(np.uint32)


def accessor(g, binary, i):
    a = g['accessors'][i]
    v = g['bufferViews'][a['bufferView']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    dt, n = COMP[a['componentType']], NCOMP[a['type']]
    stride = v.get('byteStride', 0)
    item = np.dtype(dt).itemsize * n
    if stride and stride != item:
        raw = np.frombuffer(binary, np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :item]
        return np.frombuffer(raw.tobytes(), dt).reshape(a['count'], n)
    return np.frombuffer(binary, dt, count=a['count'] * n, offset=off).reshape(a['count'], n) if n > 1 else np.frombuffer(binary, dt, count=a['count'], offset=off)


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


def save_tex(src, dst, size, alpha):
    im = Image.open(src)
    im = im.convert('RGBA' if alpha else 'RGB')
    if max(im.size) > size:
        k = size / max(im.size)
        im = im.resize((max(4, round(im.size[0] * k)), max(4, round(im.size[1] * k))), Image.LANCZOS)
    if alpha:
        # bleed the colour of the foliage into the transparent texels so the mip levels don't go dark at the edges
        a = np.asarray(im).astype(np.float32)
        rgb, al = a[..., :3], a[..., 3:] / 255.0
        filled = rgb.copy()
        mask = al[..., 0] > 0.2
        for _ in range(24):
            if mask.all(): break
            acc = np.zeros_like(filled); cnt = np.zeros(mask.shape)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                sm = np.roll(mask, (dy, dx), (0, 1)); sf = np.roll(filled, (dy, dx), (0, 1))
                acc[sm] += sf[sm]; cnt[sm] += 1
            grow = (~mask) & (cnt > 0)
            filled[grow] = acc[grow] / cnt[grow][:, None]
            mask = mask | grow
        a[..., :3] = filled
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    im.save(dst, 'WEBP', quality=86 if alpha else 82, method=6)
    return im.size


def convert(src_dir, name, out_dir):
    g = json.load(open(os.path.join(src_dir, 'scene.gltf')))
    binary = open(os.path.join(src_dir, g['buffers'][0]['uri']), 'rb').read()
    groups = {}                                     # material index -> lists
    def visit(ni, parent):
        n = g['nodes'][ni]
        m = parent @ node_matrix(n)
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                pos = accessor(g, binary, p['attributes']['POSITION']).astype(np.float64)
                nor = accessor(g, binary, p['attributes']['NORMAL']).astype(np.float64)
                uv = accessor(g, binary, p['attributes']['TEXCOORD_0']).astype(np.float32)
                idx = accessor(g, binary, p['indices']).astype(np.uint32)
                pw = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                nm = np.linalg.inv(m[:3, :3]).T
                nw = nor @ nm.T
                nw /= np.linalg.norm(nw, axis=1, keepdims=True) + 1e-12
                gr = groups.setdefault(p.get('material', 0), {'pos': [], 'nor': [], 'uv': [], 'idx': [], 'base': 0})
                gr['idx'].append(idx + gr['base']); gr['base'] += len(pw)
                gr['pos'].append(pw); gr['nor'].append(nw); gr['uv'].append(uv)
        for c in n.get('children', []): visit(c, m)
    for root in g['scenes'][g.get('scene', 0)]['nodes']: visit(root, np.eye(4))

    allpos = np.concatenate([np.concatenate(gr['pos']) for gr in groups.values()])
    height = allpos[:, 1].max() - allpos[:, 1].min()
    y0 = allpos[:, 1].min()
    # the trunk's base: the lowest bark vertices
    bark_mats = [mi for mi in groups if g['materials'][mi].get('alphaMode') != 'MASK']
    bp = np.concatenate([np.concatenate(groups[mi]['pos']) for mi in bark_mats]) if bark_mats else allpos
    low = bp[bp[:, 1] < bp[:, 1].min() + height * 0.02]
    cx, cz = low[:, 0].mean(), low[:, 2].mean()

    out = bytearray(); layout = []
    def align():
        while len(out) % 4: out.append(0)
    for mi, gr in sorted(groups.items()):
        mat = g['materials'][mi]
        leaf = mat.get('alphaMode') == 'MASK'
        pos = np.concatenate(gr['pos']); nor = np.concatenate(gr['nor']); uv = np.concatenate(gr['uv']); idx = np.concatenate(gr['idx'])
        pos = (pos - [cx, y0, cz]) / height
        if leaf and name in THIN:
            pos, nor, uv, idx = thin(pos, nor, uv, idx, THIN[name], len(layout))
        assert len(pos) < 65536
        ent = {'kind': 'leaf' if leaf else 'bark', 'vertices': len(pos), 'indices': len(idx)}
        align(); ent['position'] = len(out); out += pos.astype(np.float32).tobytes()
        align(); ent['normal'] = len(out); out += np.round(nor * 127).clip(-127, 127).astype(np.int8).tobytes()
        align(); ent['uv'] = len(out); out += uv.astype(np.float32).tobytes()
        align(); ent['index'] = len(out); out += idx.astype(np.uint16).tobytes()
        # textures
        pbr = mat.get('pbrMetallicRoughness', {})
        tex = lambda t: os.path.join(src_dir, g['images'][g['textures'][t['index']]['source']]['uri'])
        base = f'{name}_{len(layout)}'
        if 'baseColorTexture' in pbr:
            ent['map'] = base + '_color.webp'
            ent['mapSize'] = save_tex(tex(pbr['baseColorTexture']), os.path.join(out_dir, ent['map']), 1024 if leaf else 512, leaf)
        if 'normalTexture' in mat:
            ent['normalMap'] = base + '_normal.webp'
            save_tex(tex(mat['normalTexture']), os.path.join(out_dir, ent['normalMap']), 512, False)
        if leaf: ent['alphaCutoff'] = round(mat.get('alphaCutoff', 0.5), 3)
        layout.append(ent)
    open(os.path.join(out_dir, name + '.bin'), 'wb').write(bytes(out))
    info = {'name': name, 'height': round(float(height), 2), 'radius': round(float(np.abs(allpos[:, [0, 2]] - [cx, cz]).max() / height), 3), 'groups': layout}
    json.dump(info, open(os.path.join(out_dir, name + '.json'), 'w'), indent=1)
    print(name, 'height', info['height'], 'm', [(e['kind'], e['vertices'], e['indices'] // 3) for e in layout], len(out) // 1024, 'KB')


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for arg in sys.argv[3:] or ('pine', 'fir', 'spruce', 'birch'):
        name, _, folder = arg.partition('=')
        d = os.path.join(src, folder or name)
        if not os.path.exists(os.path.join(d, 'scene.gltf')) and os.path.exists(os.path.join(d, 'x', 'scene.gltf')):
            d = os.path.join(d, 'x')
        convert(d, name, dst)
