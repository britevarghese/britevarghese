# Read a game GLB (quantized or not) into per-mesh triangles in the design frame:
#   from glbread import load; meshes = load(path) -> [(name, material name, tris (n,3,3) float)]
import json, struct, numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def quat_mat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20+n])
    off = 20 + n; bn = struct.unpack('<I', b[off:off+4])[0]; bin_ = b[off+8:off+8+bn]
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        dt = CT[a['componentType']]; k = NC[a['type']]
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0); stride = v.get('byteStride', 0)
        isz = np.dtype(dt).itemsize
        if stride and stride != k * isz:
            raw = np.frombuffer(bin_, np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)[:, :k * isz]
            arr = np.frombuffer(raw.tobytes(), dt).reshape(a['count'], k)
        else:
            arr = np.frombuffer(bin_, dt, count=a['count'] * k, offset=start).reshape(a['count'], k)
        arr = arr.astype(np.float64)
        if a.get('normalized'):
            arr = arr / {np.int8: 127, np.uint8: 255, np.int16: 32767, np.uint16: 65535}[dt]
        return arr
    out = []
    def walk(ni, M):
        node = j['nodes'][ni]
        T = np.eye(4)
        if 'matrix' in node: T = np.array(node['matrix']).reshape(4, 4).T
        else:
            S = np.diag(node.get('scale', [1, 1, 1]) + [1]); R = np.eye(4); R[:3, :3] = quat_mat(node.get('rotation', [0, 0, 0, 1]))
            Tt = np.eye(4); Tt[:3, 3] = node.get('translation', [0, 0, 0]); T = Tt @ R @ S
        W = M @ T
        if 'mesh' in node:
            for p in j['meshes'][node['mesh']]['primitives']:
                P = acc(p['attributes']['POSITION']); P = P @ W[:3, :3].T + W[:3, 3]
                idx = acc(p['indices']).astype(np.int64).reshape(-1, 3) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
                mat = j['materials'][p['material']].get('name', '') if 'material' in p else ''
                out.append((j['meshes'][node['mesh']].get('name', ''), mat, P[idx]))
        for c in node.get('children', []): walk(c, W)
    for r in j['scenes'][j.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    return out
