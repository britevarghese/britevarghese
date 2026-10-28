// Events in the game: the start lines, a run's countdown, clock and gates, medals and prize money, and races with
// friends. Alone (or alone in the room), J at a start line lines the truck up and counts it down. With friends in the
// room, J opens a race instead: the server gives it a start time a little ahead (RACE_LEAD), friends press J to join
// and are lined up beside you, everyone's clock starts together, and the server collects the times (server/rooms.js).
import { eventsFor, EventRun, medalFor, clock, runPrize, standings, gridFor, timeLimit, COUNTDOWN, touchPenalty } from './Events.js';
import { racesFor } from './Races.js';
import { modesFor, ZoneRun, HillRun, HOLD } from './Modes.js';
import { customRace } from './Props.js';
import { money } from './Career.js';
import { escapeHtml } from '../ui/HUD.js';

const NEAR = 14;                   // m from a start line to start there with J
const $ = (id) => document.getElementById(id);
const MEDAL_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const fmt = (t) => (t < 60 ? `${t.toFixed(1)} s` : clock(t));
/** What sort of event it is, for the lists and the map. */
export const kindOf = (e) => (e.kind === 'circuit' ? `Circuit · ${e.laps} laps` : e.kind === 'rally' ? `Rally · ${(e.length / 1000).toFixed(1)} km` : e.kind === 'slalom' ? 'Trials'
  : e.kind === 'trail' ? 'Hill climb' : e.kind === 'zone' ? 'Party mode · last truck in' : e.kind === 'hill' ? 'Party mode · hold the hill' : 'Dash');

export class EventPlay {
  constructor(game) {
    this.g = game;
    // the map's events, its checkpoint races (game/Races.js) and its party modes (game/Modes.js)
    // (the open world's: every map's, world/OpenWorld.js)
    this.events = game.world.events ? game.world.events() : [...eventsFor(game.world), ...racesFor(game.world), ...modesFor(game.world)];
    this.picked = null;            // the one last picked in the list or on the map: J starts it where starts are close
    this.byId = new Map(this.events.map((e) => [e.id, e]));
    this.grids = new Map(this.events.map((e) => [e.id, gridFor(game.world, e)]));
    this.simT = 0;
    this.run = null;               // our EventRun
    this.race = null;              // the room's race: { id, at (server ms), racers: [{ id, name }], times: Map(id -> s | null) }
    this.hold = false;             // lined up: the truck stays on its brakes
    this.giveUpT = 0;
    this.resultT = 0;
    this.lastCount = null;
    this.promptT = 0;
    this.panel = { el: $('ev-panel'), name: $('ev-name'), time: $('ev-time'), info: $('ev-info'), count: $('ev-count'), result: $('ev-result'),
      cp: $('ev-cpn'), lap: $('ev-lap'), lapBox: $('ev-lapbox'), lapLbl: $('ev-laplbl'), timeLbl: $('ev-timelbl'), best: $('ev-best'), restart: $('ev-restart'), leave: $('ev-leave') };
    const tap = (el, fn) => el?.addEventListener('click', (e) => { e.preventDefault(); e.currentTarget.blur(); fn(); this.g.renderer.renderer.domElement.focus(); });
    tap(this.panel.restart, () => this.restart());
    tap(this.panel.leave, () => this.leave());
    this.panel.result?.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this.closeResult(); else if (e.target.closest('[data-again]')) this.again(); });
  }

  /** The clock events run on: the game's own (simulated) time, so a slow frame doesn't add to a run's time. */
  get now() { return this.simT; }
  serverNow() { return Date.now() + (this.g.net?.offset ?? 0); }
  /** A server clock time (ms) on our clock (s). */
  toLocal(atMs) { return this.now + (atMs - this.serverNow()) / 1000; }
  get racing() { return !!this.run && (this.run.phase === 'countdown' || this.run.phase === 'running'); }
  get inRace() { return !!this.race && this.race.racers.some((r) => r.id === this.g.net?.id); }
  /** Is J worth showing (touch screens): at a start line, in a run, or with a race to join or a result up. */
  get canPress() {
    return this.racing || (!!this.race && !this.inRace) || !!this.startHere() || !this.panel.result?.classList.contains('hidden');
  }

  friendsHere() { return !!this.g.net?.connected && [...this.g.remotes.values()].some((r) => r.state); }

  /** The event whose start line we are at (the one last picked, else the nearest), or null. */
  startHere() {
    const p = this.g.vehicle.pos, d = (e) => Math.hypot(p.x - e.start.x, p.z - e.start.z);
    if (this.picked && d(this.picked) < NEAR) return this.picked;
    let best = null;
    for (const e of this.events) if (d(e) < NEAR && (!best || d(e) < d(best))) best = e;
    return best;
  }

  // ---------------------------------------------------------------- J
  press() {
    const g = this.g;
    if (this.racing) {
      if (this.giveUpT > 0) { this.giveUp('You gave up the run'); return; }
      this.giveUpT = 3;
      g.hud.hint('Press J again to give up the run', 3);
      return;
    }
    if (this.panel.result && !this.panel.result.classList.contains('hidden') && this.lastEvent) { this.again(); return; }
    if (this.race && !this.inRace) {
      if (this.serverNow() < this.race.at) { g.net.send({ t: 'ev', k: 'join' }); g.hud.hint('Joining the race...', 2); }
      else g.hud.hint(`The ${this.byId.get(this.race.id)?.name || 'race'} is under way: wait for it to finish`, 3);
      return;
    }
    const e = this.startHere();
    if (!e) { g.hud.hint('No start line here: event starts are the flags on the map (M), or pick one in the Events list (Esc)', 4); return; }
    this.begin(e);
  }

  /** Start an event: alone, a countdown at once; with friends in the room, open a race for them to join. */
  begin(e) {
    const g = this.g;
    if (this.racing) return;
    this.closeResult();
    if (this.friendsHere()) {
      if (this.race) { g.hud.hint('A race is already on in this room', 3); return; }
      g.net.send({ t: 'ev', k: 'open', id: e.id });
      g.hud.hint('Opening the race...', 2);
      return;
    }
    this.lineUp(e, 0);
    this.startRun(e, this.now + COUNTDOWN + 0.6);
  }

  /** From the Events list: go to an event's start line (the marshals' trailer brings you), and start it. */
  goTo(id) {
    const e = this.byId.get(id);
    if (!e || this.racing) return;
    this.picked = e;
    this.lineUp(e, 0);
    this.hold = false;
    this.g.hud.toast(`${e.name}: J to start${this.friendsHere() ? ' a race (friends can join)' : ''}`, false, 5);
  }

  again() {
    const e = this.lastEvent;
    this.closeResult();
    if (e && !this.racing) this.begin(e);
  }

  /** Put the truck on grid slot `slot` of an event, stopped and facing down the course. */
  lineUp(e, slot) {
    const g = this.g, v = g.vehicle, p = this.grids.get(e.id)[slot % 4];
    if (v.winch.attached) v.detachWinch();
    v.place(g.world, p.x, p.z, p.yaw);
    g.carry = 0;
    if (g.net) g.net.warp++;
    if (g.helpOn) g.setHelp(false);
    g.stuckT = 0; g.boggedT = 0;
    g.drySpots = [{ x: p.x, z: p.z, yaw: p.yaw }];
    g.cam.heading = null;
    this.hold = true;
  }

  /** seed: a match's start (server ms) when racing friends, so everyone works out the same zones. */
  startRun(e, startAt, seed = Date.now()) {
    this.g.hud.clearHint?.();
    this.run = e.kind === 'zone' ? new ZoneRun(e, startAt, this.g.world.data.trails, seed) : e.kind === 'hill' ? new HillRun(e, startAt) : new EventRun(e, startAt);
    this.lastEvent = e;
    this.hold = true;
    this.lastCount = null;
    this.giveUpT = 0;
    this.g.course?.setActive(e, 0);
  }

  /** The map builder's race (a layout with a start line and checkpoints), or none: in the list as 'custom'. */
  /** More events (the open world's, as a map comes in). */
  add(list) {
    for (const e of list) {
      if (this.byId.has(e.id)) continue;
      this.events.push(e); this.byId.set(e.id, e); this.grids.set(e.id, gridFor(this.g.world, e));
    }
  }

  setCustom(L) {
    const old = this.byId.get('custom');
    if (old) { this.events.splice(this.events.indexOf(old), 1); this.byId.delete('custom'); this.grids.delete('custom'); }
    const e = L && customRace(L, (x, z) => this.g.world.height(x, z));
    if (!e) return;
    this.events.push(e); this.byId.set('custom', e); this.grids.set('custom', gridFor(this.g.world, e));
  }

  /** RESTART (Backspace): line up at the start again and count down afresh (alone; not in a race with friends). */
  restart() {
    const run = this.run;
    if (!run || this.inRace) return false;
    const e = run.event;
    run.phase = 'out';
    this.run = null;
    this.lineUp(e, 0);
    this.startRun(e, this.now + COUNTDOWN + 0.6);
    this.g.hud.hint('Restarted', 1.2);
    return true;
  }

  /** LEAVE: out of the run (or the race) at once. */
  leave() { if (this.run) this.giveUp(this.inRace ? 'You left the race' : 'You left the run'); }

  /** R in a run: back to the last checkpoint passed (or the start), facing the next one. The clock keeps running. */
  resetToCheckpoint() {
    const run = this.run, g = this.g, v = g.vehicle;
    if (!run || run.phase !== 'running') return false;
    const e = run.event, last = run.gate > 0 ? e.gates[run.gate - 1] : null, next = e.gates[run.gate];
    const at = last || e.start;
    let yaw = last?.dir ? Math.atan2(last.dir[0], last.dir[1]) : e.start.yaw;
    if (!last?.dir && last && next) yaw = Math.atan2(next.x - last.x, next.z - last.z);
    if (v.winch.attached) v.detachWinch();
    v.place(g.world, at.x, at.z, yaw);
    g.carry = 0; g.stuckT = 0; g.boggedT = 0;
    if (g.net) g.net.warp++;
    g.cam.heading = null;
    g.hud.hint(last ? 'Back at the last checkpoint' : 'Back at the start', 1.5);
    return true;
  }

  giveUp(why) {
    if (!this.run) return;
    this.run.phase = 'out';
    this.hold = false;
    if (this.inRace) this.g.net.send({ t: 'ev', k: 'done', time: null });
    this.g.hud.toast(why, false, 4);
    this.g.course?.setActive(null);
    this.run = null;
  }

  // ---------------------------------------------------------------- each frame
  /** Before the physics: lined up, the truck stays on its brakes. */
  control(c) {
    // (on the handbrake, not the pedal: an automatic held on the brake at a stop selects reverse)
    if (this.hold) { c.throttle = 0; c.brake = 0; c.handbrake = 1; }
  }

  /** After the physics: the clock, the gates, the panel. */
  update(dt) {
    this.simT += dt;
    const g = this.g, run = this.run, v = g.vehicle;
    const knock = v.hullPeak, strike = v.knockPeak;
    v.hullPeak = 0; v.knockPeak = 0;
    this.giveUpT = Math.max(0, this.giveUpT - dt);
    if (this.resultT > 0 && (this.resultT -= dt) <= 0) this.closeResult();
    if (run) {
      const r = run.update(this.now, v.pos, knock, run instanceof HillRun ? this.othersAt() : strike);
      if (run.phase === 'countdown') {
        const left = run.countdown(this.now);
        const n = Math.ceil(left);
        if (n <= COUNTDOWN && n !== this.lastCount) { this.lastCount = n; g.audio.beep?.(660, 0.18); }
      } else if (this.hold) {
        this.hold = false;
        this.goT = 0.9;
        g.audio.beep?.(1320, 0.45);
      }
      if (r === 'gate') { g.audio.beep?.(990, 0.1, 0.08); g.course?.setActive(run.event, run.gate); }
      else if (r === 'touch') { g.hud.hint(`${run.event.touch === 'hard' ? 'Hard knock' : 'Touched'}: +${touchPenalty(run.event)} s`, 1.5); g.audio.bang?.(0.4, false); }
      else if (r === 'finish') this.finished();
      else if (r === 'timeout') this.giveUp(`Out of time: ${run.event.name} has a ${Math.round(timeLimit(run.event) / 60)} minute limit`);
    }
    this.goT = Math.max(0, (this.goT || 0) - dt);
    this.drawPanel();
    // at a start line: say what it is (not over a result: the hint showed through its panel)
    this.promptT -= dt;
    if (!this.run && this.resultT <= 0 && this.promptT <= 0 && Math.abs(g.vehicle.speed) < 3) {
      const e = this.startHere();
      if (e && e !== this.prompted) {
        const best = g.career?.best(e.id);
        g.hud.hint(`${e.name}: J to ${this.friendsHere() ? 'open a race' : 'start'} · gold ${fmt(e.par.gold)}${best ? ` · your best ${fmt(best.time)}` : ''}`, 5);
        this.promptT = 6;
      }
      this.prompted = e;
    }
    // the map and compass: the start lines, and the next gate
    g.hud.eventMarks = {
      starts: this.events.map((e) => ({ x: e.start.x, z: e.start.z, name: e.name })),
      next: run && run.phase !== 'finished' && run.event.gates[run.gate] ? run.event.gates[run.gate] : null,
    };
  }

  drawPanel() {
    const P = this.panel, run = this.run;
    if (!P.el) return;
    const raceWait = this.race && this.inRace && !run;
    P.el.classList.toggle('hidden', !run && !raceWait);
    document.body.classList.toggle('has-ev', !!(run || raceWait));
    let count = '';
    const set = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    if (run) {
      const e = run.event, n = e.gates.length, laps = e.laps || 1;
      set(P.name, e.name + (this.inRace ? ` · ${this.race.racers.length} trucks` : ''));
      const best = this.g.career?.best(e.id);
      set(P.best, best ? `BEST ${clock(best.time)}` : `GOLD ${clock(e.par.gold)}`);
      P.el.classList.toggle('danger', run instanceof ZoneRun && run.outside && run.phase === 'running');
      if (run instanceof ZoneRun || run instanceof HillRun) {
        this.drawMode(run);
        set(P.timeLbl, run instanceof ZoneRun ? 'SURVIVED' : 'CURRENT TIME');
      } else {
        set(P.timeLbl, 'CURRENT TIME');
        set(P.cp, `${Math.min(run.gate, n)}/${n}`);
        P.lapBox?.classList.toggle('hidden', laps < 2);
        set(P.lapLbl, 'LAP');
        if (laps > 1) set(P.lap, `${Math.min(e.gates[run.gate]?.lap ?? laps, laps)}/${laps}`);
      }
      P.restart?.classList.toggle('hidden', this.inRace);
      const isMode = run instanceof ZoneRun || run instanceof HillRun;
      P.cp?.parentElement.classList.toggle('mode', isMode);
      if (run.phase === 'countdown') {
        const left = run.countdown(this.now);
        set(P.time, '0:00.0');
        if (!isMode || left > COUNTDOWN + 0.6) set(P.info, left > COUNTDOWN + 0.6 ? `Lined up. Starts in ${Math.ceil(left)} s${this.inRace ? ': friends press J to join' : ''}` : `Gold ${fmt(e.par.gold)} · silver ${fmt(e.par.silver)} · bronze ${fmt(e.par.bronze)}`);
        if (left <= COUNTDOWN) count = String(Math.ceil(left));
      } else {
        set(P.time, clock(run.time));
        const pen = run.penalty ? `+${run.penalty} s penalties · ` : '';
        if (!(run instanceof ZoneRun || run instanceof HillRun)) set(P.info, run.phase === 'finished' ? (this.inRace ? 'Finished: waiting for the others' : 'Finished') : `${pen}R: back to the last checkpoint`);
        if (this.goT > 0) count = 'GO';
      }
    } else if (raceWait) {
      set(P.name, this.byId.get(this.race.id)?.name || 'Race');
      set(P.time, '');
      set(P.info, 'Waiting for the others');
    }
    if (P.count.textContent !== count) { P.count.textContent = count; P.count.classList.toggle('hidden', !count); P.count.classList.toggle('go', count === 'GO'); }
  }

  /** The other trucks in the room (King of the Hill: who is on the hill with us). */
  othersAt() { return [...this.g.remotes.values()].filter((r) => r.state).map((r) => r.model.root.position); }

  /** The party modes' readouts: health and the zone (elimination), the hill held (king of the hill). */
  drawMode(run) {
    const P = this.panel, set = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    P.lapBox?.classList.remove('hidden');
    if (run instanceof ZoneRun) {
      set(P.cp, `♥ ${Math.ceil(run.health)}`);
      const alive = this.inRace ? this.race.racers.filter((r) => !this.race.times.has(r.id)).length : 1;
      set(P.lapLbl, 'IN'); set(P.lap, this.inRace ? `${alive}/${this.race.racers.length}` : '1');
      const z = run.zone;
      if (run.phase === 'countdown') set(P.info, 'Stay inside the circle: it shrinks, again and again. Outside it, your truck takes damage');
      else set(P.info, run.outside ? 'OUTSIDE THE ZONE! Get back in' : z.r <= 0 ? 'The zone has closed' : z.shrinking ? `The zone is closing: ${Math.ceil(z.left)} s` : `The zone shrinks in ${Math.ceil(z.left)} s`);
    } else {
      const H = run.event.hill, p = this.g.vehicle.pos, d = Math.hypot(p.x - H.x, p.z - H.z);
      set(P.cp, `${Math.floor(run.held)}/${HOLD} s`);
      set(P.lapLbl, 'HILL'); set(P.lap, run.inside ? 'ON IT' : d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);
      set(P.info, run.phase === 'countdown' ? `First to hold ${H.name} for ${HOLD} s, alone in its ring, wins` : run.contested ? 'CONTESTED: push them out!' : run.inside ? `Holding ${H.name}` : `Get to ${H.name}: follow the line`);
    }
  }

  /** Our run is over: medal and prize money, personal best, and (racing) our time to the room. */
  finished() {
    const g = this.g, run = this.run, e = run.event, time = run.time;
    g.course?.setActive(null);
    g.audio.beep?.(1568, 0.5, 0.1);
    // a hill someone else held: our time is where we'd stand (the match so far and the hold we still needed), for the
    // race's table, not a time of ours: no medal or best for it (quick to lose, it came out a gold)
    const lost = run instanceof HillRun && run.held < HOLD;
    const medal = lost ? null : medalFor(e, time), before = g.career?.best(e.id);
    const prize = runPrize(e, medal, before?.medal);
    const pb = !lost && (!before || (e.higher ? time > before.time : time < before.time));
    if (g.career) {
      if (prize.medal) g.career.add(prize.medal, `${MEDAL_NAME[medal]}: ${e.name}`);
      g.career.add(prize.finish, `Finished the ${e.name}`);
      if (!lost) g.career.record(e.id, { time, medal }, !!e.higher);
    }
    if (this.inRace) {
      g.net.send({ t: 'ev', k: 'done', time });
      (this.race.times || (this.race.times = new Map())).set(g.net.id, time);
    }
    this.showResult({ e, time, medal, prize, pb, before, penalty: run.penalty, note: run instanceof ZoneRun ? (run.out ? 'Out of the zone' : 'The last truck in!') : run instanceof HillRun && run.held < HOLD ? 'Someone else held the hill' : '' });
    this.run = null;
  }

  showResult({ e, time, medal, prize, pb, before, penalty, table, note }) {
    const el = this.panel.result;
    if (!el) return;
    const rows = table ? `<table class="ev-table">${table.map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.place ?? '–'}</td><td>${escapeHtml(r.name)}</td><td>${Number.isFinite(r.time) ? fmt(r.time) : 'did not finish'}</td><td>${r.prize ? money(r.prize) : ''}</td></tr>`).join('')}</table>` : '';
    const lines = [];
    if (prize?.medal) lines.push(`${money(prize.medal)} for the ${medal} medal`);
    if (prize?.finish) lines.push(`${money(prize.finish)} for finishing`);
    el.innerHTML = `
      <div class="ev-r-name">${escapeHtml(e.name)}</div>
      ${note ? `<div class="ev-r-note">${escapeHtml(note)}</div>` : ''}
      ${time !== undefined ? `<div class="ev-r-time">${fmt(time)}${penalty ? ` <small>(${penalty} s of penalties)</small>` : ''}</div>
      <div class="ev-r-medal ${medal || 'none'}">${medal ? `${MEDAL_NAME[medal]} medal` : `No medal: bronze is ${e.higher ? 'lasting ' : ''}${fmt(e.par.bronze)}`}</div>
      <div class="ev-r-pb">${pb ? (before ? `Personal best! (was ${fmt(before.time)})` : e.mode ? 'Your first go at it' : 'Your first time on this course') : before ? `Your best: ${fmt(before.time)}` : ''}</div>` : ''}
      ${lines.length ? `<div class="ev-r-prize">${lines.join(' · ')}</div>` : ''}
      ${rows}
      <div class="ev-r-actions"><button data-again class="primary">Again (J)</button><button data-close class="ghost">Close</button></div>`;
    el.classList.remove('hidden');
    this.g.hud.clearHint?.();
    this.resultT = table ? 20 : 14;
    this.lastEvent = e;
  }

  closeResult() { this.panel.result?.classList.add('hidden'); this.resultT = 0; }

  // ---------------------------------------------------------------- the room's races
  onNet(m) {
    const g = this.g, me = g.net?.id;
    const e = this.byId.get(m.id);
    if (m.k === 'open' && e) {
      this.race = { id: m.id, at: m.at, racers: m.racers, times: new Map() };
      if (m.by === me) {
        if (this.racing) this.giveUp('You left your run for the race');
        this.lineUp(e, 0);
        this.startRun(e, this.toLocal(m.at), m.at);
        g.hud.toast(`Race open: ${e.name}. Your friends have ${Math.round((m.at - this.serverNow()) / 1000)} s to press J and join`, true, 6);
      } else {
        g.hud.toast(`${m.name} opened a race: ${e.name}. Press J within ${Math.round((m.at - this.serverNow()) / 1000)} s to join`, true, 8);
        g.chat.system(`${m.name} opened a race: ${e.name} (J to join)`);
      }
    } else if (m.k === 'open' && m.by !== me && g.world.def?.races?.some((r) => r.id === m.id)) {
      // (a race across the open world, opened while part of it is still coming in here: it can't be joined yet)
      g.chat.system(`${m.name} opened ${g.world.def.races.find((r) => r.id === m.id).name}: it can be joined once the whole world is in here`);
    } else if (m.k === 'join' && this.race) {
      this.race.racers = m.racers;
      if (m.pid === me && e) {
        if (this.racing) this.giveUp('You left your run for the race');
        this.closeResult();
        this.lineUp(e, m.racers.findIndex((r) => r.id === me));
        this.startRun(e, this.toLocal(this.race.at), this.race.at);
        g.hud.toast(`Lined up for the ${e.name}`, false, 4);
      } else if (m.pid !== me) g.chat.system(`${m.name} joined the ${e?.name || 'race'}`);
    } else if (m.k === 'done' && this.race) {
      this.race.times.set(m.pid, m.time);
      if (m.pid !== me) g.chat.system(Number.isFinite(m.time) ? `${m.name} ${e?.kind === 'zone' ? `is out after ${fmt(m.time)}` : e?.kind === 'hill' ? `: ${fmt(m.time)}` : `finished: ${fmt(m.time)}`}` : `${m.name} gave up`);
      if (m.pid !== me) this.othersDone(Number.isFinite(m.time) ? m.time : null);
    } else if (m.k === 'end') {
      this.race = null;
      if (!e || !m.results.some((r) => r.id === me)) return;
      if (this.racing) { this.run.phase = 'out'; this.run = null; this.hold = false; g.course?.setActive(null); }
      if (m.results.length < 2) return;                            // nobody joined: it was a solo run
      const table = standings(m.results, e).map((r) => ({ ...r, me: r.id === me }));
      const mine = table.find((r) => r.me), place = ['1st', '2nd', '3rd', '4th'][(mine?.place ?? 0) - 1];
      if (mine?.prize && g.career) g.career.add(mine.prize, `${place} in the ${e.name} race`);
      this.showResult({ e, table });
      g.hud.toast(place ? `${place} in the ${e.name}${mine.prize ? `: ${money(mine.prize)}` : ''}` : `${e.name}: race over`, true, 6);
    }
  }

  /**
   * Someone else's match is over. King of the hill: one of them held it, so ours ends where we stand. Elimination:
   * everyone else is out, so we are the last truck in.
   */
  // (each truck times its own run on its own clock, a little apart: the order is what counts, so the winner of a hill
  // stands ahead of us, and the last truck in ahead of all the others)
  othersDone(time) {
    const run = this.run, me = this.g.net?.id;
    if (!run || run.phase !== 'running' || !this.inRace) return;
    if (run instanceof HillRun && time !== null) { run.time = Math.max(run.standing(), time + 0.1); run.phase = 'finished'; this.finished(); return; }
    if (run instanceof ZoneRun && this.race.racers.every((r) => r.id === me || this.race.times.has(r.id))) {
      const longest = Math.max(0, ...[...this.race.times.values()].filter(Number.isFinite));
      run.time = Math.max(run.time, longest + 0.1);
      run.phase = 'finished';
      this.finished();
    }
  }

  /** A player left the room: out of the race. */
  onLeave(id) {
    if (!this.race || !this.race.racers.some((r) => r.id === id) || this.race.times.has(id)) return;
    this.race.times.set(id, null);
    this.othersDone(null);
  }

  /** Joining a room with a race on (the welcome). */
  welcome(race) {
    if (race && this.byId.has(race.id)) {
      this.race = { id: race.id, at: race.at, racers: race.racers, times: new Map() };
      if (this.serverNow() < race.at) this.g.hud.toast(`A race is about to start: ${this.byId.get(race.id).name}. Press J to join`, true, 6);
    }
  }

  /** What the players list shows next to a racer. */
  tagFor(id) {
    if (!this.race || !this.race.racers.some((r) => r.id === id)) return '';
    const t = this.race.times?.get(id);
    return t === undefined ? 'racing' : Number.isFinite(t) ? fmt(t) : 'out';
  }

  // ---------------------------------------------------------------- the Events list (pause menu)
  /**
   * The Modes & races cards: free roam and the map builder, then the party modes, the checkpoint races and the events,
   * each with its picture (assets/ui/modes/<map>-<id>.webp, rendered in the game), what it is, the par times, your best
   * and what gold pays. builderImg: a picture of this map for the builder's card.
   */
  listHtml(builderImg = '') {
    const g = this.g, friends = this.friendsHere(), mapId = g.world.map?.id || 'ashwood';
    const pic = (name) => `<img src="assets/ui/modes/${mapId}-${name}.webp" alt="" loading="lazy" onerror="this.remove()">`;
    const ic = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
    const feat = (icon, text) => `<li>${ic(icon)}${text}</li>`;
    const card = (o) => `<article class="mode-card e-${o.edge}" data-sec="${o.sec}">
        <div class="mc-img">${o.image || ''}</div>
        <div class="mc-body"><h4>${ic(o.icon)}<span>${o.title}</span><em class="tag t-${o.edge}">${o.tag}</em>${o.medal || ''}</h4>
          <p>${o.desc}</p><ul class="mc-feats">${o.feats.join('')}</ul></div>
        <div class="mc-act">${o.acts}</div>
      </article>`;
    const group = (sec, icon, title, note) => `<h3 class="mode-group" data-sec="${sec}">${ic(icon)}${title}${note ? `<small>${note}</small>` : ''}</h3>`;
    const W = g.world, found = g.found?.size || 0, total = W.beacons.length, others = friends;
    const cards = [card({
      sec: 'free', edge: 'green', icon: 'mountain', title: 'Free roam', tag: 'Explore', image: pic('free'),
      desc: 'Explore the map, find the survey beacons and drive the trails, alone or with your friends. The satnav (M) finds the way anywhere.',
      feats: [feat('beacon', `Beacons ${found}/${total}`), feat('map', 'Open world'), feat('people', others ? `${others} friend${others > 1 ? 's' : ''} here` : 'Play together')],
      acts: `<button class="mc-btn b-orange" data-free>${ic('arrow')}Explore</button>`,
    }), card({
      sec: 'free', edge: 'blue', icon: 'map', title: 'Map builder', tag: 'Create', image: builderImg ? `<img src="${builderImg}" alt="">` : '',
      desc: 'Build your own ramps, kickers, mud pits and checkpoints on this map. Share it with a link, and race your friends on it.',
      feats: [feat('mountain', 'Ramps &amp; obstacles'), feat('pin', 'Checkpoints'), feat('people', 'Build together'), feat('arrow', 'Share a link')],
      acts: `<button class="mc-btn b-blue" data-build>${ic('wrench')}Build</button>`,
    })];
    const fmtLen = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
    const eventCard = (e) => {
      const best = g.career?.best(e.id), medal = best?.medal, race = !!e.race;
      const edge = e.kind === 'zone' ? 'red' : e.kind === 'hill' ? 'yellow' : race ? 'orange' : 'purple';
      const icon = e.kind === 'zone' ? 'target' : e.kind === 'hill' ? 'crown' : race ? 'flag' : 'timer';
      const tag = { zone: 'Last truck in', hill: 'Hold the hill', circuit: 'Circuit', rally: 'Rally', slalom: 'Trials', trail: 'Hill climb' }[e.kind] || 'Dash';
      const feats = [];
      if (e.kind === 'circuit') feats.push(feat('loop', `${e.laps} laps`));
      if (e.length && (race || e.kind === 'rally')) feats.push(feat('pin', fmtLen(e.length)));
      const cps = e.gates?.length || 0;
      if (cps && !e.mode) feats.push(feat('flag', `${cps} ${race ? 'checkpoints' : 'gates'}`));
      if (e.mode) feats.push(feat('people', friends ? 'Against your friends' : 'Solo: against the clock'));
      if (e.par) feats.push(feat('trophy', e.higher ? `Gold: last ${fmt(e.par.gold)}` : `Gold ${fmt(e.par.gold)}`));
      if (best) feats.push(feat('timer', `Your best ${fmt(best.time)}`));
      if (e.par) feats.push(feat('cash', `Gold pays ${money(runPrize(e, 'gold', null).medal)}`));
      return card({
        sec: e.mode ? 'party' : race ? 'race' : 'event', edge, icon, title: escapeHtml(e.name), tag, image: pic(e.id), feats,
        medal: medal ? `<em class="tag medal ${medal}">${MEDAL_NAME[medal]}</em>` : '',
        desc: escapeHtml(e.desc || ''),
        acts: `<button class="mc-btn b-${edge}" data-start="${e.id}">${ic('play')}${friends ? 'Start: friends join' : 'Start'}</button><button class="mc-link" data-go="${e.id}">${ic('arrow')}Go to the start</button>`,
      });
    };
    const party = this.events.filter((e) => e.mode), races = this.events.filter((e) => e.race), evs = this.events.filter((e) => !e.mode && !e.race);
    return `${group('free', 'mountain', 'Free roam', 'the open map, and your own on it')}${cards.join('')}
      ${party.length ? group('party', 'people', 'Party modes', friends ? 'start one and your friends have 15 s to press J and join' : 'best with friends in the room; alone, against the clock') + party.map(eventCard).join('') : ''}
      ${races.length ? group('race', 'trophy', 'Checkpoint races', 'circuits and rallies through numbered arches; with friends, the places pay') + races.map(eventCard).join('') : ''}
      ${evs.length ? group('event', 'timer', 'Events', 'climbs, dashes and trials: beat the par times for medal money') + evs.map(eventCard).join('') : ''}`;
  }

  /** From the list: line up for an event now (with friends here: open it for them to join). */
  startNow(id) {
    const e = this.byId.get(id);
    if (!e || this.racing) return;
    this.picked = e;
    this.lineUp(e, 0);
    this.begin(e);
  }
}
