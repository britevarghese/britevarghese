// AI Zone: soldiers commanded by a large language model. The LLM is the squad leader in the soldier's head: every few
// seconds it gets a short battlefield report and answers with orders (tool calls). The ordinary bot brain carries the
// orders out moment to moment (pathing, aiming, firing, cover), so the model plans and the bot executes.
//
// Providers:
//   anthropic - Claude through the official Anthropic SDK (`@anthropic-ai/sdk`), base URL configurable
//   openai    - any OpenAI-compatible /chat/completions endpoint (OpenRouter, Groq, LM Studio, vLLM, ...)
// The API key lives only in this process's memory for the lifetime of the room; it is never logged, stored or sent to
// other players.
import Anthropic from '@anthropic-ai/sdk';
import { BotBrain } from './bots.js';
import { WEAPONS } from '../shared/weapons.js';
import { TEAM_NAMES } from '../shared/map.js';

const OFFICIAL_ANTHROPIC = /^https:\/\/api\.anthropic\.com\/?$/;
const REQUEST_TIMEOUT = 25000;
const MAX_TOKENS = 1024;

// ---------------------------------------------------------------- config validation (also used by the lobby API)
export function cleanAgentConfig(c = {}) {
  const provider = c.provider === 'openai' ? 'openai' : 'anthropic';
  const baseUrl = String(c.baseUrl || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).trim().replace(/\/+$/, '');
  const model = String(c.model || (provider === 'anthropic' ? 'claude-opus-5' : '')).trim().slice(0, 120);
  const apiKey = String(c.apiKey || '').trim().slice(0, 400);
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('Base URL is not a valid URL'); }
  // the game server makes these requests: keep it from being pointed at internal services unless the operator allows
  // it (AI_ALLOW_LOCAL=1, e.g. when you run the server on your own PC next to LM Studio / Ollama)
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?|169\.254\.)/.test(url.hostname);
  if (!process.env.AI_ALLOW_LOCAL && (url.protocol !== 'https:' || local)) throw new Error('Base URL must be a public https:// address (set AI_ALLOW_LOCAL=1 on your own server for local models)');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Base URL must be http(s)');
  if (!model) throw new Error('Model is required');
  if (!apiKey && !(process.env.AI_ALLOW_LOCAL && local)) throw new Error('API key is required');
  const name = String(c.name || 'Claude').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Agent';
  const side = c.side === 'enemy' ? 'enemy' : 'team';
  const interval = Math.max(3, Math.min(20, +c.interval || 5));
  return { provider, baseUrl, model, apiKey, name, side, interval };
}

// ---------------------------------------------------------------- tools (orders the model can give)
const TOOLS = [
  { name: 'go_to_flag', description: 'Move to a capture point (flag) and fight for it. Standing inside the flag radius captures it.', input_schema: { type: 'object', properties: { flag: { type: 'string', description: 'Flag letter, e.g. "A"' } }, required: ['flag'] } },
  { name: 'move_to', description: 'Move to a map position (metres). x grows east, z grows south.', input_schema: { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'z'] } },
  { name: 'follow_player', description: 'Stay close to a teammate and protect them (e.g. a human who asked for support).', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'attack', description: 'Hunt a specific enemy you know about: move toward them and engage.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'hold_position', description: 'Stop and defend the current spot (or a given point), watching a direction given as a map point.', input_schema: { type: 'object', properties: { look_x: { type: 'number' }, look_z: { type: 'number' } } } },
  { name: 'take_cover', description: 'Break line of sight with the nearest threat and reload / recover.', input_schema: { type: 'object', properties: {} } },
  { name: 'set_stance', description: 'Change stance for the next while.', input_schema: { type: 'object', properties: { stance: { type: 'string', enum: ['stand', 'crouch', 'prone'] } }, required: ['stance'] } },
  { name: 'say', description: 'Say something on the radio (all players read it). Short, in character, max ~20 words. Use it to answer players who talk to you.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
];

const SYSTEM = `You are an AI soldier playing STRIKEPOINT, a realistic multiplayer military shooter (Conquest mode), alongside and against humans and bots.
You receive a battlefield report every few seconds and answer ONLY by calling tools (usually one movement/combat order, optionally one "say").
Your body is controlled by an automatic combat system: it already aims and shoots at visible enemies, reloads, and walks your orders' routes. Your job is tactics:
- Win Conquest: capture and hold flags (stand inside the flag radius), bleed the enemy's tickets, don't die needlessly (each death costs a ticket).
- Prefer flags that are neutral, enemy-held, or contested; defend owned flags when enemies approach.
- If hurt (low hp) and under fire, take cover. Use prone/crouch for long-range fights.
- Teammates may talk to you in chat. If a teammate asks for something reasonable (follow me, cover me, go to B), do it and confirm briefly with "say". Stay in character as a professional soldier; no out-of-game talk.
- Keep the current order if it is still good - you don't have to change orders every report. Never invent flags or players that are not in the report.`;

// ---------------------------------------------------------------- brain: bot that follows orders
class AgentBrain extends BotBrain {
  constructor(game, p) { super(game, p); this.order = null; this.ctl = null; }

  pickGoal() {
    const o = this.order, g = this.g, p = this.p;
    if (!o || !this.ctl) return super.pickGoal();
    let tx, tz, flag;
    if (o.type === 'flag') { const f = g.flags.find((q) => q.id === o.flag); if (!f) { this.order = null; return super.pickGoal(); } const a = Math.random() * 6.28, r = Math.random() * f.r * 0.7; tx = f.x + Math.cos(a) * r; tz = f.z + Math.sin(a) * r; flag = f.id; }
    else if (o.type === 'move' || o.type === 'hold') { tx = o.x; tz = o.z; }
    else if (o.type === 'follow' || o.type === 'attack') {
      const q = g.players.get(o.id);
      if (!q || !q.alive) { this.order = null; return super.pickGoal(); }
      const off = o.type === 'follow' ? 3 : 0;
      tx = q.x + Math.cos(p.id) * off; tz = q.z + Math.sin(p.id) * off;
    } else return super.pickGoal();
    this.goal = { x: tx, z: tz, flag };
    this.path = g.nav.findPath(p.x, p.z, tx, tz);
    this.pathIdx = 1;
    this.repathAt = g.now() + (o.type === 'follow' || o.type === 'attack' ? 2000 : 12000);
  }

  think(dt) {
    const o = this.order, g = this.g, p = this.p, now = g.now();
    if (o) {
      if (o.until && now > o.until) { this.order = null; }
      else if (o.type === 'attack') {
        const q = g.players.get(o.id);
        if (q && q.alive && !this.visible) this.lastSeen = { x: q.x, y: q.y, z: q.z, t: now - 1000 };
        if (q && q.alive) this.target = this.target || q;
      } else if (o.type === 'cover' && this.mode !== 'cover') {
        const threat = this.target || this.lastSeen;
        const c = threat && this.findCover(threat);
        if (c) { this.mode = 'cover'; this.cover = c; this.coverStart = now; this.coverUntil = 0; }
        this.order = null;
      } else if (o.type === 'hold' && this.mode === 'hold' && o.look) this.watch = Math.atan2(-(o.look.x - p.x), -(o.look.z - p.z));
    }
    const input = super.think(dt);
    if (this.stanceOrder && now < this.stanceOrder.until && this.mode !== 'cover') p.stance = this.stanceOrder.stance;
    return input;
  }
}

// ---------------------------------------------------------------- controller: talks to the model
export class AgentController {
  constructor(game, cfg, log = () => {}) {
    this.g = game; this.cfg = cfg; this.log = log;
    this.busy = false; this.next = 0; this.backoff = 0; this.errors = 0;
    this.memory = [];      // short rolling log of what happened / what I did
    this.inbox = [];       // chat addressed to me
    this.client = cfg.provider === 'anthropic' ? new Anthropic({ apiKey: cfg.apiKey || 'none', baseURL: cfg.baseUrl, timeout: REQUEST_TIMEOUT, maxRetries: 1 }) : null;
    this.requests = 0; this.lastLatency = 0;
    this.spawnPlayer();
  }

  spawnPlayer() {
    const g = this.g, cfg = this.cfg;
    const human = [...g.players.values()].find((q) => !q.bot);
    const humanTeam = human?.team || 1;
    const team = cfg.side === 'enemy' ? (humanTeam === 1 ? 2 : 1) : humanTeam;
    const saved = g.BotBrainClass; g.BotBrainClass = AgentBrain;
    const p = g.addPlayer({ name: `[AI] ${cfg.name}`, bot: true, team, cls: 'assault' });
    g.BotBrainClass = saved;
    p.agent = true; p.brain.ctl = this;
    this.p = p;
    this.remember(`Deployed on ${TEAM_NAMES[team]} side.`);
  }

  remember(s) { this.memory.push(`[${Math.round(this.g.time)}s] ${s}`); if (this.memory.length > 10) this.memory.shift(); }

  onChat(from, msg) {
    if (from === this.p || from?.agent) return;
    const mine = new RegExp(`\\b${this.cfg.name}\\b|@ai|\\bai\\b`, 'i').test(msg) || from?.team === this.p.team;
    if (!mine) return;
    this.inbox.push(`${from ? from.name : 'SERVER'}: ${msg}`); if (this.inbox.length > 5) this.inbox.shift();
    // answer soon
    this.next = Math.min(this.next, this.g.now() + 800);
  }

  onEvent(ev) {
    const me = this.p.id;
    if (ev.t === 'kill') {
      const k = this.g.players.get(ev.k), v = this.g.players.get(ev.v);
      if (ev.v === me) this.remember(`I was killed by ${k ? k.name : 'unknown'} (${ev.w}).`);
      else if (ev.k === me && v) this.remember(`I killed ${v.name}.`);
    } else if (ev.t === 'hurt' && ev.v === me && !this.hurtNoted) {
      const a = this.g.players.get(ev.a);
      this.remember(`Taking fire${a ? ` from ${a.name}` : ''} (-${ev.d} hp).`); this.hurtNoted = true;
      this.next = Math.min(this.next, this.g.now() + 1500);
      setTimeout(() => (this.hurtNoted = false), 4000);
    } else if (ev.t === 'flag') this.remember(`Flag ${ev.id} is now ${ev.owner ? TEAM_NAMES[ev.owner] : 'neutral'}.`);
  }

  tick() {
    const now = this.g.now();
    if (this.busy || now < this.next || !this.p) return;
    this.busy = true;
    this.decide().catch(() => {}).finally(() => { this.busy = false; });
  }

  // ---------------------------------------------------------------- observation
  report() {
    const g = this.g, p = this.p, now = g.now();
    const w = p.weapons[p.slot], def = w && WEAPONS[w.id];
    const dist = (q) => Math.round(Math.hypot(q.x - p.x, q.z - p.z));
    const bearing = (q) => { const a = Math.atan2(q.x - p.x, -(q.z - p.z)) * 57.3; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((a + 360) % 360) / 45) % 8]; };
    const lines = [];
    lines.push(`Map: ${g.map.name} (${g.map.PLAY_HALF * 2} m square, x/z from ${-g.map.PLAY_HALF} to ${g.map.PLAY_HALF}). Tickets: ${TEAM_NAMES[p.team]} ${g.tickets[p.team]} vs ${TEAM_NAMES[p.team === 1 ? 2 : 1]} ${g.tickets[p.team === 1 ? 2 : 1]}.`);
    if (!p.alive) lines.push('You are dead, waiting to redeploy.');
    else lines.push(`You: ${p.name}, hp ${Math.round(p.hp)}, at (${Math.round(p.x)}, ${Math.round(p.z)}), ${p.stance}, weapon ${def ? `${def.name} ${w.mag}/${w.reserve}` : 'none'}, grenades ${p.grenades}. Current order: ${this.describeOrder()}. Behaviour: ${p.brain.mode}.`);
    lines.push('Flags: ' + g.flags.map((f) => `${f.id} ${f.owner === p.team ? 'OURS' : f.owner ? 'ENEMY' : 'neutral'}${f.contested ? ' (contested)' : ''} at (${Math.round(f.x)}, ${Math.round(f.z)}) ${dist(f)} m ${bearing(f)}`).join('; '));
    const mates = [...g.players.values()].filter((q) => q !== p && q.alive && q.team === p.team).sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    lines.push('Teammates: ' + (mates.map((q) => `${q.name}${q.bot ? '' : ' (human)'} hp ${Math.round(q.hp)} ${dist(q)} m ${bearing(q)}`).join('; ') || 'none alive'));
    // enemies the soldier (or its team) can see right now
    const known = [...g.players.values()].filter((q) => q.alive && q.team !== p.team && [...g.players.values()].some((m) => m.alive && m.team === p.team && Math.hypot(m.x - q.x, m.z - q.z) < 120 && g.world.lineOfSight({ x: m.x, y: m.y + 1.6, z: m.z }, { x: q.x, y: q.y + 1.3, z: q.z })));
    lines.push('Spotted enemies: ' + (known.sort((a, b) => dist(a) - dist(b)).slice(0, 6).map((q) => `${q.name} ${dist(q)} m ${bearing(q)}${p.brain.target === q ? ' (engaging)' : ''}`).join('; ') || 'none'));
    if (this.memory.length) lines.push('Recent events:\n' + this.memory.slice(-6).join('\n'));
    if (this.inbox.length) lines.push('Radio messages to you (answer them):\n' + this.inbox.join('\n'));
    lines.push(`Time in round: ${Math.round((now - (g.roundStart || now)) / 1000)} s. Decide your orders now.`);
    this.inbox = [];
    return lines.join('\n');
  }

  describeOrder() {
    const o = this.p.brain.order;
    if (!o) return 'none (automatic objective play)';
    if (o.type === 'flag') return `go to flag ${o.flag}`;
    if (o.type === 'follow' || o.type === 'attack') return `${o.type} ${this.g.players.get(o.id)?.name || '?'}`;
    if (o.type === 'move' || o.type === 'hold') return `${o.type} at (${Math.round(o.x)}, ${Math.round(o.z)})`;
    return o.type;
  }

  // ---------------------------------------------------------------- one decision = one model request
  async decide() {
    const cfg = this.cfg, g = this.g;
    const text = this.report();
    const t0 = Date.now();
    let calls;
    try {
      calls = cfg.provider === 'anthropic' ? await this.askClaude(text) : await this.askOpenAI(text);
      this.errors = 0; this.backoff = 0;
      this.lastLatency = Date.now() - t0; this.requests++;
    } catch (e) {
      this.errors++;
      this.backoff = Math.min(60000, 5000 * 2 ** Math.min(4, this.errors - 1));
      this.next = g.now() + this.backoff;
      const why = e instanceof Anthropic.AuthenticationError ? 'invalid API key' : e instanceof Anthropic.RateLimitError ? 'rate limited' : e instanceof Anthropic.NotFoundError ? 'model not found' : e instanceof Anthropic.APIError ? `API error ${e.status ?? ''}`.trim() : e.message?.slice(0, 80) || 'error';
      if (this.errors === 1 || this.errors % 5 === 0) g.emit({ t: 'chat', from: 'SERVER', msg: `AI link (${cfg.name}): ${why} — retrying in ${Math.round(this.backoff / 1000)} s` });
      this.log(`[agent ${cfg.name}] request failed: ${why}`);
      return;
    }
    this.next = g.now() + cfg.interval * 1000;
    for (const c of calls) this.apply(c.name, c.input || {});
  }

  async askClaude(text) {
    const cfg = this.cfg;
    const params = {
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      // stable prefix (tools + system) is cached across the many small decisions
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: [{ role: 'user', content: text }],
    };
    // real-time game: keep deliberation short on models that take an effort setting
    if (/claude-(opus|fable|mythos|sonnet-5|sonnet-4-6)/.test(cfg.model)) params.output_config = { effort: 'low' };
    let res;
    if (OFFICIAL_ANTHROPIC.test(cfg.baseUrl) && /claude-(opus-5|fable-5-1)$/.test(cfg.model)) {
      // server-side refusal fallback on the first-party API
      res = await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else res = await this.client.messages.create(params);
    if (res.stop_reason === 'refusal') return [];
    return res.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input }));
  }

  async askOpenAI(text) {
    const cfg = this.cfg;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT);
    try {
      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model, max_tokens: MAX_TOKENS, tool_choice: 'auto',
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
          tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        }),
      });
      if (!r.ok) throw new Error(r.status === 401 ? 'invalid API key' : r.status === 404 ? 'model or URL not found' : r.status === 429 ? 'rate limited' : `HTTP ${r.status}`);
      const j = await r.json();
      const msg = j.choices?.[0]?.message;
      const calls = (msg?.tool_calls || []).map((c) => { let input = {}; try { input = JSON.parse(c.function?.arguments || '{}'); } catch {} return { name: c.function?.name, input }; });
      // models without tool support: treat the text as a radio message
      if (!calls.length && msg?.content) calls.push({ name: 'say', input: { message: String(msg.content) } });
      return calls;
    } finally { clearTimeout(to); }
  }

  // ---------------------------------------------------------------- execute an order
  apply(name, a) {
    const g = this.g, p = this.p, b = p.brain, now = g.now();
    const byName = (n) => { const s = String(n || '').toLowerCase().replace(/^\[(ai|bot)\]\s*/, ''); return [...g.players.values()].find((q) => q.name.toLowerCase().replace(/^\[(ai|bot)\]\s*/, '') === s) || [...g.players.values()].find((q) => q.name.toLowerCase().includes(s) && s.length > 2); };
    const H = g.map.PLAY_HALF;
    const num = (v) => Math.max(-H, Math.min(H, Number(v) || 0));
    switch (name) {
      case 'go_to_flag': { const f = g.flags.find((q) => q.id === String(a.flag || '').toUpperCase().replace(/^FLAG\s*/, '')); if (f) { b.order = { type: 'flag', flag: f.id }; b.pickGoal(); this.remember(`Order: go to flag ${f.id}.`); } break; }
      case 'move_to': b.order = { type: 'move', x: num(a.x), z: num(a.z), until: now + 45000 }; b.pickGoal(); this.remember(`Order: move to (${Math.round(num(a.x))}, ${Math.round(num(a.z))}).`); break;
      case 'follow_player': { const q = byName(a.name); if (q && q.team === p.team && q !== p) { b.order = { type: 'follow', id: q.id, until: now + 120000 }; b.pickGoal(); this.remember(`Order: follow ${q.name}.`); } break; }
      case 'attack': { const q = byName(a.name); if (q && q.team !== p.team && q.alive) { b.order = { type: 'attack', id: q.id, until: now + 30000 }; b.pickGoal(); this.remember(`Order: attack ${q.name}.`); } break; }
      case 'hold_position': b.order = { type: 'hold', x: p.x, z: p.z, look: a.look_x !== undefined ? { x: num(a.look_x), z: num(a.look_z) } : null, until: now + 60000 }; b.path = null; this.remember('Order: hold position.'); break;
      case 'take_cover': b.order = { type: 'cover' }; this.remember('Order: take cover.'); break;
      case 'set_stance': if (['stand', 'crouch', 'prone'].includes(a.stance)) b.stanceOrder = { stance: a.stance, until: now + 20000 }; break;
      case 'say': {
        const msg = String(a.message || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 140);
        if (msg && now > (this.lastSay || 0) + 2500) { this.lastSay = now; g.emit({ t: 'chat', from: p.name, tm: p.team, msg }); this.remember(`I said: "${msg}"`); }
        break;
      }
    }
  }
}

// quick connectivity check for the lobby's TEST button: one tiny request, returns { ok, ms, model } or throws
export async function testAgentConfig(raw) {
  const cfg = cleanAgentConfig(raw);
  const t0 = Date.now();
  if (cfg.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: cfg.apiKey || 'none', baseURL: cfg.baseUrl, timeout: 20000, maxRetries: 0 });
    try {
      const params = { model: cfg.model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] };
      if (/claude-(opus|fable|mythos|sonnet-5|sonnet-4-6)/.test(cfg.model)) params.output_config = { effort: 'low' };
      const res = await client.messages.create(params);
      return { ok: true, ms: Date.now() - t0, model: res.model };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Invalid API key');
      if (e instanceof Anthropic.NotFoundError) throw new Error('Model not found at this base URL');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited — try again shortly');
      if (e instanceof Anthropic.APIError) throw new Error(`API error ${e.status ?? ''}: ${String(e.message).slice(0, 120)}`);
      throw new Error(`Cannot reach ${cfg.baseUrl}`);
    }
  }
  const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
  }).catch(() => { throw new Error(`Cannot reach ${cfg.baseUrl}`); });
  if (!r.ok) throw new Error(r.status === 401 ? 'Invalid API key' : r.status === 404 ? 'Model or URL not found' : `HTTP ${r.status}`);
  const j = await r.json();
  return { ok: true, ms: Date.now() - t0, model: j.model || cfg.model };
}
