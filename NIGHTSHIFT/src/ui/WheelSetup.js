// A steering wheel's controls, learnt once (each make reports them its own way, see core/Wheel.js): centre the wheel
// with feet off the pedals; turn it to the left; press the accelerator; press the brake. Whichever inputs move are
// kept for that controller (axes or analogue buttons, a pedal resting at either end of its travel or both pedals on
// one axis). A panel at the top of the screen while the game runs on under it; Settings > Controls runs it again.
import { bus } from '../core/EventBus.js';
import { saveProfile, inputs, gamepads } from '../core/Wheel.js';

const STEPS = {
  rest: 'Centre the wheel, let go of it, and take your feet off the pedals',
  steer: 'Turn the wheel all the way to the <b>LEFT</b>, then back to the centre',
  throttle: 'Press the <b>ACCELERATOR</b> pedal all the way down, then let it up',
  brake: 'Now press the <b>BRAKE</b> pedal all the way down, then let it up',
  done: 'Done: wheel and pedals set. Drive!',
};
const NEXT = { steer: 'throttle', throttle: 'brake', brake: 'done' };

export class WheelSetup {
  constructor(settings) { this.settings = settings; this.el = null; }

  get open() { return !!this.el; }

  start(id = null) {
    if (this.el) return;
    const el = (this.el = document.createElement('div'));
    el.className = 'wheel-setup';
    el.innerHTML = '<div class="ws-title">STEERING WHEEL SETUP</div><div class="ws-name"></div><div class="ws-step"></div>'
      + '<div class="ws-bar"><i></i></div><div class="ws-live"></div><div class="ws-foot"><button class="btn ws-skip">NOT NOW</button></div>';
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    $('.ws-skip').onclick = () => this.close('Wheel not set up: Settings > Controls > SET UP WHEEL');
    const st = { step: 'rest', t0: performance.now(), base: null, ext: [], far: [], got: {}, still: 0, rel: 0 };
    const show = (step, bar = 0, live = '') => { $('.ws-step').innerHTML = STEPS[step] || step; $('.ws-bar i').style.width = `${Math.round(Math.min(1, bar) * 100)}%`; $('.ws-live').textContent = live; };
    const loop = () => {
      if (this.el !== el) return;
      requestAnimationFrame(loop);
      const pad = gamepads().find((p) => p && (!id || p.id === id));
      if (!pad) { show('Connect the steering wheel, and press any button on it...'); return; }
      id = pad.id;
      $('.ws-name').textContent = pad.id.replace(/\s*\(.*$/, '') || pad.id;
      const v = inputs(pad), nAx = pad.axes.length, now = performance.now();
      const name = (k) => (k < nAx ? `axis ${k}` : `button ${k - nAx}`);
      if (st.step === 'rest') {
        show('rest', (now - st.t0) / 1500);
        if (now - st.t0 > 1500) { st.base = v; st.step = 'steer'; st.ext = [...v]; st.far = [...v]; }
        return;
      }
      if (st.step === 'done') { show('done', 1); if (now - st.t0 > 1600) this.close(); return; }
      // the input that moves furthest from where everything rested: not the d-pad's axis, the wheel's for a pedal, nor a
      // pedal already learnt (unless it moves the other way: both pedals on one axis). Its far end is 'full'; where it
      // rests is where it was furthest from that, once let go (some read 0 until first pressed)
      const T = st.got.throttle, S = st.got.steer;
      let a = -1, best = 0;
      v.forEach((x, k) => {
        if (k < nAx && Math.abs(st.base[k]) > 1.05) return;
        if (st.step === 'steer' && k >= nAx) return;                 // (the wheel is an axis)
        if (st.step !== 'steer' && S && k === S.i) return;
        if (T && k === T.i && Math.sign(x - T.rest) === Math.sign(T.full - T.rest)) return;
        if (Math.abs(x - st.base[k]) > Math.abs(st.ext[k] - st.base[k])) st.ext[k] = x;
        if (Math.abs(x - st.ext[k]) > Math.abs(st.far[k] - st.ext[k])) st.far[k] = x;
        const d = Math.abs(st.ext[k] - st.base[k]);
        if (d > best) { best = d; a = k; }
      });
      const span = a >= 0 ? Math.abs(st.ext[a] - st.far[a]) : 0;
      show(st.step, a >= 0 && span > 0 ? 1 - Math.abs(v[a] - st.ext[a]) / span : 0, a >= 0 && best > 0.15 ? `Moving: ${name(a)}` : '');
      // turned (pressed) well over and most of the way back, then still for half a second: where a pedal settles is
      // where it rests (not where it read at the start, 0 on some until first pressed; nor a point it was let up
      // through slowly)
      const need = st.step === 'steer' ? 0.35 : 0.5;
      const back = a >= 0 && best > need && Math.abs(v[a] - st.ext[a]) >= best * 0.8;
      if (!back || Math.abs(v[a] - st.still) > 0.02) { st.still = a >= 0 ? v[a] : 0; st.rel = now; }
      if (back && now - st.rel > 500) {
        // (the wheel's centre is where it rested at the start)
        st.got[st.step] = { i: a, rest: +(st.step === 'steer' ? st.base[a] : v[a]).toFixed(3), full: +st.ext[a].toFixed(3) };
        st.step = NEXT[st.step]; st.ext = [...st.base]; st.far = [...st.base];
        if (st.step === 'done') {
          saveProfile(this.settings, { id, steer: st.got.steer, throttle: st.got.throttle, brake: st.got.brake });
          bus.emit('toast', { text: 'Steering wheel ready: wheel and pedals set', time: 3 });
          st.t0 = now;
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
