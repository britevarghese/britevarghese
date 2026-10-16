// Voice chat in a room: the players who join it talk to each other. Each pair links directly (WebRTC: Opus, echo
// cancellation, the browser's own jitter buffer), the room server passing on their offers. Where two networks can't
// reach each other (no direct link after a few seconds, or it fails), that pair's audio goes through the server
// instead: 40 ms frames of 16 kHz speech in 4-bit ADPCM (64 kbit/s, only while talking), played from a short buffer.
//
// The microphone is open (V mutes it) or push-to-talk (hold V). You can mute yourself, mute everyone, and mute or turn
// down each player; the players list shows who is talking. Voices stay on with the game paused or in another tab.

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const LINK_WAIT = 9000;             // ms to make a direct link before going through the server
const RATE = 16000;                 // relayed audio
const TALK = 0.012;                 // RMS over which someone is talking
const HANG = 0.45;                  // s a voice counts as talking (and the relay keeps sending) after the last loud bit

// ---------------------------------------------------------------- IMA ADPCM (the relay's codec)
const STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132,
  7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const IDX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/** 16-bit samples -> 3 bytes of state (predictor, step index: each frame decodes on its own) and 4 bits a sample. */
export function adpcmEncode(pcm, st) {
  const out = new Uint8Array(3 + ((pcm.length + 1) >> 1));
  let pred = st.pred, index = st.index;
  out[0] = pred & 255; out[1] = (pred >> 8) & 255; out[2] = index;
  for (let i = 0; i < pcm.length; i++) {
    const step = STEP[index];
    let diff = pcm[i] - pred, code = 0, delta = step >> 3;
    if (diff < 0) { code = 8; diff = -diff; }
    if (diff >= step) { code |= 4; diff -= step; delta += step; }
    if (diff >= step >> 1) { code |= 2; diff -= step >> 1; delta += step >> 1; }
    if (diff >= step >> 2) { code |= 1; delta += step >> 2; }
    pred += code & 8 ? -delta : delta;
    pred = pred < -32768 ? -32768 : pred > 32767 ? 32767 : pred;
    index += IDX[code]; index = index < 0 ? 0 : index > 88 ? 88 : index;
    if (i & 1) out[3 + (i >> 1)] |= code << 4; else out[3 + (i >> 1)] = code;
  }
  st.pred = pred; st.index = index;
  return out;
}

/** The other way: bytes (as adpcmEncode made them) -> n samples in -1..1. */
export function adpcmDecode(bytes, n = (bytes.length - 3) * 2) {
  const out = new Float32Array(n);
  let pred = bytes[0] | (bytes[1] << 8), index = Math.min(88, bytes[2]);
  if (pred > 32767) pred -= 65536;
  for (let i = 0; i < n; i++) {
    const code = (bytes[3 + (i >> 1)] >> ((i & 1) * 4)) & 15, step = STEP[index];
    let delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;
    pred += code & 8 ? -delta : delta;
    pred = pred < -32768 ? -32768 : pred > 32767 ? 32767 : pred;
    index += IDX[code]; index = index < 0 ? 0 : index > 88 ? 88 : index;
    out[i] = pred / 32768;
  }
  return out;
}

// ---------------------------------------------------------------- the voice chat
export class Voice {
  /** net: the room's NetClient. */
  constructor(net) {
    this.net = net;
    this.joined = false;
    this.mode = 'open';               // 'open' (V mutes) or 'ptt' (hold V)
    this.selfMuted = false;
    this.deaf = false;                // everyone muted
    this.volume = 1;
    this.ptt = false;                 // push-to-talk held
    this.peers = new Map();           // player id -> { name, voice, mic, mute, pc, link, muted, vol, level, heard, ... }
    this.mic = null; this.track = null;
    this.ctx = null;
    this.level = 0; this.talkT = -9;
    this.micNote = '';
    this.seq = 0; this.enc = { pred: 0, index: 0 }; this.loudT = -9;
    this.onChange = null;
    for (const r of net.remotes.values()) this.peer(r.id, r.name, r.voice, r.mic, r.mute);
  }

  /** Whether our microphone is going out now. */
  get talking() { return this.joined && !!this.track && !this.selfMuted && (this.mode === 'open' || this.ptt); }
  get now() { return performance.now() / 1000; }
  /** Whether we, or player p, spoke just now. */
  speaking(p) { return p ? this.now - p.heard < HANG : this.now - this.talkT < HANG; }
  get others() { return [...this.peers.values()]; }

  peer(id, name, voice, mic, mute) {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, name: 'Driver', voice: false, mic: false, mute: false, pc: null, link: 'off', muted: false, vol: 1, level: 0, heard: -9, next: 0 };
      this.peers.set(id, p);
    }
    p.name = name || this.net.remotes.get(id)?.name || p.name;
    if (voice !== undefined) { p.voice = !!voice; p.mic = !!mic; p.mute = !!mute; }
    return p;
  }

  changed() { this.onChange?.(); }

  // ---- joining and leaving
  async join() {
    if (this.joined) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) {
      const ctx = this.ctx = new AC();
      // a browser that holds the sound back until a touch or a key (joined from the game loop) lets it go then
      const wake = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
      addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
    }
    this.ctx.resume?.().catch(() => {});
    this.joined = true;
    this.micNote = '';
    this.changed();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'Insecure' });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (!this.joined) { mic.getTracks().forEach((t) => t.stop()); return; }     // left while the browser asked
      this.mic = mic; this.track = mic.getAudioTracks()[0];
      this.micAn = this.ctx.createAnalyser(); this.micAn.fftSize = 512;
      this.ctx.createMediaStreamSource(mic).connect(this.micAn);
    } catch (e) {
      if (!this.joined) return;
      this.micNote = e.name === 'Insecure' ? 'Talking needs the https:// address: you can listen'
        : e.name === 'NotAllowedError' ? 'The browser blocked the microphone: you can listen' : 'No microphone found: you can listen';
    }
    this.applyTalk();
    for (const p of this.peers.values()) if (p.voice) this.link(p);
    this.changed();
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.net.send({ t: 'voice', on: 0 });
    for (const p of this.peers.values()) { this.unlink(p); p.gain?.disconnect(); p.gain = null; p.an = null; }
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null; this.track = null; this.micAn = null;
    this.capture?.port.close(); this.capture?.disconnect(); this.capture = null;
    this.captureSrc?.disconnect(); this.captureSrc = null;
    this.changed();
  }

  // ---- the controls
  setMode(mode) { this.mode = mode === 'ptt' ? 'ptt' : 'open'; this.applyTalk(); }
  setSelfMuted(on) { this.selfMuted = !!on; this.applyTalk(); }
  setPtt(on) { if (this.ptt !== !!on) { this.ptt = !!on; this.applyTalk(); } }
  setDeaf(on) { this.deaf = !!on; for (const p of this.peers.values()) this.applyVolume(p); this.changed(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(2, v)); for (const p of this.peers.values()) this.applyVolume(p); }
  setPeerMuted(id, on) { const p = this.peers.get(id); if (p) { p.muted = !!on; this.applyVolume(p); this.changed(); } }
  setPeerVolume(id, v) { const p = this.peers.get(id); if (p) { p.vol = Math.max(0, Math.min(2, v)); this.applyVolume(p); } }

  /** The microphone on or off for what the controls say; everyone told whether we have one and whether it's muted. */
  applyTalk() {
    if (this.track) this.track.enabled = this.talking;
    if (this.joined) {
      const mute = this.selfMuted || (this.mode === 'ptt' && !this.ptt) ? 1 : 0;
      const key = `${this.track ? 1 : 0}${mute}`;
      if (key !== this.sentKey || !this.announced) { this.sentKey = key; this.announced = true; this.net.send({ t: 'voice', on: 1, mic: this.track ? 1 : 0, mute }); }
    } else this.announced = false;
    this.changed();
  }

  applyVolume(p) { if (p.gain) p.gain.gain.value = this.deaf || p.muted ? 0 : this.volume * p.vol; }

  // ---- the direct links
  link(p) {
    if (p.pc || !this.joined || !p.voice) return;
    if (!window.RTCPeerConnection) { this.toRelay(p); return; }
    const pc = p.pc = new RTCPeerConnection({ iceServers: ICE });
    p.link = 'connecting';
    pc.ontrack = (e) => this.hear(p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (p.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') { p.link = 'direct'; clearTimeout(p.waitT); clearTimeout(p.dropT); }
      else if (s === 'failed') this.toRelay(p);
      else if (s === 'disconnected') { clearTimeout(p.dropT); p.dropT = setTimeout(() => { if (p.pc === pc && pc.connectionState !== 'connected') this.toRelay(p); }, 4000); }
      this.changed();
    };
    p.waitT = setTimeout(() => { if (p.pc === pc && p.link !== 'direct') this.toRelay(p); }, LINK_WAIT);
    // the lower id offers (both sides learn of each other at once: only one may)
    if (this.net.id < p.id) this.offer(p).catch((e) => { console.warn('voice offer', e); this.toRelay(p); });
  }

  async offer(p) {
    const pc = p.pc;
    p.tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    await p.tx.sender.replaceTrack(this.track);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (p.pc === pc) this.net.send({ t: 'rtc', to: p.id, d: { type: 'offer', sdp: pc.localDescription.sdp } });
  }

  async signal(from, d) {
    const p = this.peers.get(from);
    if (!p || !this.joined || !d || typeof d.sdp !== 'string') return;
    try {
      if (d.type === 'offer') {
        if (p.pc && p.pc.signalingState !== 'stable') this.unlink(p);        // a fresh offer: start this link over
        if (p.pc && p.pc.remoteDescription) this.unlink(p);
        p.voice = true;
        this.link(p);
        const pc = p.pc;
        await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
        p.tx = pc.getTransceivers()[0];
        if (p.tx) { p.tx.direction = 'sendrecv'; await p.tx.sender.replaceTrack(this.track); }
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        if (p.pc === pc) this.net.send({ t: 'rtc', to: p.id, d: { type: 'answer', sdp: pc.localDescription.sdp } });
      } else if (d.type === 'answer' && p.pc?.signalingState === 'have-local-offer') {
        await p.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      }
    } catch (e) { console.warn('voice link', e); this.toRelay(p); }
  }

  unlink(p) {
    clearTimeout(p.waitT); clearTimeout(p.dropT);
    if (p.pc) { p.pc.ontrack = p.pc.onconnectionstatechange = null; p.pc.close(); }
    p.pc = null; p.tx = null;
    p.src?.disconnect(); p.src = null;
    if (p.el) p.el.srcObject = null;
    p.link = 'off';
  }

  /** No direct link to p: its audio and ours go through the server. */
  toRelay(p) {
    if (!this.joined || !p.voice) return;
    clearTimeout(p.waitT);
    p.link = 'relay';
    this.startRelay();
    this.changed();
  }

  /** A player's sound out: through their gain (volume, mute) to the speakers, and a meter for who is talking. */
  out(p) {
    if (p.gain) return;
    p.gain = this.ctx.createGain(); p.gain.connect(this.ctx.destination);
    p.an = this.ctx.createAnalyser(); p.an.fftSize = 512;
    this.applyVolume(p);
  }

  hear(p, stream) {
    // (Chrome plays a remote stream through Web Audio only while a media element holds it too: a muted one)
    if (!p.el) { p.el = new window.Audio(); p.el.muted = true; p.el.autoplay = true; p.el.playsInline = true; }
    p.el.srcObject = stream;
    p.el.play?.().catch(() => {});
    this.out(p);
    p.src?.disconnect();
    p.src = this.ctx.createMediaStreamSource(stream);
    p.src.connect(p.gain); p.src.connect(p.an);
  }

  // ---- the server relay
  async startRelay() {
    if (!this.track || this.capture || this.starting || !this.ctx.audioWorklet) return;
    this.starting = true;
    try {
      await this.ctx.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
      if (!this.track || this.capture) return;
      this.captureSrc = this.ctx.createMediaStreamSource(this.mic);
      this.capture = new AudioWorkletNode(this.ctx, 'voice-capture');
      this.capture.port.onmessage = (e) => this.sendFrame(e.data);
      const hush = this.ctx.createGain(); hush.gain.value = 0;              // (a worklet runs only while it reaches the output)
      this.captureSrc.connect(this.capture).connect(hush).connect(this.ctx.destination);
    } catch (e) { console.warn('voice relay', e); } finally { this.starting = false; }
  }

  sendFrame(pcm) {
    if (!this.talking || !this.others.some((p) => p.voice && p.link === 'relay')) return;
    let e = 0;
    for (let i = 0; i < pcm.length; i += 2) e += pcm[i] * pcm[i];
    const now = this.now;
    if (Math.sqrt(e / (pcm.length / 2)) / 32768 > TALK * 0.7 || this.mode === 'ptt') this.loudT = now;
    if (now - this.loudT > HANG) { this.enc.pred = 0; this.enc.index = 0; return; }         // quiet: nothing to send
    const a = adpcmEncode(pcm, this.enc), out = new Uint8Array(3 + a.length);
    out[0] = 1; out[1] = (this.seq >> 8) & 255; out[2] = this.seq & 255;
    this.seq = (this.seq + 1) & 0xffff;
    out.set(a, 3);
    this.net.sendBinary(out);
  }

  /** A relayed frame from the server: [1, id hi, id lo, seq hi, seq lo, ADPCM...]. */
  onBinary(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 9 || b[0] !== 1 || !this.joined) return;
    const p = this.peers.get((b[1] << 8) | b[2]);
    if (!p || p.link === 'direct') return;                                  // (heard directly already)
    const pcm = adpcmDecode(b.subarray(5));
    this.out(p);
    const ctx = this.ctx, ab = ctx.createBuffer(1, pcm.length, RATE);
    ab.copyToChannel(pcm, 0);
    const s = ctx.createBufferSource();
    s.buffer = ab; s.connect(p.gain); s.connect(p.an);
    const t = ctx.currentTime;
    if (p.next < t + 0.03 || p.next > t + 0.6) p.next = t + 0.15;          // (re)start 150 ms behind: room for jitter
    s.start(p.next);
    p.next += ab.duration;
  }

  // ---- the room's messages and the meters
  onNet(m) {
    if (m.t === 'join') this.peer(m.id, m.name);
    else if (m.t === 'leave') { const p = this.peers.get(m.id); if (p) { this.unlink(p); p.gain?.disconnect(); this.peers.delete(m.id); } }
    else if (m.t === 'voice') {
      const p = this.peer(m.id, null, m.on, m.mic, m.mute);
      if (p.voice) this.link(p); else this.unlink(p);
    } else if (m.t === 'rtc') { this.signal(m.from, m.d); return; }
    else return;
    this.changed();
  }

  /** Each frame: who is talking. */
  update() {
    if (!this.joined) return;
    const now = this.now;
    this.level = this.micAn && this.talking ? meter(this.micAn) : 0;
    if (this.level > TALK) this.talkT = now;
    for (const p of this.peers.values()) if (p.an) { p.level = meter(p.an); if (p.level > TALK) p.heard = now; }
  }
}

/** Wait for the ICE candidates to be gathered (sent with the offer or answer in one go), at most 2.5 s. */
function gathered(pc) {
  return new Promise((done) => {
    if (pc.iceGatheringState === 'complete') { done(); return; }
    const t = setTimeout(done, 2500);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
  });
}

const BUF = new Float32Array(512);
function meter(an) {
  an.getFloatTimeDomainData(BUF);
  let e = 0;
  for (let i = 0; i < BUF.length; i++) e += BUF[i] * BUF[i];
  return Math.sqrt(e / BUF.length);
}
