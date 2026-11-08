// Squads: each team is split into squads of four (Battlefield style). Squad mates are a spawn point for each other.
export const SQUAD_SIZE = 4;
export const SQUAD_NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'];
export const squadName = (n) => (n ? SQUAD_NAMES[(n - 1) % SQUAD_NAMES.length] : '');
// why a squad mate can't be spawned on right now (shown on the deploy screen)
export const SQUAD_BLOCK = { c: 'IN COMBAT', v: 'IN A VEHICLE', a: 'IN THE AIR', r: 'OUT OF BOUNDS' };
export const SQUAD_SAFE_MS = 5000, SQUAD_ENEMY_R = 20;
