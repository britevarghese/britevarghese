// How the game is running, on the screen (F3, or the pause menu): frames a second, the longest wait for a frame and how
// many came late in the last ten seconds, the graphics level drawn, and what a frame draws. For telling a slow machine
// (few frames a second, always) from a stutter (a full frame rate with long waits now and then), and what either goes
// with.

/** The frames' times, kept for ten seconds. */
export class FrameStats {
  constructor() { this.t = 0; this.gaps = []; }

  /** A frame drawn `ms` after the one before. */
  add(ms) {
    if (!(ms >= 0)) return;
    this.t += ms;
    this.gaps.push(this.t, ms);
    let k = 0;
    while (k < this.gaps.length && this.gaps[k] < this.t - 10000) k += 2;
    if (k) this.gaps.splice(0, k);
  }

  /**
   * { fps: frames a second over the last second, ms: a frame's time on average over it, worst: the longest wait for a
   * frame in the last ten seconds (ms), late: how many frames in them waited over 50 ms (a twentieth of a second: a
   * stutter you see) }.
   */
  read() {
    const G = this.gaps;
    let n = 0, sum = 0, worst = 0, late = 0;
    for (let i = 0; i < G.length; i += 2) {
      const ms = G[i + 1];
      if (ms > worst) worst = ms;
      if (ms > 50) late++;
      if (G[i] > this.t - 1000) { n++; sum += ms; }
    }
    return { fps: sum > 0 ? n * 1000 / sum : 0, ms: n ? sum / n : 0, worst, late };
  }
}

const big = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

/** The readout: el (its box in the HUD), gl (the three.js renderer, for what it drew). */
export class PerfMeter {
  constructor(el, gl) {
    this.el = el; this.gl = gl;
    this.stats = new FrameStats();
    this.on = false;
    this.last = 0; this.shown = 0;
    this.draws = 0; this.tris = 0;
  }

  show(on) {
    this.on = !!on;
    this.el.classList.toggle('hidden', !this.on);
    // (the renderer counts what each of its pictures draws, and forgets at the next: kept over the whole frame, its
    // shadows, mirrors and reflections with it, while this is shown)
    this.gl.info.autoReset = !this.on;
    this.last = 0;
    if (this.on) { this.stats = new FrameStats(); this.gl.info.reset(); this.el.textContent = ''; }
  }

  /** At the start of each frame. more: { level (drawn), chosen, maps: [in, of] or null }. */
  frame(more) {
    if (!this.on) return;
    const now = performance.now(), info = this.gl.info.render;
    if (this.last) this.stats.add(now - this.last);
    this.last = now;
    if (info.calls) { this.draws = info.calls; this.tris = info.triangles; }
    this.gl.info.reset();
    if (now - this.shown < 500) return;
    this.shown = now;
    const s = this.stats.read(), fps = Math.round(s.fps);
    const tone = fps >= 55 ? 'ok' : fps >= 40 ? 'mid' : 'bad', wt = s.worst > 100 ? 'bad' : s.worst > 50 ? 'mid' : 'ok';
    const level = more.level + (more.chosen && more.chosen !== more.level ? ` (set: ${more.chosen})` : '');
    // (four short lines: it shares the top of the screen with the messages)
    this.el.innerHTML = `<b class="${tone}">${fps} fps</b> ${s.ms < 1000 ? s.ms.toFixed(1) : Math.round(s.ms)} ms`
      + `<br>worst <b class="${wt}">${Math.round(s.worst)} ms</b> · ${s.late} late in 10 s`
      + `<br>${level} · ${big(this.draws)} draws · ${big(this.tris)} tris`
      + (more.maps ? `<br>maps ${more.maps[0]}/${more.maps[1]} loading` : '');
  }
}
