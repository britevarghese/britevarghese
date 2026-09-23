// Race event definitions. Waypoints are grid node coordinates (k, l) => (k*160, l*160).
// The actual driving route between waypoints is found on the road graph (A*); checkpoint gates
// are placed at the listed waypoints. 'ring' waypoints use highway ring junctions.
export const RACE_EVENTS = [
  {
    id: 'sprint_downtown', name: 'Downtown Dash', type: 'sprint', opponents: 3, reward: 4000, rep: 120,
    desc: 'A flat-out sprint through the towers of downtown to the river.',
    waypoints: [[-2, -1], [-2, 1], [0, 1], [1, 1], [1, 2], [3, 2], [3, 0]],
  },
  {
    id: 'circuit_market', name: 'Market Loop', type: 'circuit', laps: 2, opponents: 3, reward: 5500, rep: 160,
    desc: 'Two laps around the Market District. Tight corners, parked cars.',
    waypoints: [[-3, -2], [-1, -2], [-1, 0], [-3, 0]],
  },
  {
    id: 'checkpoint_heights', name: 'Elm Heights Checkpoint', type: 'checkpoint', timeLimit: 32, timeBonus: 9, reward: 3000, rep: 90,
    desc: 'Beat the clock through the suburbs. Every gate adds time.',
    waypoints: [[-4, 4], [-4, 5], [-2, 5], [-2, 4], [-3, 4], [-3, 3], [-5, 3]],
  },
  {
    id: 'speedrun_ring', name: 'Ring Road Speedtrap', type: 'speedrun', reward: 4500, rep: 140, target: 1050,
    desc: 'Hit every speed trap on the highway as fast as you can. Total speed decides.',
    waypoints: [[0, 6], ['ring', 0, 'N'], ['ring', 2, 'N'], ['ring', 4, 'N'], ['ring', 4, 'E'], ['ring', 2, 'E'], ['ring', 0, 'E'], ['ring', -2, 'E']],
  },
  {
    id: 'timetrial_ironworks', name: 'Ironworks Time Trial', type: 'timetrial', reward: 3500, rep: 110, target: 70,
    desc: 'Solo run through the industrial district. Beat the target time.',
    waypoints: [[4, 0], [4, 2], [5, 2], [5, 4], [4, 4], [4, 5], [6, 5], [6, 1]],
  },
  {
    id: 'escape_docks', name: 'Dockside Getaway', type: 'escape', heat: 3, timeLimit: 150, reward: 6000, rep: 200,
    desc: 'The police are already on to you. Lose them before time runs out.',
    waypoints: [[4, -3]],
  },
  {
    id: 'sprint_river', name: 'Riverside Run', type: 'sprint', opponents: 3, reward: 4800, rep: 140,
    desc: 'Cross every bridge. First to the ironworks takes the cash.',
    waypoints: [[2, -4], [2, -2], [4, -2], [4, -1], [2, -1], [2, 1], [4, 1], [4, 3]],
  },
];

export const RACE_TYPE_NAMES = { sprint: 'SPRINT', circuit: 'CIRCUIT', checkpoint: 'CHECKPOINT', speedrun: 'SPEED RUN', timetrial: 'TIME TRIAL', escape: 'POLICE ESCAPE' };
