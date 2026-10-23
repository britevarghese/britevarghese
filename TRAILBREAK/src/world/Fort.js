// Korlai's fort (world/maps/north.js): its plan, shared by what draws it (render/Landmarks.js) and what the trucks meet
// (world/WorldGen.js's wall posts). In the fort's own frame: x along it (its gates at either end, the road through them),
// z across it.
export const FORT = { w: 9, gate: 3.4, wall: 1.6, height: 6.5, tower: 4.2 };

/**
 * The plan of a fort `len` m long: its curtain walls (each [x0, z0, x1, z1]: the two long sides, and the ends either
 * side of their gateways), its bastions ([x, z]: round towers at the corners and every 50 m or so along both sides),
 * and the ruin of its church ([x, z, width]: a gable wall facing the road).
 */
export function fortPlan(len) {
  const a = len / 2, { w, gate } = FORT;
  const walls = [[-a, -w, a, -w], [-a, w, a, w], [-a, -w, -a, -gate], [-a, gate, -a, w], [a, -w, a, -gate], [a, gate, a, w]];
  const towers = [[-a, -w], [-a, w], [a, -w], [a, w]], n = Math.max(1, Math.round(len / 50));
  for (let k = 1; k < n; k++) towers.push([-a + k * len / n, -w], [-a + k * len / n, w]);
  return { walls, towers, church: [a * 0.45, 5.8, 9] };
}
