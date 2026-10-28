// Procedural vehicle models (no CC0 armour / attack-helicopter meshes exist): a modern main battle tank
// (Leopard 2 / Abrams class proportions: 7.4 m hull, 3.6 m wide, wedge-armoured turret, 120 mm smoothbore with
// thermal sleeve and bore evacuator, hollow tracks with road wheels / sprocket / idler, side skirts, commander's
// cupola with roof MG, smoke dischargers, bustle rack) and a tandem-seat attack helicopter (Apache class: lofted
// fuselage, stepped cockpit glazing, turboshaft nacelles, stub wings with rocket pods, chin cannon turret,
// 4-blade main rotor with motion-blur disc, tail rotor, tail wheel). Painted with canvas camouflage (team 1
// woodland green, team 2 desert tan), panel lines and weathering.
// Local frame: nose toward -Z, +Y up, origin on the ground under the hull / fuselage centre.
// One file per vehicle in ./models (shared materials / helpers / weathering in models/kit.js).
export { buildTank } from './models/tank.js';
export { buildHeli } from './models/heli.js';
export { buildJeep } from './models/jeep.js';
export { buildBike } from './models/bike.js';
export { setWrecked } from './models/kit.js';
