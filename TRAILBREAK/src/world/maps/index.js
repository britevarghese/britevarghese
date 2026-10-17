// The maps: each a definition the generator builds a world from (world/WorldGen.js), with its own events, ground
// textures and trees. A room drives one map: the first player in a room picks it, friends who join get the same.
//
// Every map is the square |x|, |z| < MAP_HALF (m): the ground grids, the minimap and the obstacle buckets share it.
import { ASHWOOD } from './ashwood.js';
import { KERALA } from './kerala.js';
import { COAST } from './coast.js';

export const MAP_HALF = 1024;
/** How close (m) to drive to a survey beacon to log it. */
export const BEACON_RADIUS = 9;

export const MAPS = { ashwood: ASHWOOD, kerala: KERALA, coast: COAST };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'ashwood';

/** A map's definition by id (the default map for anything unknown). */
export const mapById = (id) => MAPS[id] || MAPS[DEFAULT_MAP];
