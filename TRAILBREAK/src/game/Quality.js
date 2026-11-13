// The graphics level a session starts at (the game then holds 60 frames a second: core/Game.js perf steps it down when
// the machine can't keep up, and back up when it runs smoothly again).
//
// Every session used to start at the player's chosen level, 'high' unless they picked another, and a machine that
// couldn't draw it spent the first half minute finding that out, stuttering through two steps down, just when the
// open world is loading as well: every time the game was started. Now a session starts where the last one settled on
// this machine (settings.autoStart), and the very first by the graphics card's name: one known to be slow starts lower
// and steps up if it runs smoothly, so the start is smooth either way. A player who picks a level themselves gets it,
// always.

export const LEVELS = ['low', 'medium', 'high'];

/**
 * The level to start at the first time, from the graphics card's name (WebGL's unmasked renderer) and whether it is a
 * phone or tablet: 'low' for a software renderer or an old integrated chip, 'medium' for integrated graphics, phones and
 * small laptop cards (and anything unknown: it steps up in a quarter of a minute if the machine has more), 'high' for a
 * card made for games.
 */
export function guessLevel(gpu = '', touch = false) {
  const g = String(gpu);
  if (/swiftshader|llvmpipe|software|basic render|softpipe/i.test(g)) return 'low';
  if (touch) return 'medium';
  if (/nvidia|geforce|quadro|rtx/i.test(g)) return /\bMX\s?\d|\bGT\s?\d{3}|\b[1-9]\d{2}M[X]?\b|quadro (k|p)?\d{3}\b/i.test(g) ? 'medium' : 'high';
  if (/\barc\b/i.test(g)) return 'high';
  if (/intel/i.test(g)) return /iris|uhd|xe\b/i.test(g) ? 'medium' : 'low';
  if (/apple m\d|apple gpu/i.test(g)) return 'high';
  if (/radeon|amd|ati /i.test(g)) return /\bRX\s?\d|radeon pro|firepro|\bW\d{4}/i.test(g) ? 'high' : 'medium';
  return 'medium';
}

/**
 * Where this session starts: null for the chosen level itself (the player picked one, or the machine holds it), else the
 * lower level to start at. settings: { quality, autoQuality, autoStart ('' once it held the chosen level) }.
 */
export function startLevel(settings, gpu = '', touch = false) {
  if (settings.autoQuality === false) return null;
  const chosen = LEVELS.indexOf(settings.quality || 'high');
  const at = settings.autoStart === undefined ? guessLevel(gpu, touch) : settings.autoStart;
  const i = LEVELS.indexOf(at);
  return i >= 0 && i < chosen ? LEVELS[i] : null;
}

/** Sessions after a step up that didn't hold before the game tries one again (a machine that can't isn't made to stutter for it every time). */
export const HOLD_SESSIONS = 4;

/**
 * The game's level changed by itself (level; stuck: it stepped up and couldn't hold it): what to keep for the next
 * session, into settings.
 */
export function rememberLevel(settings, level, stuck = false) {
  settings.autoStart = level === (settings.quality || 'high') ? '' : level;
  if (stuck) settings.autoHold = HOLD_SESSIONS;
}
