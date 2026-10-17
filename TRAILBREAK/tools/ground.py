#!/usr/bin/env python3
"""Download the ground textures (CC0 photo scans from Poly Haven and ambientCG) and pack them for the game.

usage: python3 -I tools/ground.py <download dir> public/assets/ground [map ...]   (all maps without names)

For each source this writes two WebP files, named after it:
  <id>_c.webp  colour (albedo), 1024 x 1024
  <id>_d.webp  data: three 512 x 512 greyscale panels side by side: the normal's x, its y (OpenGL convention: +y
               is up the picture) and the height (stretched to the full 0..255 range)
and for each map a manifest <map>.json: its layers in order (the shader's layer numbers), with each one's files,
how many metres one copy of the texture covers, its roughness and its average colour (linear RGB, the colour the
terrain shows from far away), and a colour gain where the map wants its scan darker or lighter than photographed.
Greyscale panels keep the data out of WebP's half-resolution colour channels.
Needs numpy and Pillow.
"""
import io, json, os, sys, urllib.request, zipfile
import numpy as np
from PIL import Image

# name, source, id, metres per copy, roughness[, options: 'far' the colour from far away (linear RGB) when it isn't the
# texture's, 'gain' a colour gain (render/Ground.js has each ground's usual one)]
MAPS = {
    'ashwood': [
        ('grass', 'ambientcg', 'Grass004', 2.4, 0.95),
        ('forest', 'ambientcg', 'Ground076', 2.2, 0.92),
        ('dirt', 'polyhaven', 'rocky_trail', 2.0, 0.9),
        ('gravel', 'polyhaven', 'rock_ground', 1.5, 0.88),
        ('rock', 'ambientcg', 'Rock028', 5.0, 0.8),
        ('mud', 'polyhaven', 'brown_mud_03', 2.4, 0.5),
        ('sand', 'polyhaven', 'coast_sand_01', 4.0, 0.92),
        ('snow', 'polyhaven', 'snow_02', 2.5, 0.7),
        ('pebbles', 'polyhaven', 'ganges_river_pebbles', 2.16, 0.72),
    ],
    'kerala': [
        ('grass', 'ambientcg', 'Grass004', 2.4, 0.95),
        ('forest', 'polyhaven', 'brown_mud_leaves_01', 2.4, 0.9),
        ('dirt', 'polyhaven', 'red_laterite_soil_stones', 2.0, 0.88),
        ('gravel', 'polyhaven', 'river_small_rocks', 2.9, 0.85),
        ('rock', 'polyhaven', 'rock_surface', 4.0, 0.78),
        # (wet: darker than the dry scan)
        ('mud', 'polyhaven', 'red_dirt_mud_01', 1.5, 0.45, {'gain': [0.55, 0.5, 0.5]}),
        ('sand', 'polyhaven', 'coast_sand_01', 4.0, 0.92),
        ('pebbles', 'polyhaven', 'ganges_river_pebbles', 2.16, 0.72),
        ('road', 'polyhaven', 'road_damaged', 3.0, 0.8),
        # the soil between the tea rows; from far away, the bushes' green
        ('tea', 'polyhaven', 'brown_mud_leaves_01', 2.4, 0.9, {'far': [0.06, 0.15, 0.03]}),
    ],
    # the Konkan Coast: Kerala's grounds (red laterite, the same grass and sand), and clean tarmac on its roads
    'coast': [
        ('grass', 'ambientcg', 'Grass004', 2.4, 0.95),
        ('forest', 'polyhaven', 'brown_mud_leaves_01', 2.4, 0.9),
        ('dirt', 'polyhaven', 'red_laterite_soil_stones', 2.0, 0.88),
        ('gravel', 'polyhaven', 'river_small_rocks', 2.9, 0.85),
        ('rock', 'polyhaven', 'rock_surface', 4.0, 0.78),
        ('mud', 'polyhaven', 'red_dirt_mud_01', 1.5, 0.45, {'gain': [0.55, 0.5, 0.5]}),
        ('sand', 'polyhaven', 'coast_sand_01', 4.0, 0.92),
        ('pebbles', 'polyhaven', 'ganges_river_pebbles', 2.16, 0.72),
        ('road', 'polyhaven', 'clean_asphalt', 2.1, 0.86),
    ],
}
COLOR, DATA = 1024, 512


def fetch(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return dst
    req = urllib.request.Request(url, headers={'User-Agent': 'trailbreak-tools'})
    with urllib.request.urlopen(req, timeout=180) as r, open(dst + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(dst + '.part', dst)
    return dst


def download(dl, source, sid):
    """Paths of the colour, OpenGL normal and height maps of one source."""
    d = os.path.join(dl, sid)
    os.makedirs(d, exist_ok=True)
    if source == 'polyhaven':
        with urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/files/{sid}', headers={'User-Agent': 'trailbreak-tools'}), timeout=60) as r:
            files = json.load(r)
        out = []
        for key, name in (('Diffuse', 'color'), ('nor_gl', 'normal'), ('Displacement', 'height')):
            url = files[key]['2k']['jpg']['url'] if 'jpg' in files[key]['2k'] else files[key]['2k']['png']['url']
            out.append(fetch(url, os.path.join(d, name + os.path.splitext(url)[1])))
        return out
    if source == 'ambientcg':
        z = fetch(f'https://ambientcg.com/get?file={sid}_1K-JPG.zip', os.path.join(d, 'src.zip'))
        with zipfile.ZipFile(z) as zf:
            names = zf.namelist()
            out = []
            for suffix in ('_Color.jpg', '_NormalGL.jpg', '_Displacement.jpg'):
                n = next(x for x in names if x.endswith(suffix))
                p = os.path.join(d, os.path.basename(n))
                with zf.open(n) as src, open(p, 'wb') as f:
                    f.write(src.read())
                out.append(p)
            return out
    raise ValueError(source)


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def pack(paths, out_dir, sid):
    color, normal, height = paths
    im = Image.open(color).convert('RGB').resize((COLOR, COLOR), Image.LANCZOS)
    im.save(os.path.join(out_dir, f'{sid.lower()}_c.webp'), 'WEBP', quality=84, method=6)
    avg = to_linear(np.asarray(im, np.float64)).reshape(-1, 3).mean(0)
    n = np.asarray(Image.open(normal).convert('RGB').resize((DATA, DATA), Image.LANCZOS), np.float64)
    h = np.asarray(Image.open(height).convert('F').resize((DATA, DATA), Image.LANCZOS), np.float64)
    lo, hi = np.percentile(h, 1), np.percentile(h, 99)
    h = np.clip((h - lo) / max(1e-6, hi - lo), 0, 1) * 255
    strip = np.concatenate([n[..., 0], n[..., 1], h], axis=1)
    Image.fromarray(np.clip(np.round(strip), 0, 255).astype(np.uint8), 'L').save(os.path.join(out_dir, f'{sid.lower()}_d.webp'), 'WEBP', quality=90, method=6)
    return [round(float(v), 5) for v in avg]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    dl, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dl, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    for name, layers in MAPS.items():
        if sys.argv[3:] and name not in sys.argv[3:]:
            continue
        manifest = {'layers': []}
        for layer, source, sid, size, rough, *opts in layers:
            opts = opts[0] if opts else {}
            print(name, layer, source, sid, flush=True)
            avg = pack(download(dl, source, sid), out_dir, sid)
            entry = {'name': layer, 'color': f'{sid.lower()}_c.webp', 'data': f'{sid.lower()}_d.webp',
                     'size': size, 'rough': rough, 'avg': opts.get('far', avg), 'source': f'{source}:{sid}'}
            if 'gain' in opts:
                entry['gain'] = opts['gain']
            manifest['layers'].append(entry)
        with open(os.path.join(out_dir, f'{name}.json'), 'w') as f:
            json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
