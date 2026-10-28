// Ground surfaces. The tire model reads each one's grip and how its force curve is shaped; deformable soils
// (mud, sand, snow) also sink under load and dig out under a spinning wheel, and a wheel spun on the spot on earth,
// grass or gravel digs into it too (see Vehicle.js, ground.deform).
//
//   mu      peak friction coefficient for an all-terrain tyre
//   slip    stretches the slip at which the peak is reached: loose ground peaks at a much larger slip, tarmac sooner (a
//           tyre grips it with the whole tread at once: stiff in a bend, so a truck takes a fast one at a small slip
//           angle instead of sliding round it)
//   C       shape of the force curve: > 1 has a peak then falls off to sliding friction (firm ground);
//           1 rises and saturates with no peak (loose ground, where more wheelspin keeps pulling a little)
//   rr      rolling resistance coefficient
//   sink    soil stiffness for the pressure-sinkage law z = (p / sink)^(1/n) (kPa per m^n); 0: rigid
//   n       sinkage exponent
//   maxSink deepest rut (m)
//   loose   firm ground's loose layer (m): the soil, torn turf or gravel on top that a tyre spun on the spot digs
//           itself a hole through (a rolling one moves on before it does); it isn't pressed
//   dig     how fast a spinning tyre digs down (m per m of slip)
//   drag    extra rolling drag per metre of sinkage (bulldozing the soil ahead of the tyre)
//   visc    rolling drag per m/s of speed: wet mud clings to the tyres and is flung off them, so the faster a truck
//           ploughs through it the harder it pulls
//   rate    the share of its sinkage wet mud takes time to give (Vehicle.js SOIL_GIVE): it squeezes out from under a tread
//           rolled over it quickly, so a truck keeping its speed up rides higher than one crawling, by up to a third
//   creep   how a standing tyre goes on settling into it, by the log of the time (Vehicle.js CREEP_T0), as saturated
//           mud drains and a bog's peat creeps (all of it in a map's deep mud, a third in its kind's own): a truck
//           stopped in a bog sinks in, half as deep again in a minute
//   hull    friction of the chassis/skid plates sliding on it
//
// tea: a tea estate's rows of waist-high bushes. Tyres find soft leaf mulch under them, and the woody bushes drag at
// the axles and bumpers: a truck can push through, slowly, flattening a lane.

export const SURFACE = { GRASS: 0, DIRT: 1, GRAVEL: 2, ROCK: 3, MUD: 4, SAND: 5, SNOW: 6, ROAD: 7, RIVERBED: 8, ICE: 9, TEA: 10 };

export const SURFACES = [
  // (grass grips like packed dirt, but the give of the turf under the tyres drags: a truck goes a little slower on it,
  // more so the faster it goes)
  { id: 0, name: 'grass', mu: 0.8, slip: 1.0, C: 1.25, rr: 0.06, sink: 0, n: 1, maxSink: 0, loose: 0.05, dig: 0.001, drag: 0, visc: 0.001, hull: 0.4 },
  { id: 1, name: 'dirt', mu: 0.78, slip: 1.15, C: 1.35, rr: 0.03, sink: 0, n: 1, maxSink: 0, loose: 0.06, dig: 0.0016, drag: 0, hull: 0.5 },
  { id: 2, name: 'gravel', mu: 0.66, slip: 1.6, C: 1.12, rr: 0.03, sink: 0, n: 1, maxSink: 0, loose: 0.04, dig: 0.0012, drag: 0, hull: 0.45 },
  { id: 3, name: 'rock', mu: 1.02, slip: 1.0, C: 1.4, rr: 0.012, sink: 0, n: 1, maxSink: 0, dig: 0, drag: 0, hull: 0.42 },
  { id: 4, name: 'mud', mu: 0.42, slip: 2.4, C: 1.0, rr: 0.06, sink: 820, n: 1, maxSink: 0.36, dig: 0.012, drag: 0.35, visc: 0.025, rate: 0.45, creep: 0.15, hull: 0.25 },
  { id: 5, name: 'sand', mu: 0.5, slip: 2.0, C: 1.0, rr: 0.05, sink: 700, n: 1, maxSink: 0.24, dig: 0.01, drag: 0.55, hull: 0.4 },
  { id: 6, name: 'snow', mu: 0.34, slip: 1.9, C: 1.0, rr: 0.035, sink: 900, n: 1, maxSink: 0.3, dig: 0.006, drag: 0.3, hull: 0.15 },
  { id: 7, name: 'road', mu: 0.95, slip: 0.7, C: 1.45, rr: 0.013, sink: 0, n: 1, maxSink: 0, dig: 0, drag: 0, hull: 0.5 },
  { id: 8, name: 'riverbed', mu: 0.6, slip: 1.6, C: 1.1, rr: 0.045, sink: 2600, n: 1, maxSink: 0.08, dig: 0.004, drag: 0.4, hull: 0.35 },
  { id: 9, name: 'ice', mu: 0.09, slip: 1.2, C: 1.2, rr: 0.012, sink: 0, n: 1, maxSink: 0, dig: 0, drag: 0, hull: 0.05 },
  { id: 10, name: 'tea', mu: 0.6, slip: 1.4, C: 1.15, rr: 0.15, sink: 2600, n: 1, maxSink: 0.07, dig: 0.002, drag: 0.6, hull: 0.6 },
];

export const surfaceById = (id) => SURFACES[id] || SURFACES[0];
