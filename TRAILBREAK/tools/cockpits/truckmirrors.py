# Each off-road truck's mirrors, as layout.interior (no cockpit built: the model's own is kept): the glass of its left
# door mirror (the right is its mirror image), and its rear-view mirror's. Measured off each model: the glass is the
# face its mirror's head turns back (the head found standing out of the side's profile ahead of the door window, its
# rearmost rear-facing sheet), a little inside that face; the rear-view mirror likewise, under the windscreen's top.
# A model without one gets one built (arm: where its housing is bolted to the body).
#   python3 -I truckmirrors.py <TRAILBREAK root>   (writes tools/cars/<id>.json's layout and public/assets/trucks/<id>.json)
import sys, json, re
ROOT = sys.argv[1]
G = lambda c, w, h, **k: {'c': c, 'w': w, 'h': h, **k}
MIRRORS = {
    # the Thar's model has none: on the doors' front corners, and under the windscreen's top
    'thar': ([G([0.93, 1.42, 0.34], 0.17, 0.13, arm=[0.79, 1.36, 0.36])], G([0, 1.68, 0.19], 0.24, 0.065, arm=[0, 1.76, 0.25])),
    'wrangler': ([G([0.86, 1.368, 0.108], 0.124, 0.144)], G([0, 1.62, 0.08], 0.22, 0.062, arm=[0, 1.7, 0.12])),
    'shepherd': ([G([0.983, 1.434, 0.352], 0.119, 0.165)], G([0.001, 1.739, 0.389], 0.246, 0.064)),
    'bronco': ([G([0.945, 1.431, 0.666], 0.18, 0.164)], G([-0.003, 1.767, 0.437], 0.29, 0.061)),
    # (the H1's: its built cockpit's, interiors.py)
    'hummerev': ([G([1.135, 1.471, 0.731], 0.116, 0.155)], G([0.002, 1.832, 0.739], 0.24, 0.088)),
    # the Willys: one round mirror, on a stalk on the driver's side; an open jeep, no rear-view mirror
    'mule': ([G([0.812, 1.083, 0.319], 0.095, 0.095, round=True, one=True)], None),
    'ranger': ([G([0.931, 1.445, 0.42], 0.134, 0.2)], G([0, 1.73, 0.25], 0.24, 0.065, arm=[0, 1.82, 0.3])),
    'bruiser': ([G([1.208, 1.522, 1.004], 0.172, 0.145)], G([0, 1.843, 0.983], 0.213, 0.06)),
    'hauler': ([G([1.044, 1.317, 0.68], 0.165, 0.11)], G([0, 1.585, 0.69], 0.25, 0.055)),
    'trekker': ([G([1.082, 1.33, 0.678], 0.145, 0.146)], G([0, 1.61, 0.47], 0.24, 0.065, arm=[0, 1.69, 0.53])),
    'gecko': ([G([0.911, 1.113, 0.317], 0.12, 0.18)], G([-0.001, 1.448, 0.182], 0.27, 0.094)),
    'drover': ([G([0.966, 1.425, 0.516], 0.178, 0.177)], G([0, 1.78, 0.35], 0.24, 0.065, arm=[0, 1.86, 0.41])),
    # the Unimog: a truck's pair on each side, the main mirror and a wide-angle one under it; no rear-view mirror
    'rhino': ([G([1.19, 2.06, 1.457], 0.14, 0.18), G([1.19, 1.78, 1.457], 0.14, 0.2)], None),
}
for id, (doors, rv) in MIRRORS.items():
    I = {'replace': False, 'mirrors': doors, **({'rearView': rv} if rv else {})}
    pub = f'{ROOT}/public/assets/trucks/{id}.json'; L = json.load(open(pub))
    L['interior'] = I
    json.dump(L, open(pub, 'w'), indent=1)
    cp = f'{ROOT}/tools/cars/{id}.json'; s = open(cp).read()
    s = re.sub(r'\n  "interior": \{.*\},\n', '\n', s)
    i = s.index('"layout": {') + len('"layout": {')
    s = s[:i] + '\n  "interior": ' + json.dumps(I, separators=(', ', ': ')) + ',' + s[i:]
    json.loads(s); open(cp, 'w').write(s)
    print(id, len(doors), 'door mirror(s)', 'and a rear-view' if rv else '')
