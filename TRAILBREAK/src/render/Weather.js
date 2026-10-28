// The weather the shaders share: one set of uniforms spread into each map's terrain (render/Terrain.js), the far
// land's, the glass's (render/TruckModel.js) and the rain's own (render/Rain.js), as TrackMap.js shares its tracks.
// uRain: how hard it rains (0 dry to 1); uRainT: the rain's clock (s), for the rings the drops make on standing water;
// uWet: how wet the ground is (it lingers after the rain, core/Game.js wetK); uPond: how full of the rain its ruts and
// hollows are (pondK).
export const WEATHER_UNIFORMS = {
  uRain: { value: 0 },
  uRainT: { value: 0 },
  uWet: { value: 0 },
  uPond: { value: 0 },
};
