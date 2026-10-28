// The weather the shaders share: one set of uniforms spread into each map's terrain (render/Terrain.js), the far
// land's and the rain's own (render/Rain.js), as TrackMap.js shares its tracks. uRain: how hard it rains (0 dry to 1);
// uRainT: the rain's clock (s), for the rings the drops make on standing water.
export const WEATHER_UNIFORMS = {
  uRain: { value: 0 },
  uRainT: { value: 0 },
};
