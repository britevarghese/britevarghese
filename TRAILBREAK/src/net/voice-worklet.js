// Voice capture for the server relay (net/Voice.js): the microphone at the context's rate, averaged down to 16 kHz and
// posted 40 ms (640 samples, 16-bit) at a time.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.buf = new Int16Array(640);
    this.n = 0; this.pos = 0; this.acc = 0; this.cnt = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++;
      if (++this.pos < this.step) continue;
      this.pos -= this.step;
      const v = Math.round((this.acc / this.cnt) * 32767);
      this.acc = 0; this.cnt = 0;
      this.buf[this.n++] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
      if (this.n === 640) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Int16Array(640); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
