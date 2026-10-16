// Events in the game: the start lines, a run's countdown, clock and gates, medals and prize money, and races with
// friends. Alone (or alone in the room), J at a start line lines the truck up and counts it down. With friends in the
// room, J opens a race instead: the server gives it a start time a little ahead (RACE_LEAD), friends press J to join
// and are lined up beside you, everyone's clock starts together, and the server collects the times (server/rooms.js).
import { eventsFor, EventRun, medalFor, clock, runPrize, standings, gridFor, COUNTDOWN, TOUCH_PENALTY } from './Events.js';
import { racesFor } from './Races.js';
import { money } from './Career.js';
import { escapeHtml } from '../ui/HUD.js';

const NEAR = 14;                   // m from a start line to start there with J
const $ = (id) => document.getElementById(id);
const MEDAL_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const fmt = (t) => (t < 60 ? `${t.toFixed(1)} s` : clock(t));
/** What sort of event it is, for the lists and the map. */
export const kindOf = (e) => (e.kind === 'circuit' ? `Circuit · ${e.laps} laps` : e.kind === 'rally' ? `Rally · ${(e.length / 1000).toFixed(1)} km` : e.kind === 'slalom' ? 'Trials' : e.kind === 'trail' ? 'Hill climb' : 'Dash');

export class EventPlay {
  constructor(game) {
    this.g = game;
    // the map's events, then its checkpoint races (game/Races.js)
    this.events = [...eventsFor(game.world), ...racesFor(game.world)];
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
      cp: $('ev-cpn'), lap: $('ev-lap'), lapBox: $('ev-lapbox'), best: $('ev-best'), restart: $('ev-restart'), leave: $('ev-leave') };
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

  /** The event whose start line we are at, or null. */
  startHere() {
    const p = this.g.vehicle.pos;
    for (const e of this.events) if (Math.hypot(p.x - e.start.x, p.z - e.start.z) < NEAR) return e;
    return null;
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

  startRun(e, startAt) {
    this.g.hud.clearHint?.();
    this.run = new EventRun(e, startAt);
    this.lastEvent = e;
    this.hold = true;
    this.lastCount = null;
    this.giveUpT = 0;
    this.g.course?.setActive(e, 0);
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
    const knock = v.hullPeak;
    v.hullPeak = 0;
    this.giveUpT = Math.max(0, this.giveUpT - dt);
    if (this.resultT > 0 && (this.resultT -= dt) <= 0) this.closeResult();
    if (run) {
      const r = run.update(this.now, v.pos, knock);
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
      else if (r === 'touch') { g.hud.hint(`Touched: +${TOUCH_PENALTY} s`, 1.5); g.audio.bang?.(0.4, false); }
      else if (r === 'finish') this.finished();
      else if (r === 'timeout') this.giveUp(`Out of time: ${run.event.name} has a ${Math.round(600 / 60)} minute limit`);
    }
    this.goT = Math.max(0, (this.goT || 0) - dt);
    this.drawPanel();
    // at a start line: say what it is
    this.promptT -= dt;
    if (!this.run && this.promptT <= 0 && Math.abs(g.vehicle.speed) < 3) {
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
      set(P.name, e.name + (this.inRace ? ` · race of ${this.race.racers.length}` : ''));
      set(P.cp, `${Math.min(run.gate, n)}/${n}`);
      P.lapBox?.classList.toggle('hidden', laps < 2);
      if (laps > 1) set(P.lap, `${Math.min(e.gates[run.gate]?.lap ?? laps, laps)}/${laps}`);
      const best = this.g.career?.best(e.id);
      set(P.best, best ? `BEST ${clock(best.time)}` : `GOLD ${clock(e.par.gold)}`);
      P.restart?.classList.toggle('hidden', this.inRace);
      if (run.phase === 'countdown') {
        const left = run.countdown(this.now);
        set(P.time, '0:00.0');
        set(P.info, left > COUNTDOWN + 0.6 ? `Lined up. Starts in ${Math.ceil(left)} s${this.inRace ? ': friends press J to join' : ''}` : `Gold ${fmt(e.par.gold)} · silver ${fmt(e.par.silver)} · bronze ${fmt(e.par.bronze)}`);
        if (left <= COUNTDOWN) count = String(Math.ceil(left));
      } else {
        set(P.time, clock(run.time));
        const pen = run.penalty ? `+${run.penalty} s penalties · ` : '';
        set(P.info, run.phase === 'finished' ? (this.inRace ? 'Finished: waiting for the others' : 'Finished') : `${pen}R: back to the last checkpoint`);
        if (this.goT > 0) count = 'GO';
      }
    } else if (raceWait) {
      set(P.name, this.byId.get(this.race.id)?.name || 'Race');
      set(P.time, '');
      set(P.info, 'Waiting for the others');
    }
    if (P.count.textContent !== count) { P.count.textContent = count; P.count.classList.toggle('hidden', !count); P.count.classList.toggle('go', count === 'GO'); }
  }

  /** Our run is over: medal and prize money, personal best, and (racing) our time to the room. */
  finished() {
    const g = this.g, run = this.run, e = run.event, time = run.time;
    g.course?.setActive(null);
    g.audio.beep?.(1568, 0.5, 0.1);
    const medal = medalFor(e, time), before = g.career?.best(e.id);
    const prize = runPrize(e, medal, before?.medal);
    const pb = !before || time < before.time;
    if (g.career) {
      if (prize.medal) g.career.add(prize.medal, `${MEDAL_NAME[medal]}: ${e.name}`);
      g.career.add(prize.finish, `Finished the ${e.name}`);
      g.career.record(e.id, { time, medal });
    }
    if (this.inRace) {
      g.net.send({ t: 'ev', k: 'done', time });
      (this.race.times || (this.race.times = new Map())).set(g.net.id, time);
    }
    this.showResult({ e, time, medal, prize, pb, before, penalty: run.penalty });
    this.run = null;
  }

  showResult({ e, time, medal, prize, pb, before, penalty, table }) {
    const el = this.panel.result;
    if (!el) return;
    const rows = table ? `<table class="ev-table">${table.map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.place ?? '–'}</td><td>${escapeHtml(r.name)}</td><td>${Number.isFinite(r.time) ? fmt(r.time) : 'did not finish'}</td><td>${r.prize ? money(r.prize) : ''}</td></tr>`).join('')}</table>` : '';
    const lines = [];
    if (prize?.medal) lines.push(`${money(prize.medal)} for the ${medal} medal`);
    if (prize?.finish) lines.push(`${money(prize.finish)} for finishing`);
    el.innerHTML = `
      <div class="ev-r-name">${escapeHtml(e.name)}</div>
      ${time !== undefined ? `<div class="ev-r-time">${fmt(time)}${penalty ? ` <small>(${penalty} s of penalties)</small>` : ''}</div>
      <div class="ev-r-medal ${medal || 'none'}">${medal ? `${MEDAL_NAME[medal]} medal` : `No medal: bronze is ${fmt(e.par.bronze)}`}</div>
      <div class="ev-r-pb">${pb ? (before ? `Personal best! (was ${fmt(before.time)})` : 'Your first time on this course') : `Your best: ${fmt(before.time)}`}</div>` : ''}
      ${lines.length ? `<div class="ev-r-prize">${lines.join(' · ')}</div>` : ''}
      ${rows}
      <div class="ev-r-actions"><button data-again class="primary">Again (J)</button><button data-close class="ghost">Close</button></div>`;
    el.classList.remove('hidden');
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
        this.startRun(e, this.toLocal(m.at));
        g.hud.toast(`Race open: ${e.name}. Your friends have ${Math.round((m.at - this.serverNow()) / 1000)} s to press J and join`, true, 6);
      } else {
        g.hud.toast(`${m.name} opened a race: ${e.name}. Press J within ${Math.round((m.at - this.serverNow()) / 1000)} s to join`, true, 8);
        g.chat.system(`${m.name} opened a race: ${e.name} (J to join)`);
      }
    } else if (m.k === 'join' && this.race) {
      this.race.racers = m.racers;
      if (m.pid === me && e) {
        if (this.racing) this.giveUp('You left your run for the race');
        this.closeResult();
        this.lineUp(e, m.racers.findIndex((r) => r.id === me));
        this.startRun(e, this.toLocal(this.race.at));
        g.hud.toast(`Lined up for the ${e.name}`, false, 4);
      } else if (m.pid !== me) g.chat.system(`${m.name} joined the ${e?.name || 'race'}`);
    } else if (m.k === 'done' && this.race) {
      this.race.times.set(m.pid, m.time);
      if (m.pid !== me) g.chat.system(Number.isFinite(m.time) ? `${m.name} finished: ${fmt(m.time)}` : `${m.name} gave up`);
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
  listHtml() {
    const g = this.g;
    return this.events.map((e) => {
      const best = g.career?.best(e.id);
      const medal = best?.medal;
      return `<div class="dealer-row ev-row${medal ? ' mine' : ''}">
        <b>${escapeHtml(e.name)}${medal ? ` <span class="ev-medal ${medal}">${MEDAL_NAME[medal]}</span>` : ''} <span class="ev-kind">${kindOf(e)}</span></b>
        <span class="blurb">${escapeHtml(e.desc)}</span>
        <span class="stats">Par: gold ${fmt(e.par.gold)} · silver ${fmt(e.par.silver)} · bronze ${fmt(e.par.bronze)}${best ? ` · your best ${fmt(best.time)}` : ''} · gold pays ${money(runPrize(e, 'gold', null).medal)}</span>
        <button class="ghost" data-go="${e.id}">Go to the start</button>
      </div>`;
    }).join('');
  }
}
