// Skeleton discovery: maps arbitrary rig naming conventions (Mixamo, UE mannequin, Blender .L/.R, Unity humanoid,
// CC/Daz ...) to canonical bone slots using the ACTUAL bone names + hierarchy. Overrides come from the manifest.

const SIDE_L = /(^|[^a-z])(left|l)([^a-z]|$)|left|_l$|\.l$|^l_|lft/i;
const SIDE_R = /(^|[^a-z])(right|r)([^a-z]|$)|right|_r$|\.r$|^r_|rgt/i;

function clean(name) { return name.replace(/^mixamorig\d*[:_]?/i, '').replace(/^(bip0?1|def|ORG|DEF)[_\-\s.]?/i, ''); }
function side(name) {
  const n = clean(name);
  if (/left/i.test(n) || /(^|[_.\s])l($|[_.\s])/i.test(n) || /_l$|\.l$|^l_/i.test(n)) return 'L';
  if (/right/i.test(n) || /(^|[_.\s])r($|[_.\s])/i.test(n) || /_r$|\.r$|^r_/i.test(n)) return 'R';
  return null;
}

const PATTERNS = {
  hips: /^(hips?|pelvis|root_?hips|hip)$/i,
  head: /^head$/i,
  neck: /^neck(_?0?1)?$/i,
  hand: /^(hand|wrist)$|hand$|^hand/i,
  forearm: /fore_?arm|lower_?arm|lowerarm|elbow|arm_?lower/i,
  upperarm: /^(arm|upper_?arm|upperarm|up_?arm)$|upper_?arm|^arm$|shoulder_?2|arm_?upper/i,
  shoulder: /shoulder|clavicle|collar/i,
  thigh: /up_?leg|upper_?leg|thigh|upleg/i,
  calf: /^(leg|lower_?leg|calf|shin|knee)$|lower_?leg|calf|shin/i,
  foot: /foot|ankle/i,
  toe: /toe|ball/i,
};
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export function mapBones(root, overrides = {}) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const byName = new Map(bones.map((b) => [b.name, b]));
  const m = {};
  const find = (slot, sd) => bones.find((b) => {
    const n = clean(b.name).replace(/[_.\s-]?(left|right|l|r)$/i, '').replace(/^(left|right|l|r)[_.\s-]?/i, '');
    return PATTERNS[slot].test(n) && (!sd || side(b.name) === sd) && !/twist|roll|end|nub|tip|ik|pole|target|index|middle|ring|pinky|thumb|finger/i.test(clean(b.name));
  });
  m.hips = find('hips') || bones.find((b) => /hip|pelvis/i.test(b.name)) || bones[0];
  m.head = find('head') || bones.find((b) => /head/i.test(b.name) && !/end|top/i.test(b.name));
  m.neck = find('neck') || (m.head && m.head.parent?.isBone ? m.head.parent : null);
  for (const [sd, s] of [['L', 'left'], ['R', 'right']]) {
    m[`${s}Hand`] = find('hand', sd);
    m[`${s}ForeArm`] = find('forearm', sd) || m[`${s}Hand`]?.parent;
    m[`${s}Arm`] = (m[`${s}ForeArm`] && m[`${s}ForeArm`].parent?.isBone ? m[`${s}ForeArm`].parent : null) || find('upperarm', sd);
    m[`${s}Shoulder`] = m[`${s}Arm`]?.parent?.isBone && PATTERNS.shoulder.test(clean(m[`${s}Arm`].parent.name)) ? m[`${s}Arm`].parent : find('shoulder', sd);
    m[`${s}Foot`] = find('foot', sd);
    m[`${s}Leg`] = m[`${s}Foot`]?.parent || find('calf', sd);
    m[`${s}UpLeg`] = m[`${s}Leg`]?.parent || find('thigh', sd);
    m[`${s}Toe`] = find('toe', sd);
    // fingers: chains under the hand
    const hand = m[`${s}Hand`];
    if (hand) {
      for (const f of FINGERS) {
        const re = f === 'pinky' ? /pinky|little|pinkie/i : new RegExp(f, 'i');
        const first = hand.children.find((c) => c.isBone && re.test(c.name)) || bones.find((b) => b.parent === hand && re.test(b.name));
        const chain = [];
        for (let b = first; b && b.isBone && chain.length < 3; b = b.children.find((c) => c.isBone)) chain.push(b);
        m[`${s}_${f}`] = chain;
      }
    }
  }
  // spine chain between hips and neck
  const spine = [];
  if (m.neck) for (let b = m.neck.parent; b && b !== m.hips && b.isBone; b = b.parent) spine.unshift(b);
  m.spine = spine;
  m.chest = spine[spine.length - 1] || m.hips;
  for (const [k, v] of Object.entries(overrides || {})) if (byName.has(v)) m[k] = byName.get(v);
  const missing = ['hips', 'head', 'neck', 'leftHand', 'rightHand', 'leftForeArm', 'rightForeArm', 'leftArm', 'rightArm', 'leftFoot', 'rightFoot', 'leftLeg', 'rightLeg', 'leftUpLeg', 'rightUpLeg'].filter((k) => !m[k]);
  if (missing.length) console.error(`[rig] bone mapping incomplete, missing: ${missing.join(', ')} — add "bones" overrides in asset-manifest.json. Bones: ${bones.map((b) => b.name).join(' ')}`);
  m.missing = missing;
  m.all = bones;
  return m;
}

export function mapClips(clips) {
  const want = {
    idle: /idle|stand(?!.*walk)|breath/i, walk: /walk(?!.*crouch)/i, run: /run|jog/i, sprint: /sprint/i,
    crouch: /crouch(?!.*walk)|squat/i, crouchWalk: /crouch.*walk|sneak/i, prone: /prone(?!.*crawl)/i, crawl: /crawl/i,
    jump: /jump/i, fall: /fall/i, land: /land/i, aim: /aim/i, fire: /fire|shoot/i, reload: /reload/i, grenade: /grenade|throw/i,
    hit: /hit|react/i, death: /death|die|dying/i,
  };
  const out = {};
  for (const [k, re] of Object.entries(want)) out[k] = clips.find((c) => re.test(c.name) && !/tpose|t-pose/i.test(c.name)) || null;
  return out;
}
