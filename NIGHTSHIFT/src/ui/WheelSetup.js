// The first time a steering wheel is plugged in: its pedals are learnt (every model reports them on axes of its own,
// resting at one end of their travel: see core/Wheel.js). Feet off, press the accelerator, press the brake: a panel at
// the top of the screen while the game runs on under it, kept per wheel in the settings. Settings > Controls runs it
// again.
import { bus } from '../core/EventBus.js';
import { saveProfile } from '../core/Wheel.js';

const STEPS = {
  rest: 'Take your feet off the pedals and let go of the wheel',
  throttle: 'Press the <b>ACCELERATOR</b> all the way down, then let it up',
  brake: 'Now press the <b>BRAKE</b> all the way down, then let it up',
  done: 'Done: the pedals are set. Drive!',
};

export class WheelSetup {
  constructor(settings) { this.settings = settings; this.el = null; }

  get open() { return !!this.el; }

  start(id = null) {
    if (this.el) return;
    const el = (this.el = document.createElement('div'));
    el.className = 'wheel-setup';
    el.innerHTML = '<div class="ws-title">STEERING WHEEL SETUP</div><div class="ws-name"></div><div class="ws-step"></div>'
      + '<div class="ws-bar"><i></i></div><div class="ws-foot"><button class="btn ws-skip">SKIP</button></div>';
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    $('.ws-skip').onclick = () => this.close('Wheel pedals not set up yet: Settings > Controls > SET UP PEDALS');
    const st = { step: 'rest', t0: performance.now(), base: null, ext: [], far: [], got: {}, rel: 0 };
    const show = (step, bar = 0) => { $('.ws-step').innerHTML = STEPS[step] || step; $('.ws-bar i').style.width = `${Math.round(Math.min(1, bar) * 100)}%`; };
    const loop = () => {
      if (this.el !== el) return;
      requestAnimationFrame(loop);
      const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && (!id || p.id === id));
      if (!pad) { show('Connect the steering wheel...'); return; }
      id = pad.id;
      $('.ws-name').textContent = pad.id.replace(/\s*\(.*$/, '') || pad.id;
      const ax = [...pad.axes], now = performance.now();
      if (st.step === 'rest') {
        show('rest', (now - st.t0) / 1500);
        if (now - st.t0 > 1500) { st.base = ax; st.step = 'throttle'; st.ext = [...ax]; st.far = [...ax]; }
        return;
      }
      if (st.step === 'done') { show('done', 1); if (now - st.t0 > 1600) this.close(); return; }
      // the pedal: the axis that moves furthest from where it rested (not the wheel's, the d-pad's or a pedal already
      // learnt). Its far end is 'full'; its rest is where it was furthest from that (some read 0 until first pressed)
      let a = -1, best = 0;
      ax.forEach((v, i) => {
        if (i === 0 || Math.abs(st.base[i]) > 1.05 || Object.values(st.got).some((p) => p.a === i)) return;
        if (Math.abs(v - st.base[i]) > Math.abs(st.ext[i] - st.base[i])) st.ext[i] = v;
        if (Math.abs(v - st.ext[i]) > Math.abs(st.far[i] - st.ext[i])) st.far[i] = v;
        const d = Math.abs(st.ext[i] - st.base[i]);
        if (d > best) { best = d; a = i; }
      });
      const travel = a >= 0 ? Math.abs(st.ext[a] - st.far[a]) : 0;
      show(st.step, a >= 0 && travel > 0 ? 1 - Math.abs(ax[a] - st.ext[a]) / travel : 0);
      // pressed well down, and let up again: then half a second more for it to settle where it really rests (a pedal
      // that read 0 until pressed comes back to its end of the travel, not to 0)
      const up = a >= 0 && best > 0.5 && travel > 0.5 && Math.abs(ax[a] - st.ext[a]) > travel * 0.8;
      if (!up) st.rel = 0; else if (!st.rel) st.rel = now;
      if (up && now - st.rel > 500) {
        st.rel = 0;
        st.got[st.step] = { a, rest: +st.far[a].toFixed(3), full: +st.ext[a].toFixed(3) };
        // (each pedal measured from where they all rested at the start: the next may already be on its way down)
        if (st.step === 'throttle') { st.step = 'brake'; st.ext = [...st.base]; st.far = [...st.base]; }
        else {
          saveProfile(this.settings, { id, throttle: st.got.throttle, brake: st.got.brake });
          bus.emit('toast', { text: 'Steering wheel ready: pedals set', time: 3 });
          st.step = 'done'; st.t0 = now;
        }
      }
    };
    requestAnimationFrame(loop);
  }

  close(msg) {
    this.el?.remove(); this.el = null;
    if (msg) bus.emit('toast', { text: msg, time: 4 });
  }
}
