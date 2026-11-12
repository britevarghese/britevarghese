// Random street events in Kerala, GTA "random encounter" style: every few minutes of free driving something happens
// near you and you get a few seconds to take it on (E):
//   CHAIN SNATCHER  a thief on a scooter grabbed a woman's gold chain: run him off the road (2 hits)
//   STOLEN AUTO     a man's auto-rickshaw - his living - is being driven off: stop it (3 hits)
// Taken on, it runs on the story engine as a generated job (a 'ram' step whose route goes through the nearby
// streets), like Port Halvern's odd jobs; its pay comes on success.
import { bus } from '../core/EventBus.js';

const EVENTS = [
  { id: 'snatch', title: 'CHAIN SNATCHER', vehicle: 'scooter', paints: ['#c0c0c8', '#1c1c1c', '#b01818'], hits: 2, speed: 19, pay: [1200, 2000],
    shout: '"Kallan! Kallan!" A thief on a scooter just snatched a woman\'s gold chain', text: 'Run the <b>chain snatcher</b> off his scooter.', thanks: 'The chain is back round her neck. She\'s telling everyone about you.' },
  { id: 'auto', title: 'STOLEN AUTO', vehicle: 'auto', paints: ['#e8c020', '#1c6a3a'], hits: 3, speed: 17, pay: [1500, 2500],
    shout: '"Ente auto!" Someone is driving off in a man\'s auto-rickshaw', text: 'Stop the <b>stolen auto-rickshaw</b>.', thanks: 'Ravi has his auto back. Free rides for life, he says.' },
];
const GAP = [150, 330]; // seconds of free driving between offers

export class KeralaEvents {
  constructor(game) {
    this.game = game;
    this.wait = 90 + Math.random() * 90;
    this.offer = null;
    this.done = 0;
    bus.on('job:pass', (e) => { if (e.kind === 'event' && this.current) this._thanks(); });
  }

  _free() {
    const g = this.game;
    return g.state.mode === 'drive' && !g.onFoot?.active && !g.story?.active && !g.races?.active && !g.police?.inPursuit && !g.jobs?.working && !g.boatRide?.active && g.lib;
  }

  // a spot on the road `d` metres ahead of the car (or round it), on built ground
  _ahead(d0, d1) {
    const g = this.game, w = g.world, s = g.player.state;
    for (let k = 0; k < 10; k++) {
      const a = s.yaw + (Math.random() - 0.5) * (k < 5 ? 0.8 : 3), d = d0 + Math.random() * (d1 - d0);
      const x = s.x + Math.sin(a) * d, z = s.z + Math.cos(a) * d;
      if (!w.groundKnown(x, z, 20)) continue;
      const r = w.roadSpot(x, z, 6);
      if (r && Math.hypot(r.x - x, r.z - z) < 120 && Math.hypot(r.x - s.x, r.z - s.z) > d0 * 0.6) return { x: r.x, z: r.z };
    }
    return null;
  }

  update(dt, input) {
    const g = this.game;
    if (this.offer) {
      this.offer.t -= dt;
      if (!this._free() || this.offer.t <= 0) { this.offer = null; g.hud.setPrompt(null); this.wait = GAP[0] + Math.random() * (GAP[1] - GAP[0]); return; }
      this.promptHtml = `<b style="color:#ffb03d">${this.offer.ev.title}</b> · ${this.offer.ev.shout} · press <span class="key">E</span> / <span class="key">X</span> to give chase (${Math.ceil(this.offer.t)})`;
      if (input.consume('event')) this._start();
      return;
    }
    this.promptHtml = null;
    if (this.current && !g.story?.active) this.current = null; // (failed: it got away)
    if (!this._free()) return;
    if (Math.hypot(g.player.state.vx, g.player.state.vz) < 3) return; // (driving about, not parked)
    if ((this.wait -= dt) > 0) return;
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const a = this._ahead(70, 120), b = a && this._ahead(500, 900), c = b && this._ahead(900, 1400);
    if (!a || !b || !c) { this.wait = 10; return; }
    this.offer = { ev, route: [a, b, c], t: 12 };
    g.audio?.playEvent?.('uiClick');
    g.hud.message(ev.title, 'press E to give chase', 2.5, true);
  }
  late() { if (this.promptHtml) this.game.hud.setPrompt(this.promptHtml); }

  _start() {
    const g = this.game, { ev, route } = this.offer;
    this.offer = null; this.promptHtml = null; g.hud.setPrompt(null);
    const pay = Math.round(ev.pay[0] + Math.random() * (ev.pay[1] - ev.pay[0]));
    const m = { id: `ev_${ev.id}`, title: ev.title, job: { kind: 'event' }, steps: [
      { type: 'ram', vehicle: ev.vehicle, paint: ev.paints[Math.floor(Math.random() * ev.paints.length)], route, hits: ev.hits, speed: ev.speed, text: ev.text, waitText: 'CATCH HIM' },
    ], pay: () => pay };
    this.current = ev;
    g.lib.load([ev.vehicle], 1);
    g.story.start(m);
    this.wait = GAP[0] + Math.random() * (GAP[1] - GAP[0]);
  }

  _thanks() {
    const ev = this.current; this.current = null; this.done++;
    const D = this.game.save.data; D.events = (D.events || 0) + 1;
    setTimeout(() => this.game.ui?.toast?.(ev.thanks, 'cash', 5), 3800);
  }
}
export { EVENTS };
