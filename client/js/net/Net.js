// WebSocket client with a snapshot interpolation buffer (render remote entities ~100 ms in the past).
export class Net {
  constructor() {
    this.ws = null; this.handlers = {}; this.snaps = []; this.offset = 0; this.connected = false;
    this.interpDelay = 110;
  }

  connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => { this.connected = true; res(); };
      ws.onerror = (e) => rej(e);
      ws.onclose = () => { this.connected = false; this.handlers.close?.(); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'snap') {
          // server clock offset estimate (smoothed, one-way latency folded in)
          const off = m.time - performance.now();
          this.offset = this.snaps.length ? this.offset * 0.95 + off * 0.05 : off;
          this.snaps.push(m);
          if (this.snaps.length > 40) this.snaps.shift();
        } else if (m.t === 'ping') { this.send({ t: 'pong', s: m.s }); return; }
        (this.handlers[m.t] || (() => {}))(m);
      };
    });
  }

  on(t, fn) { this.handlers[t] = fn; }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  serverNow() { return performance.now() + this.offset; }

  // returns { a, b, k } bracketing render time
  sample() {
    const t = this.serverNow() - this.interpDelay;
    const S = this.snaps;
    if (S.length < 2) return S.length ? { a: S[0], b: S[0], k: 0 } : null;
    for (let i = S.length - 1; i > 0; i--) {
      if (S[i - 1].time <= t) {
        const a = S[i - 1], b = S[i];
        return { a, b, k: Math.max(0, Math.min(1.2, (t - a.time) / Math.max(1, b.time - a.time))) };
      }
    }
    return { a: S[0], b: S[0], k: 0 };
  }
}
