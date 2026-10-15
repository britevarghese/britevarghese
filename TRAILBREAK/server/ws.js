'use strict';
/*
 * Minimal RFC 6455 WebSocket server, zero dependencies.
 * Supports: handshake, text/binary frames, client masking, fragmentation,
 * ping/pong, close handshake, payload size limit.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };
const MAX_PAYLOAD = 1 << 20; // 1 MiB per message

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode; server frames are never masked
  return Buffer.concat([header, payload]);
}

class WebSocketConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.remoteAddress = socket.remoteAddress;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.fragments = null; // { opcode, parts: [], size }
    this.closeSent = false;
    this.isAlive = true;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish(1006, ''));
    socket.on('error', () => this._finish(1006, ''));
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      while (this.open && this._parseFrame()) { /* keep parsing */ }
    } catch (e) {
      this.close(e.code || 1002, e.message);
    }
  }

  // Returns true if a full frame was consumed.
  _parseFrame() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const rsv = b[0] & 0x70;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (rsv) throw Object.assign(new Error('RSV bits set'), { code: 1002 });
    if (!masked) throw Object.assign(new Error('client frames must be masked'), { code: 1002 });
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_PAYLOAD)) throw Object.assign(new Error('message too big'), { code: 1009 });
      len = Number(big);
      off = 10;
    }
    if (len > MAX_PAYLOAD) throw Object.assign(new Error('message too big'), { code: 1009 });
    if (b.length < off + 4 + len) return false;
    const mask = b.subarray(off, off + 4);
    off += 4;
    const payload = Buffer.from(b.subarray(off, off + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + len);

    const isControl = opcode >= 0x8;
    if (isControl) {
      if (!fin || len > 125) throw Object.assign(new Error('bad control frame'), { code: 1002 });
      this._onControl(opcode, payload);
      return true;
    }

    if (opcode === OP.CONT) {
      if (!this.fragments) throw Object.assign(new Error('unexpected continuation'), { code: 1002 });
      this.fragments.parts.push(payload);
      this.fragments.size += len;
      if (this.fragments.size > MAX_PAYLOAD) throw Object.assign(new Error('message too big'), { code: 1009 });
      if (fin) {
        const { opcode: op, parts } = this.fragments;
        this.fragments = null;
        this._deliver(op, Buffer.concat(parts));
      }
      return true;
    }

    if (opcode !== OP.TEXT && opcode !== OP.BIN) {
      throw Object.assign(new Error('unknown opcode'), { code: 1002 });
    }
    if (this.fragments) throw Object.assign(new Error('expected continuation'), { code: 1002 });
    if (fin) this._deliver(opcode, payload);
    else this.fragments = { opcode, parts: [payload], size: len };
    return true;
  }

  _onControl(opcode, payload) {
    if (opcode === OP.PING) {
      this._write(encodeFrame(OP.PONG, payload));
    } else if (opcode === OP.PONG) {
      this.isAlive = true;
    } else if (opcode === OP.CLOSE) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
      if (!this.closeSent) {
        this.closeSent = true;
        this._write(encodeFrame(OP.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0)));
      }
      this.socket.end();
      this._finish(code, reason);
    }
  }

  _deliver(opcode, data) {
    if (opcode === OP.TEXT) this.emit('message', data.toString('utf8'), false);
    else this.emit('message', data, true);
  }

  _write(buf) {
    if (!this.socket.destroyed && this.socket.writable) this.socket.write(buf);
  }

  send(data) {
    if (!this.open) return;
    if (typeof data === 'string') this._write(encodeFrame(OP.TEXT, Buffer.from(data, 'utf8')));
    else this._write(encodeFrame(OP.BIN, Buffer.from(data)));
  }

  ping() {
    if (!this.open) return;
    this.isAlive = false;
    this._write(encodeFrame(OP.PING, Buffer.alloc(0)));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    if (!this.closeSent) {
      this.closeSent = true;
      const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      this._write(encodeFrame(OP.CLOSE, p));
    }
    // Give the peer a moment to answer, then hard close.
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.socket.end();
    this._finish(code, reason);
  }

  terminate() {
    this.socket.destroy();
    this._finish(1006, 'terminated');
  }

  _finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    this.emit('close', code, reason);
  }
}

/**
 * Attach a WebSocket endpoint to an http.Server.
 * options: { path: '/ws', enabled: () => boolean, onConnection(ws, req) }
 */
function attachWebSocketServer(httpServer, options) {
  const path = options.path || '/ws';
  const clients = new Set();

  httpServer.on('upgrade', (req, socket) => {
    const reject = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const url = (req.url || '').split('?')[0];
    if (url !== path) return reject(404, 'Not Found');
    if (options.enabled && !options.enabled()) return reject(403, 'Forbidden');
    const key = req.headers['sec-websocket-key'];
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    if (req.method !== 'GET' || upgrade !== 'websocket' || !key ||
        req.headers['sec-websocket-version'] !== '13') {
      return reject(400, 'Bad Request');
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const ws = new WebSocketConnection(socket, req);
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    options.onConnection(ws, req);
  });

  // Heartbeat: drop clients that stop answering pings.
  const hb = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.ping();
    }
  }, 15000);
  hb.unref();

  return { clients, close: () => { clearInterval(hb); for (const ws of clients) ws.close(1001, 'server shutdown'); } };
}

module.exports = { attachWebSocketServer, WebSocketConnection };
