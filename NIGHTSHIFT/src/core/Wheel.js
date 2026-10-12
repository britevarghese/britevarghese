// Steering wheels (Logitech G29 / G920 / G923, Thrustmaster, Fanatec, Moza...) as the browser sees them: the wheel
// turns axis 0 almost everywhere, but each model reports its pedals on axes of its own, resting at one end of their
// range rather than at 0 (and some read 0 until first pressed), with no standard button layout. So the pedals are
// learnt once per wheel (ui/WheelSetup.js) and kept in the settings (gameplay.wheelProfiles).

const WHEEL_RX = /wheel|racing|driving force|\bG2[5-9]\b|\bG9[0-9]{2}\b|DFGT|momo|thrustmaster|\bT1[5-9]0\b|\bT2[0-9]{2}\b|\bT3[0-9]{2}\b|\bTMX\b|\bTX\b|T-GT|T818|fanatec|\bCSL\b|clubsport|podium|moza|simucube|simagic|accuforce|\bPXN\b|cammus|speedlink|hori.*(racing|apex)/i;
// (Logitech's vendor id with a wheel's product id, where the name is only "Vendor: 046d Product: c24f")
const WHEEL_IDS = /046d.{0,12}(c24f|c260|c261|c262|c266|c267|c268|c26d|c26e|c24b|c29b|c299|c298|c294|c29a|c29c)|044f.{0,12}b6[5-9][0-9a-f]/i;   // (and Thrustmaster's)

/** Is this gamepad a steering wheel? mode: 'auto' (by its name), 'wheel' or 'gamepad' (the player's choice). */
export function isWheel(pad, mode = 'auto') {
  if (!pad || mode === 'gamepad') return false;
  return mode === 'wheel' || WHEEL_RX.test(pad.id) || WHEEL_IDS.test(pad.id);
}

/** Xbox-layout wheels (G920, G923 for Xbox, Thrustmaster TX/TMX): Menu and View where a PlayStation wheel has R2 / L2. */
export const xboxLayout = (pad) => /xbox|G920|\bTX\b|TMX|c262|c26e/i.test(pad?.id || '');

/** A learnt pedal { a: axis, rest, full } -> 0..1 (a little dead travel at the top, as in the car). */
export function pedal(pad, p) {
  if (!p || !pad?.axes || p.a >= pad.axes.length || p.full === p.rest) return 0;
  const x = (pad.axes[p.a] - p.rest) / (p.full - p.rest);
  return Math.min(1, Math.max(0, (x - 0.04) / 0.94));
}

/** The steering: linear (a wheel turns as far as the player turns it), a sliver of dead zone at the centre. */
export function wheelSteer(pad, sens = 1) {
  const v = pad?.axes?.[0] || 0;
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

/** The learnt pedals for this wheel, if any. */
export const profileFor = (settings, pad) => (settings.gameplay.wheelProfiles || []).find((p) => p.id === pad?.id) || null;

export function saveProfile(settings, prof) {
  const list = (settings.gameplay.wheelProfiles || []).filter((p) => p.id !== prof.id);
  settings.set('gameplay', 'wheelProfiles', [...list, prof]);
}
