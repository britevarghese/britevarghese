// NIGHTSHIFT radio: stations and songs, all original compositions played by MusicSynth.
// A song is data: tempo, steps per bar, an 8-bar chord loop, a melody, drum/bass patterns and which
// instruments play them. Station and song names are fictional.
//
// bars:  [{ root: bass midi note, pad: [chord voicing] }]  (one per bar)
// lead:  per bar, [[step, midi, lengthInSteps], ...]       (null = no melody)
// drums: per kit voice, the steps it hits (arrays of step numbers), or a function (step, bar, loop) => amount
// bass:  per step, semitones above the bar's root (null = rest)

const R = (...steps) => steps;

// ------------------------------------------------------------------ NIGHTSHIFT 99.1: synthwave
const NIGHT_SHIFT = {
  title: 'Night Shift', bpm: 100, steps: 16, kit: 'synth', pad: 'saw', lead: 'square', bassType: 'saw', arp: true, leadEvery: 2,
  bars: [
    { root: 33, pad: [57, 60, 64] }, { root: 29, pad: [57, 60, 65] }, { root: 36, pad: [55, 60, 64] }, { root: 31, pad: [55, 59, 62] },
    { root: 33, pad: [57, 60, 64] }, { root: 29, pad: [57, 60, 65] }, { root: 38, pad: [57, 62, 65] }, { root: 28, pad: [56, 59, 64] },
  ],
  leadNotes: [
    [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
    [[0, 72, 6], [6, 69, 2], [8, 65, 4], [12, 67, 2], [14, 69, 2]],
    [[0, 67, 4], [4, 72, 4], [8, 76, 6], [14, 74, 2]],
    [[0, 74, 8], [8, 71, 4], [12, 67, 4]],
    [[0, 69, 2], [2, 72, 2], [4, 76, 4], [8, 81, 6], [14, 79, 2]],
    [[0, 77, 6], [6, 76, 2], [8, 72, 8]],
    [[0, 74, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4]],
    [[0, 71, 6], [6, 68, 2], [8, 64, 8]],
  ],
  drumsCalm: { kick: R(0, 6, 8), snare: R(4, 12), hat: 'eighths' },
  drumsDrive: { kick: R(0, 4, 8, 12), snare: R(4, 12), hat: 'sixteenths' },
  bassCalm: [0, null, 0, null, 12, null, 0, null, 0, null, 7, null, 12, null, 0, 7],
  bassDrive: [0, 0, 12, 0, 0, 0, 12, 0, 7, 7, 12, 7, 0, 0, 12, 12],
  loops: 4,
};

const NEON_COAST = {
  title: 'Neon Coast', bpm: 108, steps: 16, kit: 'synth', pad: 'saw', lead: 'square', bassType: 'saw', arp: true, leadEvery: 2,
  bars: [
    { root: 28, pad: [55, 59, 64] }, { root: 36, pad: [55, 60, 64] }, { root: 31, pad: [55, 59, 62] }, { root: 38, pad: [57, 62, 66] },
    { root: 28, pad: [55, 59, 64] }, { root: 36, pad: [55, 60, 64] }, { root: 33, pad: [57, 60, 64] }, { root: 35, pad: [54, 59, 63] },
  ],
  leadNotes: [
    [[0, 71, 4], [4, 74, 2], [6, 76, 6], [12, 74, 4]],
    [[0, 72, 6], [6, 71, 2], [8, 67, 8]],
    [[0, 67, 2], [2, 71, 2], [4, 74, 4], [8, 79, 4], [12, 78, 4]],
    [[0, 78, 8], [8, 74, 4], [12, 69, 4]],
    [[0, 76, 4], [4, 79, 4], [8, 83, 6], [14, 81, 2]],
    [[0, 79, 4], [4, 76, 4], [8, 72, 8]],
    [[0, 72, 4], [4, 76, 4], [8, 81, 4], [12, 79, 4]],
    [[0, 78, 6], [6, 75, 2], [8, 71, 8]],
  ],
  drumsCalm: { kick: R(0, 8, 10), snare: R(4, 12), hat: 'eighths' },
  drumsDrive: { kick: R(0, 4, 8, 12), snare: R(4, 12, 15), hat: 'sixteenths' },
  bassCalm: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, 7, 12, null],
  bassDrive: [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 12, 7, 12],
  loops: 4,
};

// ------------------------------------------------------------------ Kayal FM 92.7: Kerala folk fusion
// a tanpura drone on D, tabla-style drums, a plucked lead in a pentatonic (Mohanam-like) scale
const D = 50; // D3
const pent = (deg) => [0, 2, 4, 7, 9][((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5); // degree -> semitones
const P = (deg, oct = 1) => D + 12 * oct + pent(deg);
const BACKWATER = {
  title: 'Backwater Run', bpm: 92, steps: 16, kit: 'tabla', pad: 'drone', lead: 'pluck', bassType: 'sub', leadEvery: 1,
  bars: Array.from({ length: 8 }, (_, i) => ({ root: 38, pad: i % 4 === 3 ? [50, 57, 62] : [50, 57] })),
  leadNotes: [
    [[0, P(4), 3], [3, P(3), 1], [4, P(2), 4], [8, P(1), 2], [10, P(2), 2], [12, P(4), 4]],
    [[0, P(5), 6], [6, P(4), 2], [8, P(3), 4], [12, P(2), 4]],
    [[0, P(2), 2], [2, P(3), 2], [4, P(4), 2], [6, P(5), 2], [8, P(7), 6], [14, P(6), 2]],
    [[0, P(5), 8], [8, P(4), 2], [10, P(3), 2], [12, P(2), 4]],
    [[0, P(4), 3], [3, P(5), 1], [4, P(7), 4], [8, P(6), 2], [10, P(5), 2], [12, P(4), 4]],
    [[0, P(3), 4], [4, P(2), 4], [8, P(1), 4], [12, P(0), 4]],
    [[0, P(1), 2], [2, P(2), 2], [4, P(4), 4], [8, P(2), 2], [10, P(1), 2], [12, P(0), 4]],
    [[0, P(0), 12]],
  ],
  drums: { ge: R(0, 6, 10), na: R(2, 4, 8, 12, 14), te: R(3, 7, 11, 13, 15), tin: R(5, 9) },
  bass: [0, null, null, null, null, null, 7, null, 0, null, null, null, null, null, 7, null],
  loops: 4,
};
const CHENDA = {
  title: 'Chenda Nights', gain: 0.82, bpm: 118, steps: 16, kit: 'tabla', pad: 'drone', lead: 'reed', bassType: 'sub', leadEvery: 2,
  bars: Array.from({ length: 8 }, () => ({ root: 38, pad: [50, 57] })),
  leadNotes: [
    [[0, P(2), 2], [2, P(4), 2], [4, P(5), 4], [8, P(4), 2], [10, P(2), 2], [12, P(1), 4]],
    [[0, P(2), 8], [8, P(4), 4], [12, P(5), 4]],
    [[0, P(7), 4], [4, P(6), 2], [6, P(5), 2], [8, P(4), 4], [12, P(5), 4]],
    [[0, P(4), 12], [12, P(2), 4]],
    [[0, P(2), 2], [2, P(4), 2], [4, P(5), 4], [8, P(7), 2], [10, P(8), 2], [12, P(7), 4]],
    [[0, P(5), 8], [8, P(4), 4], [12, P(2), 4]],
    [[0, P(1), 2], [2, P(2), 2], [4, P(1), 2], [6, P(0), 2], [8, P(-1), 4], [12, P(0), 4]],
    [[0, P(0), 16]],
  ],
  // the chenda (Kerala's temple drum): fast rolls that build through every 4th bar
  drums: { ge: R(0, 8, 11), na: R(4, 12), chenda: (s, bar) => (bar % 4 === 3 ? 0.5 + s / 32 : s % 2 === 0 ? 0.35 : s % 4 === 3 ? 0.25 : 0), te: R(2, 6, 10, 14) },
  bass: [0, null, null, 0, null, null, 7, null, 0, null, null, 0, null, 7, null, null],
  loops: 4,
};

// ------------------------------------------------------------------ Kuthu 104: mass beats
// heavy dhol-style toms, claps, a nadaswaram-like reed riff over a pumping sub
const MASS_ENTRY = {
  title: 'Mass Entry', gain: 0.6, bpm: 132, steps: 16, kit: 'kuthu', pad: 'none', lead: 'reed', bassType: 'sub', leadEvery: 1,
  bars: [
    { root: 38, pad: [] }, { root: 38, pad: [] }, { root: 39, pad: [] }, { root: 38, pad: [] },
    { root: 36, pad: [] }, { root: 38, pad: [] }, { root: 39, pad: [] }, { root: 38, pad: [] },
  ],
  leadNotes: [
    [[0, 74, 2], [2, 75, 2], [4, 74, 2], [6, 72, 2], [8, 70, 4], [12, 69, 4]],
    [[0, 74, 3], [3, 74, 1], [4, 77, 4], [8, 75, 2], [10, 74, 2], [12, 72, 4]],
    [[0, 75, 2], [2, 77, 2], [4, 79, 4], [8, 77, 2], [10, 75, 2], [12, 74, 4]],
    [[0, 74, 12], [12, 72, 4]],
    [[0, 72, 2], [2, 74, 2], [4, 75, 2], [6, 77, 2], [8, 79, 4], [12, 81, 4]],
    [[0, 82, 4], [4, 81, 4], [8, 79, 4], [12, 77, 4]],
    [[0, 75, 2], [2, 74, 2], [4, 75, 2], [6, 77, 2], [8, 75, 4], [12, 74, 4]],
    [[0, 74, 16]],
  ],
  drums: { dhol: R(0, 3, 6, 8, 10, 11, 14), tom: R(2, 7, 12, 15), clap: R(4, 12), hat: 'eighths' },
  bass: [0, null, 0, 0, null, 0, null, 12, 0, null, 0, 0, null, 0, 12, null],
  loops: 4,
};
const THATTU = {
  title: 'Thattu Kada', gain: 0.58, bpm: 140, steps: 16, kit: 'kuthu', pad: 'saw', lead: 'reed', bassType: 'sub', leadEvery: 2,
  bars: [
    { root: 33, pad: [57, 60, 64] }, { root: 33, pad: [57, 60, 64] }, { root: 31, pad: [55, 58, 62] }, { root: 31, pad: [55, 58, 62] },
    { root: 29, pad: [53, 57, 60] }, { root: 29, pad: [53, 57, 60] }, { root: 28, pad: [52, 56, 59] }, { root: 28, pad: [52, 56, 59] },
  ],
  leadNotes: [
    [[0, 76, 2], [2, 76, 2], [4, 77, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4]],
    [[0, 72, 2], [2, 74, 2], [4, 76, 8], [12, 74, 4]],
    [[0, 74, 2], [2, 74, 2], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 70, 4]],
    [[0, 70, 2], [2, 72, 2], [4, 74, 8], [12, 72, 4]],
    [[0, 72, 2], [2, 72, 2], [4, 74, 2], [6, 72, 2], [8, 69, 4], [12, 65, 4]],
    [[0, 69, 4], [4, 72, 4], [8, 77, 8]],
    [[0, 76, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 71, 4], [12, 68, 4]],
    [[0, 64, 8], [8, 68, 4], [12, 71, 4]],
  ],
  drums: { dhol: R(0, 6, 8, 11, 14), tom: R(3, 10, 13), clap: R(4, 12, 15), hat: 'sixteenths' },
  bass: [0, null, 12, 0, null, 12, 0, null, 0, null, 12, 0, null, 12, 7, null],
  loops: 4,
};

// ------------------------------------------------------------------ Monsoon Lo-fi 88.5
// swung, dusty, electric-piano chords, vinyl crackle and rain
const RAIN_ON_TIN = {
  title: 'Rain on Tin', bpm: 76, steps: 16, kit: 'lofi', pad: 'rhodes', lead: 'rhodes', bassType: 'round', swing: 0.22, crackle: true, leadEvery: 2,
  bars: [
    { root: 29, pad: [57, 60, 64, 65] }, { root: 28, pad: [55, 59, 62, 64] }, { root: 26, pad: [53, 57, 60, 62] }, { root: 36, pad: [52, 55, 59, 60] },
    { root: 29, pad: [57, 60, 64, 65] }, { root: 28, pad: [55, 59, 62, 64] }, { root: 26, pad: [53, 57, 60, 62] }, { root: 31, pad: [53, 59, 62, 65] },
  ],
  leadNotes: [
    [[2, 76, 2], [4, 77, 4], [10, 76, 2], [12, 72, 4]],
    [[0, 74, 6], [8, 71, 2], [10, 72, 2], [12, 74, 4]],
    [[2, 72, 2], [4, 74, 2], [6, 72, 2], [8, 69, 8]],
    [[0, 67, 12]],
    [[2, 76, 2], [4, 77, 4], [10, 79, 2], [12, 81, 4]],
    [[0, 79, 6], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
    [[2, 72, 2], [4, 74, 2], [6, 77, 2], [8, 76, 8]],
    [[0, 74, 12]],
  ],
  drums: { kick: R(0, 7, 10), snare: R(4, 12), hat: 'eighths', rim: R(15) },
  bass: [0, null, null, null, null, null, null, 7, null, null, 0, null, null, null, 7, null],
  loops: 3,
};
const LATE_BUS = {
  title: 'Last Bus to Iritty', bpm: 82, steps: 16, kit: 'lofi', pad: 'rhodes', lead: 'pluck', bassType: 'round', swing: 0.18, crackle: true, leadEvery: 2,
  bars: [
    { root: 26, pad: [53, 57, 60, 64] }, { root: 31, pad: [53, 55, 59, 62] }, { root: 36, pad: [52, 55, 59, 64] }, { root: 33, pad: [52, 55, 60, 64] },
    { root: 26, pad: [53, 57, 60, 64] }, { root: 31, pad: [53, 55, 59, 62] }, { root: 36, pad: [52, 55, 59, 64] }, { root: 28, pad: [52, 56, 59, 62] },
  ],
  leadNotes: [
    [[0, 72, 2], [3, 74, 1], [4, 76, 4], [12, 74, 4]],
    [[0, 71, 8], [10, 67, 2], [12, 71, 4]],
    [[0, 72, 4], [4, 76, 4], [8, 79, 4], [12, 76, 4]],
    [[0, 76, 12]],
    [[0, 77, 2], [3, 76, 1], [4, 74, 4], [12, 72, 4]],
    [[0, 74, 8], [10, 71, 2], [12, 74, 4]],
    [[0, 72, 4], [4, 71, 4], [8, 67, 8]],
    [[0, 68, 12]],
  ],
  drums: { kick: R(0, 6, 9), snare: R(4, 12), hat: 'eighths', rim: R(7, 14) },
  bass: [0, null, null, null, null, null, 7, null, 12, null, null, null, 7, null, null, null],
  loops: 3,
};

export const STATIONS = [
  { id: 'nightshift', name: 'NIGHTSHIFT 99.1', genre: 'Synthwave', color: '#ff3d8a', songs: [NIGHT_SHIFT, NEON_COAST] },
  { id: 'kayal', name: 'Kayal FM 92.7', genre: 'Kerala folk fusion', color: '#3dffb0', songs: [BACKWATER, CHENDA] },
  { id: 'kuthu', name: 'Kuthu 104', genre: 'Mass beats', color: '#ffb03d', songs: [MASS_ENTRY, THATTU] },
  { id: 'monsoon', name: 'Monsoon Lo-fi 88.5', genre: 'Lo-fi', color: '#8ab4ff', songs: [RAIN_ON_TIN, LATE_BUS] },
  { id: 'off', name: 'Radio Off', genre: '', color: '#888888', songs: [] },
];
export const DEFAULT_SONG = NIGHT_SHIFT;
