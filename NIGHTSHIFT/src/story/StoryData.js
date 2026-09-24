// NIGHTSHIFT story: "Port Halvern". Three people give you work; each mission unlocks the next.
// Locations: [k, l] = road grid node (k*160, l*160); { x, z } = world position; 'giver' = the mission
// giver's spot. Step types are handled in Story.js:
//   goto    drive/walk to a place (stop: must stop there briefly)
//   steal   get into a specific parked vehicle (heat: police notice when you take it)
//   deliver bring the vehicle you're in somewhere (maxDamage, time limit)
//   lose    shake a police pursuit of the given heat
//   tail    follow an AI vehicle without being spotted or losing it
//   race    beat a rival to the finish
//   ram     knock a fleeing vehicle out before it gets away
//   call    phone call subtitles (non-blocking)

export const CAST = {
  you: { name: 'You', color: '#ffffff' },
  tully: { name: 'Tully', role: 'Mechanic', color: '#ffb03d', look: { jacket: 0x5a4632, jeans: 0x2a2a2c, skin: 0x8a5e40, hair: 0x9a9a9a }, spot: { x: 250, z: -410 } },
  mara: { name: 'Mara Voss', role: 'Crew boss', color: '#ff4d8d', look: { jacket: 0x121214, jeans: 0x1a1a22, skin: 0xd2a07a, hair: 0x2a0f12 }, spot: { x: -250, z: 96 } },
  deacon: { name: 'Deacon', role: 'Fixer', color: '#3dc8ff', look: { jacket: 0x2a3a52, jeans: 0x3a3a3a, skin: 0x5a3a28, hair: 0x0a0a0a }, spot: { x: 640, z: -480 } },
  jonah: { name: 'Jonah', color: '#9dff6a' },
  kaze: { name: 'Kaze', color: '#ff3df0' },
  graves: { name: 'Lt. Graves', color: '#ff6a3d' },
};

export const STORY = [
  {
    id: 'fresh_plates', giver: 'tully', title: 'Fresh Plates',
    intro: [
      ['tully', "So you're the driver Mara sent. Clean shoes, no record. Won't last."],
      ['tully', "There's a grey sedan parked up in the Market District. The owner owes me for a transmission."],
      ['tully', 'Bring it back here in one piece. Every dent comes out of your cut.'],
      ['you', 'Easy money.'],
    ],
    steps: [
      { type: 'steal', vehicle: 'sedan', paint: '#8a9098', at: [-1, -2], text: 'Steal the <b>grey sedan</b> parked in the Market District.' },
      { type: 'deliver', to: 'giver', maxDamage: 0.55, text: "Take the sedan to <b>Tully's garage</b>. Don't wreck it." },
    ],
    outro: [['tully', "Huh. Not a scratch. Alright, kid. Mara's going to want to meet you."]],
    reward: { cash: 3000, xp: 600 },
  },
  {
    id: 'wheelman', giver: 'mara', title: 'Wheelman', requires: ['fresh_plates'],
    intro: [
      ['mara', 'Tully says you can drive. Tonight we find out.'],
      ['mara', "Jonah's finishing a job on the east side. He'll need a ride out, and he'll be bringing company."],
      ['you', 'Company?'],
      ['mara', 'Blue lights. Lose them, then bring him home.'],
    ],
    steps: [
      { type: 'goto', to: [2, 0], stop: true, inVehicle: true, text: 'Pick up <b>Jonah</b> on the east side.' },
      { type: 'call', lines: [['jonah', "Go, go, go! They're right behind me!"]] },
      { type: 'lose', heat: 2, text: 'Lose the <b>police</b>.' },
      { type: 'goto', to: 'giver', stop: true, inVehicle: true, text: "Take Jonah back to <b>Mara's</b>." },
    ],
    outro: [['jonah', "That was insane. You're alright."], ['mara', "Good. Deacon's been asking for a driver. Go see him at the docks."]],
    reward: { cash: 5000, xp: 1000 },
  },
  {
    id: 'tail_light', giver: 'deacon', title: 'Tail Light', requires: ['wheelman'],
    intro: [
      ['deacon', 'Name is Deacon. I find things out for people.'],
      ['deacon', 'A courier van leaves these docks every night and nobody knows where it goes.'],
      ['deacon', "Follow it. Not too close, not too far. If he makes you, we lose the whole route."],
    ],
    steps: [
      { type: 'tail', vehicle: 'van', paint: '#e8e8e2', route: [[4, -2], [4, 0], [2, 0], [2, 2], [0, 2]], text: 'Follow the <b>courier van</b>. Stay out of sight.' },
      { type: 'call', lines: [['deacon', 'A warehouse on Birch Street. Interesting. Good work. Now get out of there.']] },
    ],
    outro: [],
    reward: { cash: 6000, xp: 1200 },
  },
  {
    id: 'sore_loser', giver: 'mara', title: 'Sore Loser', requires: ['tail_light'],
    intro: [
      ['mara', "Kaze's been telling every crew in town the Vosses are finished."],
      ['mara', 'He wants a race. Winner takes the other crew\'s corner.'],
      ['you', "Then let's take it."],
    ],
    steps: [
      { type: 'goto', to: [-1, 0], inVehicle: true, text: 'Meet <b>Kaze</b> at the start line.' },
      { type: 'race', rival: 'kaze', car: 'nissan_skyline_r34', route: [[-1, 0], [1, 0], [1, 2], [3, 2], [3, 0]], text: 'Beat <b>Kaze</b> to the finish.' },
    ],
    outro: [['kaze', "...Whatever. It's just a corner."], ['mara', "It's never just a corner. Nice driving."]],
    reward: { cash: 8000, xp: 1500 },
  },
  {
    id: 'insurance_job', giver: 'tully', title: 'Insurance Job', requires: ['sore_loser'],
    intro: [
      ['tully', "Kaze's crew stole a van full of my parts. Sore loser."],
      ['tully', "They're moving it across town right now. I don't want it back. I want it off the road."],
      ['tully', 'Ram it till it quits. Nobody gets hurt, the insurance pays me, everybody is happy.'],
    ],
    steps: [
      { type: 'ram', vehicle: 'van', paint: '#3a3f36', from: [1, -2], route: [[1, -2], [1, 1], [-2, 1], [-2, 3], [-4, 3]], hits: 4, text: 'Ram the <b>van</b> off the road.' },
    ],
    outro: [['tully', "Heard the crash from here. Beautiful. Drinks are on me."]],
    reward: { cash: 7000, xp: 1400 },
  },
  {
    id: 'hot_property', giver: 'deacon', title: 'Hot Property', requires: ['insurance_job'],
    intro: [
      ['deacon', 'Remember that warehouse? Your courier was moving a car. A very expensive car.'],
      ['deacon', "It's parked outside right now, and the cops have a tracker on it."],
      ['deacon', 'Take it, shake the tracker, bring it here. Scratch it and the buyer walks.'],
    ],
    steps: [
      { type: 'steal', vehicle: 'porsche_911_gt3', paint: '#f0f0f0', at: [0, 2], heat: 3, text: 'Steal the <b>911 GT3</b> outside the warehouse.' },
      { type: 'lose', heat: 3, text: 'The car is tracked. Lose the <b>police</b>.' },
      { type: 'deliver', to: 'giver', maxDamage: 0.45, text: 'Bring the GT3 to <b>Deacon</b> at the docks. Keep it clean.' },
    ],
    outro: [['deacon', 'Buyer is very happy. And now I know who owns that warehouse: Lieutenant Graves.']],
    reward: { cash: 15000, xp: 2500 },
  },
  {
    id: 'last_call', giver: 'mara', title: 'Last Call', requires: ['hot_property'],
    intro: [
      ['mara', 'Graves has been taking money from Kaze, from us, from everybody.'],
      ['mara', "He's leaving town tonight with all of it."],
      ['mara', 'Run him off the road before he reaches the highway. Then disappear.'],
      ['you', 'And after that?'],
      ['mara', "After that, this city is ours."],
    ],
    steps: [
      { type: 'ram', vehicle: 'suv', paint: '#0e0f11', from: [-2, -1], route: [[-2, -1], [0, -1], [0, -3], [3, -3], [5, -3]], hits: 5, text: 'Run <b>Graves</b> off the road.' },
      { type: 'call', lines: [['graves', "You have no idea who you're messing with!"]] },
      { type: 'lose', heat: 4, text: 'Lose the <b>police</b>.' },
      { type: 'goto', to: 'giver', stop: true, inVehicle: true, text: "Get back to <b>Mara's</b>." },
    ],
    outro: [['mara', "Graves is done. Kaze's gone quiet. Port Halvern is ours."], ['mara', 'Get some sleep, driver. Tomorrow we get to work.']],
    reward: { cash: 30000, xp: 5000 },
    finale: true,
  },
];
