// Career missions: five chapters of objectives tracked from gameplay stats. Completing a chapter's
// finale (or reaching its level) opens the next chapter. Some cars are only unlocked by missions.
// value(ctx) returns the current progress toward `target`; ctx = { stats, save, level }.
export const CHAPTERS = [
  { id: 1, name: 'New in Town', level: 1 },
  { id: 2, name: 'Making a Name', level: 4 },
  { id: 3, name: 'Rising Star', level: 9 },
  { id: 4, name: 'Kings of the Night', level: 14 },
  { id: 5, name: 'Apex', level: 20 },
];

const wins = (ctx) => ctx.stats.racesWon || 0;
const won = (id) => (ctx) => (ctx.stats.wonEvents?.[id] ? 1 : 0);

export const MISSIONS = [
  // ---- chapter 1
  { id: 'first_night', chapter: 1, name: 'First Night', desc: 'Win any street race.', target: 1, value: wins, reward: { cash: 3000, xp: 600 } },
  { id: 'street_cred', chapter: 1, name: 'Street Cred', desc: 'Near-miss 15 cars in traffic.', target: 15, value: (c) => c.stats.nearMisses || 0, reward: { cash: 2000, xp: 400 } },
  { id: 'tuned_up', chapter: 1, name: 'Tuned Up', desc: 'Buy any performance upgrade.', target: 1, value: (c) => c.stats.upgrades || 0, reward: { cash: 1500, xp: 300 } },
  { id: 'blue_lights', chapter: 1, name: 'Blue Lights', desc: 'Escape a police pursuit.', target: 1, value: (c) => c.stats.escapes || 0, reward: { cash: 4000, xp: 800 } },
  { id: 'downtown_dash', chapter: 1, name: 'Downtown Legend', desc: 'Win the Downtown Dash sprint.', target: 1, value: won('sprint_downtown'), reward: { cash: 5000, xp: 1000 }, finale: true },
  // ---- chapter 2
  { id: 'sideways', chapter: 2, name: 'Sideways', desc: 'Hold one drift for 3 seconds.', target: 3, value: (c) => c.stats.longestDrift || 0, unit: 's', reward: { cash: 3000, xp: 700 } },
  { id: 'ton_up', chapter: 2, name: 'Double Ton', desc: 'Reach 200 km/h.', target: 200, value: (c) => c.stats.topSpeed || 0, unit: 'km/h', reward: { cash: 3000, xp: 600 } },
  { id: 'market_rules', chapter: 2, name: 'Market Rules', desc: 'Win the Market Loop circuit.', target: 1, value: won('circuit_market'), reward: { cash: 6000, xp: 1200 } },
  { id: 'callout', chapter: 2, name: 'Callout', desc: 'Beat 3 street rivals in free roam (pull up next to one and press E).', target: 3, value: (c) => c.stats.streetWins || 0, reward: { cash: 5000, xp: 1200 } },
  { id: 'wrecking_crew', chapter: 2, name: 'Wrecking Crew', desc: 'Knock down 20 street lamps.', target: 20, value: (c) => c.stats.lampsDown || 0, reward: { cash: 4000, xp: 900 } },
  { id: 'widowmaker', chapter: 2, name: 'The Widowmaker', desc: 'Escape a Heat 3 pursuit. Unlocks the Porsche 911 Turbo (930).', target: 3, value: (c) => c.stats.maxEscapeHeat || 0, unit: 'heat', reward: { cash: 10000, xp: 2500, car: 'porsche_930_turbo' }, finale: true },
  // ---- chapter 3
  { id: 'speed_freak', chapter: 3, name: 'Speed Freak', desc: 'Win the Ring Road Speedtrap.', target: 1, value: won('speedrun_ring'), reward: { cash: 7000, xp: 1500 } },
  { id: 'clockwork', chapter: 3, name: 'Clockwork', desc: 'Beat the Ironworks Time Trial target.', target: 1, value: won('timetrial_ironworks'), reward: { cash: 7000, xp: 1500 } },
  { id: 'collector', chapter: 3, name: 'Collector', desc: 'Own 4 cars.', target: 4, value: (c) => Object.keys(c.save.cars || {}).length, reward: { cash: 8000, xp: 1500 } },
  { id: 'heat_wave', chapter: 3, name: 'Heat Wave', desc: 'Escape a Heat 4 pursuit.', target: 4, value: (c) => c.stats.maxEscapeHeat || 0, unit: 'heat', reward: { cash: 12000, xp: 2500 } },
  { id: 'track_weapon', chapter: 3, name: 'Track Weapon', desc: 'Win 10 races. Unlocks the Porsche 911 GT3.', target: 10, value: wins, reward: { cash: 20000, xp: 4000, car: 'porsche_911_gt3' }, finale: true },
  // ---- chapter 4
  { id: 'club_250', chapter: 4, name: '250 Club', desc: 'Reach 250 km/h.', target: 250, value: (c) => c.stats.topSpeed || 0, unit: 'km/h', reward: { cash: 10000, xp: 2000 } },
  { id: 'getaway', chapter: 4, name: 'Getaway Driver', desc: 'Complete the Dockside Getaway.', target: 1, value: won('escape_docks'), reward: { cash: 15000, xp: 3000 } },
  { id: 'night_owl', chapter: 4, name: 'Night Owl', desc: 'Drive 150 km in total.', target: 150, value: (c) => Math.floor((c.save.distanceDriven || 0) / 1000), unit: 'km', reward: { cash: 12000, xp: 2500 } },
  { id: 'rival_hunter', chapter: 4, name: 'Rival Hunter', desc: 'Beat 15 street rivals.', target: 15, value: (c) => c.stats.streetWins || 0, reward: { cash: 20000, xp: 4000 } },
  { id: 'untouchable', chapter: 4, name: 'Untouchable', desc: 'Escape a Heat 5 pursuit.', target: 5, value: (c) => c.stats.maxEscapeHeat || 0, unit: 'heat', reward: { cash: 25000, xp: 5000 } },
  { id: 'legend_of_the_night', chapter: 4, name: 'Legend of the Night', desc: 'Win every race event in the city. Unlocks the Ferrari F40.', target: 7, value: (c) => Object.keys(c.stats.wonEvents || {}).length, reward: { cash: 50000, xp: 8000, car: 'ferrari_f40' }, finale: true },
  // ---- chapter 5
  { id: 'club_300', chapter: 5, name: '300 Club', desc: 'Reach 300 km/h.', target: 300, value: (c) => c.stats.topSpeed || 0, unit: 'km/h', reward: { cash: 25000, xp: 5000 } },
  { id: 'drift_king', chapter: 5, name: 'Drift King', desc: 'Hold one drift for 8 seconds.', target: 8, value: (c) => c.stats.longestDrift || 0, unit: 's', reward: { cash: 20000, xp: 4000 } },
  { id: 'most_wanted', chapter: 5, name: 'Most Wanted', desc: 'Disable 10 police units.', target: 10, value: (c) => c.stats.copsDisabled || 0, reward: { cash: 30000, xp: 6000 } },
  { id: 'veteran', chapter: 5, name: 'Veteran', desc: 'Win 30 races.', target: 30, value: wins, reward: { cash: 40000, xp: 8000 } },
  { id: 'apex_predator', chapter: 5, name: 'Apex Predator', desc: 'Reach driver level 25. Wins the Lamborghini Huracán Twin Turbo.', target: 25, value: (c) => c.level, reward: { cash: 100000, xp: 0, car: 'lamborghini_huracan_tt', gift: true }, finale: true },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
