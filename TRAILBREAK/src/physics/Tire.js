// Tyre model.
//
// Each tyre carries two bristle deflection states (longitudinal dx, lateral dy) that follow the slip velocities with
// a relaxation length (the transient tyre model): dx' = (w r - vx) - |vx| dx / sx, dy' = vy - |vx| dy / sy.
// Their steady state is the usual slip ratio (dx / sx = kappa) and slip angle (dy / sy = tan alpha), but unlike
// the steady-state formulas they stay well behaved at standstill: a tyre parked on a slope holds like a stiff spring
// instead of creeping, and a wheel that starts to turn builds force over a short rolling distance.
//
// Force from the effective slips: combined slip with a friction ellipse. Both slips are normalised by their peak
// values, the length of the normalised slip vector goes through a Pacejka-style curve sin(C atan(B s)) (peak at s = 1
// for firm ground, a saturating curve on loose ground), and the force points along the normalised slip vector, so
// braking or wheelspin eats into cornering grip and vice versa. Grip falls off a little with load (load
// sensitivity), which is what makes weight transfer matter.

import { clamp } from './math.js';

const HALF_PI = Math.PI / 2;

/** Curve constants for a surface's shape factor C (cached per C). */
const curveCache = new Map();
function curve(C) {
  let k = curveCache.get(C);
  if (!k) {
    // C > 1: peak at s = 1 (C atan(B) = pi/2), except that B is capped so a nearly flat curve (C just above 1)
    // does not get a very steep start: its peak moves out to a larger slip instead, as on loose gravel.
    // C <= 1: no peak; B gives 90% of the asymptote at s = 1.
    const B = C > 1.0001 ? Math.min(3, Math.tan(HALF_PI / C)) : 0.9 / Math.sqrt(1 - 0.81);
    k = { C, B, slope: C * B };
    curveCache.set(C, k);
  }
  return k;
}

export const DEFAULT_TYRE = {
  radius: 0.4,
  width: 0.27,
  mass: 32,              // kg, wheel + tyre
  inertia: 2.4,          // kg m^2 about the axle, incl. hub and brake drum
  stiffness: 230000,     // N/m vertical
  damping: 2200,         // N s/m vertical
  mu: 1.0,               // tread grip multiplier (all-terrain = 1)
  looseBonus: 1.0,       // extra grip on loose ground (mud-terrain tread > 1)
  kappaPeak: 0.13,       // slip ratio at peak force on firm ground
  alphaPeak: 0.19,       // slip angle (rad) at peak lateral force on firm ground
  relaxX: 0.22,          // m, longitudinal relaxation length
  relaxY: 0.5,           // m, lateral relaxation length
  loadNominal: 5000,     // N
  loadSens: 0.12,        // grip lost per 100% extra load
};

/**
 * Tyre force for one contact.
 *   out:   receives fx (along the wheel's heading, + = forward push), fy (+ = toward the wheel's left),
 *          s (normalised combined slip), mu (effective friction coefficient)
 *   N:     normal load (N)
 *   kappa: effective slip ratio (dx / relaxX)
 *   tanA:  effective tan(slip angle) (dy / relaxY); + when the contact slides to the left
 *   surf:  surface (Surfaces.js)
 *   tyre:  tyre parameters
 */
export function tyreForce(out, N, kappa, tanA, surf, tyre) {
  if (N <= 0) { out.fx = 0; out.fy = 0; out.s = 0; out.mu = 0; return out; }
  const loose = surf.C <= 1.0001;
  const load = clamp(1 - tyre.loadSens * (N / tyre.loadNominal - 1), 0.65, 1.12);
  const mu = surf.mu * tyre.mu * (loose ? tyre.looseBonus : 1) * load;
  const kp = tyre.kappaPeak * surf.slip, ap = tyre.alphaPeak * surf.slip;
  const sx = kappa / kp, sy = tanA / ap;
  const s = Math.sqrt(sx * sx + sy * sy);
  const k = curve(surf.C);
  // force per unit normalised slip; at s -> 0 the curve's slope
  const g = s > 1e-6 ? Math.sin(k.C * Math.atan(k.B * s)) / s : k.slope;
  const F = mu * N * g;
  out.fx = F * sx;
  out.fy = -F * sy;
  out.s = s;
  out.mu = mu;
  return out;
}

/** The tyre's cornering stiffness (N per unit tan alpha) at load N on surface surf, for the low-speed damping. */
export function corneringStiffness(N, surf, tyre) {
  const k = curve(surf.C);
  return surf.mu * tyre.mu * N * k.slope / (tyre.alphaPeak * surf.slip);
}

export function slipStiffness(N, surf, tyre) {
  const k = curve(surf.C);
  return surf.mu * tyre.mu * N * k.slope / (tyre.kappaPeak * surf.slip);
}
