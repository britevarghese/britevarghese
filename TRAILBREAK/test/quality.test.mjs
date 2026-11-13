// The graphics level a session starts at (game/Quality.js): by the graphics card the first time, then where the last
// session settled; the player's own pick always.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessLevel, startLevel, rememberLevel, HOLD_SESSIONS } from '../src/game/Quality.js';

test('the first start, by the graphics card: cards made for games high, integrated graphics medium, software low', () => {
  const high = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  ];
  const medium = [
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GT 710 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce 940MX Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Some card nobody has heard of', '',
  ];
  const low = [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ];
  for (const g of high) assert.equal(guessLevel(g), 'high', g);
  for (const g of medium) assert.equal(guessLevel(g), 'medium', g);
  for (const g of low) assert.equal(guessLevel(g), 'low', g);
  // (a phone or tablet: medium whatever its chip is called, software still low)
  assert.equal(guessLevel('Apple GPU', true), 'medium');
  assert.equal(guessLevel('Adreno (TM) 740', true), 'medium');
  assert.equal(guessLevel(low[0], true), 'low');
});

test('where a session starts: the first by the card, then where the last one settled; never above the chosen level', () => {
  const uhd = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', rtx = 'NVIDIA GeForce RTX 4070';
  // the first time
  assert.equal(startLevel({ quality: 'high' }, uhd), 'medium');
  assert.equal(startLevel({ quality: 'high' }, rtx), null, 'the chosen level itself');
  assert.equal(startLevel({ quality: 'medium' }, uhd), null, 'no lower than the guess: the chosen level');
  assert.equal(startLevel({ quality: 'low' }, uhd), null);
  // the player picked a level themselves: always that
  assert.equal(startLevel({ quality: 'high', autoQuality: false }, uhd), null);
  assert.equal(startLevel({ quality: 'high', autoQuality: false, autoStart: 'low' }, uhd), null);
  // after a session: where it settled, whatever the card's name says
  assert.equal(startLevel({ quality: 'high', autoStart: 'low' }, rtx), 'low');
  assert.equal(startLevel({ quality: 'high', autoStart: '' }, uhd), null, 'it held the chosen level last time');
  assert.equal(startLevel({ quality: 'medium', autoStart: 'medium' }, uhd), null);
});

test('what is kept for the next session: the level the game settled at, and a rest from stepping up after one that failed', () => {
  const s = { quality: 'high' };
  rememberLevel(s, 'medium');
  assert.equal(s.autoStart, 'medium');
  assert.equal(s.autoHold, undefined);
  rememberLevel(s, 'high');
  assert.equal(s.autoStart, '', 'back at the chosen level: nothing to start lower for');
  rememberLevel(s, 'medium', true);
  assert.equal(s.autoStart, 'medium');
  assert.equal(s.autoHold, HOLD_SESSIONS);
  assert.equal(s.quality, 'high', "the player's choice is never changed");
});
