// The Modes & races cards' pictures (game/ModePics.js): named by the event's own map, in the open world as on the map alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modePic } from '../src/game/ModePics.js';

test('a map played alone: its own pictures', () => {
  assert.equal(modePic('ashwood', 'free'), 'ashwood-free');
  assert.equal(modePic('ashwood', { id: 'bogcircuit' }), 'ashwood-bogcircuit');
  assert.equal(modePic('kerala', { id: 'elimination', mode: 'zone' }), 'kerala-elimination');
});

test('the open world: each event the picture of the map it is on; a party mode without the map\'s name after it', () => {
  assert.equal(modePic('world', 'free'), 'world-free');
  assert.equal(modePic('world', { id: 'bogcircuit', region: 'ashwood' }), 'ashwood-bogcircuit');
  assert.equal(modePic('world', { id: 'teaclimb', region: 'kerala' }), 'kerala-teaclimb');
  assert.equal(modePic('world', { id: 'elimination-kerala', region: 'kerala', mode: 'zone' }), 'kerala-elimination');
  assert.equal(modePic('world', { id: 'kingofhill-coast', region: 'coast', mode: 'hill' }), 'coast-kingofhill');
  // (a race across the maps is the world's own; an event whose name happens to end in its map's is left whole)
  assert.equal(modePic('world', { id: 'grandtour', region: null, world: true }), 'world-grandtour');
  assert.equal(modePic('world', { id: 'loop-coast', region: 'coast' }), 'coast-loop-coast');
});

test('the pictures there are: every one named for a map and an event, 600 by 250 or so of WebP', () => {
  const dir = new URL('../public/assets/ui/modes/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
  assert.ok(files.length >= 23);
  for (const f of files) {
    assert.match(f, /^[a-z]+-[a-z0-9-]+\.webp$/, f);
    const b = fs.readFileSync(new URL(f, dir));
    assert.equal(b.toString('latin1', 0, 4), 'RIFF', f);
    assert.equal(b.toString('latin1', 8, 12), 'WEBP', f);
    assert.ok(b.length > 2000 && b.length < 120000, `${f}: ${b.length} bytes`);
  }
});
