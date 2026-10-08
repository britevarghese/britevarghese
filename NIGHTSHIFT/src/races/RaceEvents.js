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
    id: 'checkpoint_heights', name: 'Elm Heights Checkpoint', type: 'checkpoint', timeLimit: 40, timeBonus: 10, reward: 3000, rep: 90,
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
    waypoints: [[4, -3], [4, -2]],
  },
  {
    id: 'sprint_river', name: 'Riverside Run', type: 'sprint', opponents: 3, reward: 4800, rep: 140,
    desc: 'Cross every bridge. First to the ironworks takes the cash.',
    waypoints: [[2, -4], [2, -2], [4, -2], [4, -1], [2, -1], [2, 1], [4, 1], [4, 3]],
  },
];

// Kerala: races between real places in and around Kochi (names from the map's place list; each waypoint snaps to
// the nearest junction). Routes are planned when the race starts, on the roads loaded around it; targets and
// time limits come from the route's length. Every place is within ~3 km of the start (the map loaded round it).
export const KERALA_RACES = [
  {
    id: 'kl_mgroad', name: 'MG Road Sprint', type: 'sprint', opponents: 3, reward: 4000, rep: 120,
    desc: 'Down MG Road from Shenoys to Ernakulam South and Ravipuram, then across to Elamkulam. Watch for buses pulling out.',
    places: ['Shenoys', 'Ernakulam South', 'Ravipuram', 'Elamkulam'],
  },
  {
    id: 'kl_kaloor', name: 'Kaloor Loop', type: 'circuit', laps: 2, opponents: 3, reward: 5500, rep: 160,
    desc: 'Two laps round Ernakulam North, Kaloor and Pachalam. Autos everywhere.',
    places: ['Ernakulam North', 'Kaloor', 'Pachalam'],
  },
  {
    id: 'kl_edappally', name: 'Edappally Checkpoint', type: 'checkpoint', reward: 3000, rep: 90,
    desc: 'Beat the clock from Palarivattom to Edappally and back through Elamakkara. Every gate adds time.',
    places: ['Palarivattom', 'Edappally', 'Elamakkara', 'Kaloor'],
  },
  {
    id: 'kl_tripunithura', name: 'Thrippunithura Time Trial', type: 'timetrial', reward: 3500, rep: 110,
    desc: 'Solo run from Petta through Vadakkekotta and Statue Junction to the old royal town. Beat the target time.',
    places: ['Petta', 'Vadakkekotta', 'Statue Junction', 'Thrippunithura'],
  },
  {
    id: 'kl_fortkochi', name: 'Fort Kochi Run', type: 'sprint', opponents: 3, reward: 4800, rep: 140,
    desc: 'Through Mattancherry and Jew Town to Fort Kochi beach, then out over the bridge to Thoppumpady.',
    places: ['Mattancherry', 'Jew Town', 'Fort Kochi', 'Thoppumpady'],
  },
  {
    id: 'kl_bolgatty', name: 'Goshree Getaway', type: 'escape', heat: 3, timeLimit: 150, reward: 6000, rep: 200,
    desc: 'The police are already on to you at Bolgatty. Lose them before time runs out.',
    places: ['Bolgatty', 'Ernakulam North'],
  },
  {
    id: 'kl_kakkanad', name: 'Seaport-Airport Speedtrap', type: 'speedrun', reward: 4500, rep: 140,
    desc: 'Hit every speed trap on the Seaport-Airport road out to Kakkanad. Total speed decides.',
    places: ['Padivattom', 'Chembumukku', 'Kakkanad West', 'Kakkanad'],
  },
];

export const RACE_TYPE_NAMES = { sprint: 'SPRINT', circuit: 'CIRCUIT', checkpoint: 'CHECKPOINT', speedrun: 'SPEED RUN', timetrial: 'TIME TRIAL', escape: 'POLICE ESCAPE' };
