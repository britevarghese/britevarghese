// A hash for the shaders' noise that stays random however far from the map's centre. The usual
// fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453) does not: on a big map the sine's argument runs to hundreds of
// thousands, where a float steps in sixteenths of a radian, and the noise came out as a grid (a crosshatch over the
// Konkan Coast's roads). This mixes the bits of the numbers instead (PCG, Jarzynski & Olano 2020); its input is read
// to 1/64, plenty for lattice corners and the offsets the shaders hash.
export const HASH21 = `
#ifndef TB_HASH21
#define TB_HASH21
float hash21(vec2 p) {
  uvec2 v = uvec2(ivec2(floor(p * 64.0)));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return float((v.x ^ v.y) >> 8u) * (1.0 / 16777216.0);
}
#endif
`;
