// The valley's layout: hand-placed features the terrain generator builds around. World axes: +x east, +z south,
// +y up, metres. The drivable map is the square |x|, |z| < MAP_HALF.
//
// Ashwood Valley: the Corrie Range to the north (snow on the Summit), a river that runs from the north-west gorge
// down through the valley to the south-east, Mirror Lake in the south-west, the east ridge with its rock garden and
// the old Alder mine, and the Pinecrest hills to the west with the fire tower. The ranger station sits on a
// terrace above the river, where everyone starts.

export const MAP_HALF = 1024;
export const WORLD_SEED = 7331;

export const STATION = { x: -60, z: 430, name: 'Ashwood Ranger Station' };

// river centreline from source (north-west) to mouth (south-east); level falls along it
export const RIVER = {
  points: [[-1180, -720], [-1000, -640], [-780, -560], [-580, -390], [-430, -210], [-300, -50], [-150, 60], [30, 120], [200, 165], [330, 255], [430, 410], [560, 555], [720, 640], [880, 760], [1060, 870], [1200, 940]],
  levelStart: 104, levelEnd: 36,
  widthStart: 12, widthEnd: 24,           // channel width (m)
  depthStart: 1.4, depthEnd: 2.3,         // channel depth below the water (m)
  fords: [[-150, 60], [335, 262], [-905, -605]],   // shallow, wide, gravel crossings
};

export const LAKE = { x: -560, z: 610, r: 150, level: 52 };

// mountains: centre, peak height above the valley, radius
export const PEAKS = [
  { x: -200, z: -780, h: 360, r: 420, name: 'Corrie Summit' },
  { x: 250, z: -700, h: 270, r: 330, name: 'North Spire' },
  { x: -660, z: -860, h: 250, r: 360 },
  { x: 640, z: -900, h: 230, r: 380 },
  { x: 820, z: -320, h: 175, r: 300 },        // east ridge
  { x: 900, z: 80, h: 140, r: 280 },
  { x: -780, z: -40, h: 135, r: 300 },        // Pinecrest hills (fire tower)
  { x: -820, z: 330, h: 95, r: 260 },
  { x: 420, z: 900, h: 70, r: 300 },
  { x: -300, z: 960, h: 80, r: 260 },
];

export const BOG = { x: 185, z: 315, rx: 75, rz: 48, rot: 0.35 };
export const ROCK_GARDEN = { x: 565, z: -120, r: 75 };
export const SAND_WASH = { x: 440, z: 640, r: 70 };
// the drag strip across the wash (start, finish: 100 m): its floor is levelled, with a run-up and a run-off
export const SAND_STRIP = [[346, 641], [446, 652]];
export const SNOW_LINE = 300;

// trails: waypoint polylines (smoothed into curves); kind 'road' is the old gravel road
export const TRAILS = [
  { name: 'Old Valley Road', kind: 'road', width: 3.4, points: [[10, 890], [-30, 760], [-50, 600], [-60, 470], [-58, 430]] },
  // (above the Pinecrest fork it climbs the east spur, crosses to the west side and comes onto the summit plateau
  // from the north, switchbacking where it has to)
  { name: 'Summit Trail', kind: 'trail', width: 2.3, points: [
    [-60, 430], [-110, 330], [-150, 220], [-160, 120], [-150, 60], [-170, -10], [-184, -32], [-198, -54], [-212, -76],
    [-226, -98], [-240, -120], [-240, -130],
    [-240, -140], [-240, -150], [-239, -160], [-236, -169], [-232, -179], [-228, -188], [-223, -196], [-219, -205],
    [-214, -214], [-210, -223], [-205, -232], [-201, -241], [-196, -250], [-192, -259], [-187, -268], [-183, -277],
    [-179, -286], [-174, -295], [-170, -304], [-165, -313], [-161, -322], [-156, -331], [-152, -340], [-147, -348],
    [-141, -357], [-134, -364], [-126, -369], [-117, -374], [-108, -379], [-100, -384], [-92, -390], [-86, -398],
    [-88, -408], [-95, -415], [-104, -419], [-114, -419], [-124, -420], [-133, -425], [-141, -430], [-149, -436],
    [-157, -442], [-162, -451], [-164, -460], [-164, -470], [-166, -480], [-169, -490], [-173, -499], [-176, -508],
    [-178, -518], [-182, -527], [-187, -536], [-191, -545], [-196, -554], [-201, -563], [-207, -570], [-215, -577],
    [-223, -583], [-231, -588], [-240, -594], [-247, -600], [-254, -608], [-260, -615], [-268, -622], [-275, -628],
    [-283, -635], [-290, -642], [-298, -648], [-305, -655], [-313, -662], [-319, -670], [-324, -678], [-328, -687],
    [-333, -696], [-338, -704], [-345, -712], [-349, -721], [-349, -731], [-343, -739], [-335, -745], [-326, -750],
    [-317, -754], [-308, -759], [-299, -763], [-291, -768], [-282, -773], [-274, -779], [-270, -788], [-272, -798],
    [-276, -807], [-280, -816], [-283, -826], [-284, -836], [-284, -846], [-282, -855], [-278, -864], [-271, -872],
    [-264, -879], [-255, -884], [-246, -884], [-236, -881], [-227, -877], [-218, -872], [-209, -868], [-200, -863],
    [-191, -859], [-183, -854], [-174, -849], [-166, -843], [-162, -834], [-164, -824], [-168, -815], [-173, -806],
    [-179, -798], [-185, -790], [-192, -783], [-200, -775],
  ] },
  { name: 'Mirror Lake Trail', kind: 'trail', width: 2.2, points: [[-60, 430], [-180, 470], [-300, 515], [-380, 560], [-402, 622], [-422, 690], [-500, 792]] },
  { name: 'Bog Loop', kind: 'trail', width: 2.2, points: [[-58, 430], [40, 405], [120, 360], [170, 320], [215, 300], [265, 330], [320, 400], [250, 470], [140, 480], [30, 455], [-58, 430]] },
  // (past the rock garden it swings north and climbs to the mine in a long curve)
  { name: 'Rock Garden Trail', kind: 'trail', width: 2.2, points: [
    [265, 330], [335, 262], [395, 160], [470, 40], [530, -60], [565, -120], [580, -137], [595, -155], [610, -172],
    [625, -190], [625, -200], [625, -210], [625, -220], [625, -230], [625, -240], [625, -250], [625, -260],
    [625, -270], [625, -280], [625, -290], [625, -300], [623, -310], [624, -320], [627, -329], [632, -338],
    [637, -347], [643, -354], [652, -360], [661, -363], [671, -361], [680, -357], [689, -353], [698, -348],
    [707, -344], [716, -340], [725, -335], [734, -331], [743, -326], [751, -321], [758, -313], [762, -304],
    [765, -295], [765, -285], [765, -275], [770, -265],
  ] },
  { name: 'Pinecrest Trail', kind: 'trail', width: 2.1, points: [[-240, -120], [-400, -90], [-540, -60], [-650, -30], [-720, -40], [-760, -45]] },
  { name: 'Ridge Run', kind: 'trail', width: 2.1, points: [[770, -265], [760, -400], [690, -520], [580, -610], [480, -645], [360, -690], [255, -705], [120, -720], [-20, -740], [-120, -770], [-200, -775]] },
  { name: 'Sand Wash Spur', kind: 'trail', width: 2.2, points: [[320, 400], [380, 500], [430, 580], [445, 645]] },
  { name: 'Gorge Track', kind: 'trail', width: 2.0, points: [[-400, -90], [-520, -250], [-700, -450], [-850, -560], [-905, -605], [-960, -700], [-940, -860]] },
  { name: 'South Meadows', kind: 'trail', width: 2.1, points: [[-30, 760], [120, 790], [230, 815], [300, 838]] },
];

// survey beacons: the shared goal of a session (drive within BEACON_RADIUS of each)
export const BEACON_RADIUS = 9;
export const BEACONS = [
  { id: 0, name: 'Corrie Summit', x: -200, z: -778 },
  { id: 1, name: 'North Spire', x: 252, z: -706 },
  { id: 2, name: 'Pinecrest Fire Tower', x: -755, z: -52 },
  { id: 3, name: 'Alder Mine', x: 768, z: -275 },
  { id: 4, name: 'Rock Garden', x: 572, z: -112 },
  { id: 5, name: 'Cattail Bog', x: 196, z: 318 },
  { id: 6, name: 'Mirror Lake Shore', x: -428, z: 694 },
  { id: 7, name: 'Summit Ford', x: -142, z: 70 },
  { id: 8, name: 'East Ford', x: 347, z: 264 },
  { id: 9, name: 'Sand Wash', x: 447, z: 650 },
  { id: 10, name: 'Ridge Saddle', x: 482, z: -638 },
  { id: 11, name: 'Old Growth Pines', x: -610, z: 300 },
  { id: 12, name: 'South Meadows', x: 306, z: 842 },
  { id: 13, name: 'Snowfield', x: -430, z: -830 },
  { id: 14, name: 'Gorge Crossing', x: -905, z: -610 },
];

// buildings and props (rendered; their walls collide as rows of posts)
export const LANDMARKS = [
  { type: 'station', x: -40, z: 395, yaw: 0.25 },
  { type: 'garage', x: -95, z: 405, yaw: 0.25 },
  { type: 'flag', x: -62, z: 412, yaw: 0 },
  { type: 'firetower', x: -770, z: -58, yaw: 0.4 },
  { type: 'mine', x: 785, z: -282, yaw: -1.0 },
  { type: 'lookout', x: -212, z: -790, yaw: 0.2 },
  { type: 'mast', x: 262, z: -718, yaw: 0 },
  { type: 'cabin', x: -462, z: 468, yaw: 2.6 },
  { type: 'cabin', x: 330, z: 822, yaw: -0.6 },
];

export const SPAWN = { x: -58, z: 450, yaw: Math.atan2(-50, -100) };   // facing up the Summit Trail (north-north-west)
