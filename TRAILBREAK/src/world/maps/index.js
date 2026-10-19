// The maps: each a definition the generator builds a world from (world/WorldGen.js), with its own events, ground
// textures and trees. A room drives one map: the first player in a room picks it, friends who join get the same.
//
// Every map is a square, |x|, |z| < its half-size (m; MAP_HALF unless it says otherwise): the ground grids, the
// minimap and the obstacle buckets share it.
import { ASHWOOD } from './ashwood.js';
import { KERALA } from './kerala.js';
import { COAST } from './coast.js';

export const MAP_HALF = 1024;

/**
 * A map's grids: its half-size (m), the fine grid's cell (m: the ground's heights and surfaces), the macro grid's
 * (the landform) and the water grid's. A big map has bigger cells (its definition says so); the others these.
 */
export const gridOf = (M) => ({ half: M?.half ?? MAP_HALF, res: M?.res ?? 1, coarse: M?.coarse ?? 4, waterRes: M?.waterRes ?? 2 });
/** How close (m) to drive to a survey beacon to log it. */
export const BEACON_RADIUS = 9;

export const MAPS = { ashwood: ASHWOOD, kerala: KERALA, coast: COAST };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'ashwood';

/** A map's definition by id (the default map for anything unknown). */
export const mapById = (id) => MAPS[id] || MAPS[DEFAULT_MAP];
