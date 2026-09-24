import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.AI_ALLOW_LOCAL = '1';
const { Game } = await import('../server/game.js');
const { AgentController, cleanAgentConfig, testAgentConfig } = await import('../server/agent.js');

// fake model server: records requests, answers with scripted tool calls in either wire format
function fakeModel(replies) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      seen.push({ url: req.url, auth: req.headers['x-api-key'] || req.headers.authorization, body: j });
      const calls = replies.shift() || [];
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/chat/completions')) {
        res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } }] }));
      } else {
        res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: j.model, stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: calls.length ? calls.map((c, i) => ({ type: 'tool_use', id: `tu_${i}`, name: c.name, input: c.input })) : [{ type: 'text', text: 'ready' }] }));
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 20)); } return true; };

test('agent config validation keeps keys server-side and rejects internal URLs without opt-in', () => {
  const c = cleanAgentConfig({ provider: 'anthropic', apiKey: 'sk-test', name: 'Viper<x>' });
  assert.equal(c.baseUrl, 'https://api.anthropic.com'); assert.equal(c.model, 'claude-opus-5'); assert.equal(c.name, 'Viperx');
  const saved = process.env.AI_ALLOW_LOCAL; delete process.env.AI_ALLOW_LOCAL;
  assert.throws(() => cleanAgentConfig({ provider: 'openai', baseUrl: 'http://10.0.0.5:8080/v1', model: 'm', apiKey: 'k' }), /public https/);
  assert.throws(() => cleanAgentConfig({ provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm' }), /API key/);
  process.env.AI_ALLOW_LOCAL = saved;
});

test('Claude agent (Anthropic SDK): reads the battlefield report and its orders drive the soldier', async () => {
  const fm = await fakeModel([
    [{ name: 'go_to_flag', input: { flag: 'B' } }, { name: 'say', input: { message: 'Moving to Bravo.' } }],
    [{ name: 'follow_player', input: { name: 'Alpha' } }, { name: 'say', input: { message: 'On you, Alpha.' } }],
  ]);
  const g = new Game({ botsPerTeam: 1, log: () => {} });
  const human = g.addPlayer({ name: 'Alpha', team: 1 });
  human.respawnAt = 0; g.spawn(human, 'base');
  const ctl = new AgentController(g, cleanAgentConfig({ provider: 'anthropic', baseUrl: fm.url, model: 'claude-opus-5', apiKey: 'sk-test', name: 'Viper', interval: 3 }));
  g.agents.push(ctl);
  assert.equal(ctl.p.name, '[AI] Viper');
  for (let i = 0; i < 90; i++) g.tick(1 / 30);
  assert.ok(await waitFor(() => fm.seen.length >= 1), 'model was asked');
  const req = fm.seen[0];
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.auth, 'sk-test');
  assert.equal(req.body.model, 'claude-opus-5');
  assert.ok(req.body.tools.some((t) => t.name === 'go_to_flag'));
  assert.match(req.body.messages[0].content, /Flags: A .*B .*C/);
  await waitFor(() => ctl.p.brain.order?.type === 'flag');
  assert.deepEqual(ctl.p.brain.order, { type: 'flag', flag: 'B' });
  const chats = []; for (const { ev } of g.flushEvents()) if (ev.t === 'chat') chats.push(ev);
  assert.ok(chats.some((c) => c.from === '[AI] Viper' && c.msg === 'Moving to Bravo.'));
  // a human talks to it on the radio -> answered quickly with a follow order
  ctl.onChat(human, 'Viper, follow me!');
  for (let i = 0; i < 60 && fm.seen.length < 2; i++) { g.tick(1 / 30); await new Promise((r) => setTimeout(r, 30)); }
  assert.ok(fm.seen.length >= 2, 'answered the radio call');
  assert.match(fm.seen[1].body.messages[0].content, /Alpha: Viper, follow me!/);
  await waitFor(() => ctl.p.brain.order?.type === 'follow');
  assert.equal(ctl.p.brain.order.id, human.id);
  fm.server.close();
});

test('OpenAI-compatible provider works through the same orders', async () => {
  const fm = await fakeModel([[{ name: 'hold_position', input: {} }]]);
  const g = new Game({ botsPerTeam: 0, log: () => {} });
  const ctl = new AgentController(g, cleanAgentConfig({ provider: 'openai', baseUrl: `${fm.url}/v1`, model: 'local-model', apiKey: 'k', name: 'Echo' }));
  g.agents.push(ctl);
  ctl.p.respawnAt = 0; g.spawn(ctl.p, 'base');
  g.tick(1 / 30);
  assert.ok(await waitFor(() => ctl.p.brain.order?.type === 'hold'));
  assert.equal(fm.seen[0].url, '/v1/chat/completions');
  assert.equal(fm.seen[0].auth, 'Bearer k');
  assert.equal(fm.seen[0].body.tools[0].type, 'function');
  const r = await testAgentConfig({ provider: 'openai', baseUrl: `${fm.url}/v1`, model: 'local-model', apiKey: 'k' });
  assert.ok(r.ok);
  fm.server.close();
});

test('model errors back off and are reported without leaking the key', async () => {
  const g = new Game({ botsPerTeam: 0, log: () => {} });
  const ctl = new AgentController(g, cleanAgentConfig({ provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'secret-key-123', name: 'Down' }));
  g.agents.push(ctl);
  g.tick(1 / 30);
  assert.ok(await waitFor(() => ctl.errors >= 1));
  const chat = g.flushEvents().map((e) => e.ev).filter((e) => e.t === 'chat').map((e) => e.msg).join(' ');
  assert.match(chat, /AI link \(Down\)/);
  assert.ok(!chat.includes('secret-key-123'));
  assert.ok(ctl.next > g.now() + 3000, 'backs off');
});
