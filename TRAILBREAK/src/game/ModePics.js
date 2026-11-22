// The Modes & races cards' pictures (public/assets/ui/modes/<map>-<event>.webp: a truck at the event's start, taken in
// the game by tools/modepics.cjs).
//
// A picture is named by the map its event is on. In the open world every map's events are on the list (world/OpenWorld.js
// eventsOf: each with the map it belongs to, and the party modes named for it, 'elimination-kerala'), so a card there
// takes the picture of its event's own map: the same one that map's card has when it is played alone. The cards used
// to ask for '<the open world>-<event>', which no picture was ever called, and the open world's list had none.

/**
 * The name (no folder, no extension) of the picture for a card: e, the event ({ id, region: its map in the open world,
 * mode: a party mode }), or 'free' for free roam; mapId, the map being played.
 */
export function modePic(mapId, e) {
  if (e === 'free') return `${mapId}-free`;
  const map = e.region || mapId;
  // (a party mode in the open world carries its map's name after its own: 'kingofhill-coast')
  const id = e.mode && e.region && e.id.endsWith(`-${e.region}`) ? e.id.slice(0, -e.region.length - 1) : e.id;
  return `${map}-${id}`;
}
