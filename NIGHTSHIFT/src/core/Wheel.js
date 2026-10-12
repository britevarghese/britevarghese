// Steering wheels as the browser sees them. Each make reports itself its own way: a Logitech by name with the wheel on
// axis 0 and each pedal on an axis of its own resting at one end of its travel (some read 0 until first pressed); a
// budget wheel (Nitho, PXN, Hori...) in D-Input mode as a generic controller with the pedals on any axes, or one
// combined axis (accelerator one way, brake the other); in X-Input mode as an Xbox pad with the pedals on its triggers
// or a stick. So the wheel and pedals are learnt once per controller (ui/WheelSetup.js): whichever inputs move, axes or
// analogue buttons, kept in the settings (gameplay.wheelProfiles).

const WHEEL_RX = /wheel|racing|driving force|\bG2[5-9]\b|\bG9[0-9]{2}\b|DFGT|momo|thrustmaster|\bT1[5-9]0\b|\bT2[0-9]{2}\b|\bT3[0-9]{2}\b|\bTMX\b|\bTX\b|T-GT|T818|fanatec|\bCSL\b|clubsport|podium|moza|simucube|simagic|accuforce|\bPXN\b|cammus|speedlink|hori.*(racing|apex)|nitho|drive ?pro|steering|pedal/i;
// (Logitech's and Thrustmaster's vendor ids with a wheel's product id, where the name is only "Vendor: 046d Product: c24f")
const WHEEL_IDS = /046d.{0,12}(c24f|c260|c261|c262|c266|c267|c268|c26d|c26e|c24b|c29b|c299|c298|c294|c29a|c29c)|044f.{0,12}b6[5-9][0-9a-f]/i;
// gamepads (a controller that isn't one of these and isn't laid out as a standard pad is likely a wheel in D-Input mode;
// not 'USB Gamepad', the name some budget wheels give)
const PAD_RX = /xbox|x-box|xinput|playstation|dualshock|dualsense|wireless controller|054c|045e|pro controller|joy-con|nintendo|8bitdo|stadia|dual action|f310|f510|f710/i;

/** The connected controllers (an empty list where the browser keeps them from the page: it may even throw there). */
export function gamepads() {
  try { return [...(navigator.getGamepads?.() || [])]; } catch { return []; }
}

/** The learnt wheel and pedals for this controller, if any. */
export const profileFor = (settings, pad) => (settings.gameplay.wheelProfiles || []).find((p) => p.id === pad?.id) || null;

export function saveProfile(settings, prof) {
  const list = (settings.gameplay.wheelProfiles || []).filter((p) => p.id !== prof.id);
  settings.set('gameplay', 'wheelProfiles', [...list, prof]);
}

/**
 * Is this controller a steering wheel? mode: 'auto' (by its name, a learnt profile, or a controller not laid out as a
 * standard pad that isn't a known pad), 'wheel' or 'gamepad' (the player's choice in Settings > Controls).
 */
export function isWheel(pad, mode = 'auto', settings = null) {
  if (!pad || mode === 'gamepad') return false;
  if (mode === 'wheel' || WHEEL_RX.test(pad.id) || WHEEL_IDS.test(pad.id) || (settings && profileFor(settings, pad))) return true;
  return pad.mapping !== 'standard' && !PAD_RX.test(pad.id);
}

/** Xbox-layout wheels (G920, G923 for Xbox, Thrustmaster TX/TMX): Menu and View where a PlayStation wheel has R2 / L2. */
export const xboxLayout = (pad) => /xbox|G920|\bTX\b|TMX|c262|c26e/i.test(pad?.id || '');

/** All of a controller's inputs in one list: its axes, then its buttons' analogue values (pedals can be either). */
export const inputs = (pad) => [...pad.axes, ...pad.buttons.map((b) => b?.value ?? (b?.pressed ? 1 : 0))];

/** A learnt input { i (index in inputs()), rest, full } -> 0..1 */
export function travel(pad, p) {
  if (!p || !pad) return 0;
  const n = pad.axes.length, v = p.i < n ? pad.axes[p.i] : pad.buttons[p.i - n]?.value;
  if (v === undefined || p.full === p.rest) return 0;
  return Math.min(1, Math.max(0, (v - p.rest) / (p.full - p.rest)));
}

/** A pedal, 0..1, with a little dead travel at the top as in the car. */
export const pedal = (pad, p) => Math.max(0, (travel(pad, p) - 0.04) / 0.96);

/**
 * A pedal seen let up further than the rest the setup learnt (let up slowly then, or read 0 until first pressed):
 * that is its rest. Not for both pedals on one axis (each one's rest is the middle, the other pedal goes past it).
 * Returns true when the profile changed.
 */
export function settlePedals(pad, prof) {
  if (!prof?.throttle || !prof.brake || prof.throttle.i === prof.brake.i) return false;
  let changed = false;
  for (const q of [prof.throttle, prof.brake]) {
    const n = pad.axes.length, v = q.i < n ? pad.axes[q.i] : pad.buttons[q.i - n]?.value;
    if (v === undefined || Math.abs(v) > 1.001) continue;
    if ((v - q.rest) * Math.sign(q.full - q.rest) < -0.03) { q.rest = +v.toFixed(3); changed = true; }
  }
  return changed;
}

/**
 * The steering, -1 (full left) .. 1: from the learnt wheel axis { i, rest (centre), full (full left) }, else axis 0.
 * Linear (as far as the player turns it), a sliver of dead zone at the centre.
 */
export function wheelSteer(pad, sens = 1, st = null) {
  let v;
  if (st && st.i < pad.axes.length && st.full !== st.rest) v = -(pad.axes[st.i] - st.rest) / (st.full - st.rest);
  else v = pad?.axes?.[0] || 0;
  const s = Math.abs(v) < 0.012 ? 0 : (v - Math.sign(v) * 0.012) / 0.988;
  return Math.max(-1, Math.min(1, s * sens));
}

const hatAxis = new Map();
/** The hat switch: Chrome reports a non-standard pad's d-pad as one axis (neutral ~1.29). -> { up, down, left, right } */
export function hat(pad) {
  const out = { up: false, down: false, left: false, right: false };
  if (!pad?.axes) return out;
  // (the hat's axis is the one that sits outside -1..1 at rest)
  let i = hatAxis.get(pad.id);
  if (i === undefined) { i = pad.axes.findIndex((v) => Math.abs(v) > 1.05); if (i < 0) return out; hatAxis.set(pad.id, i); }
  const v = pad.axes[i];
  if (v === undefined || v > 1.1) return out;
  const d = Math.round((v + 1) * 3.5);   // 0 up, 1 up-right, 2 right, ... 7 up-left
  out.up = d === 7 || d === 0 || d === 1; out.right = d >= 1 && d <= 3; out.down = d >= 3 && d <= 5; out.left = d >= 5 && d <= 7;
  return out;
}
