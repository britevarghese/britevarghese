'use strict';
/**
 * A self-signed certificate for the HTTPS side of the server, made with Node's own crypto (the server has no npm
 * dependencies). Browsers give wheels and gamepads only to secure pages: https, or http://localhost. A player on
 * another PC (LAN, Radmin) opening http://<ip> gets no controllers at all; on https://<ip> they do, once they
 * accept the certificate warning (Advanced > Proceed).
 *
 * Kept in a folder the server can write to (beside it, else the user's app data), and made again when it is near
 * its end or this PC's addresses are no longer all on it.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------- DER
const len = (n) => {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  while (n) { b.unshift(n & 255); n >>>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...x) => tlv(0x30, Buffer.concat(x));
const set = (...x) => tlv(0x31, Buffer.concat(x));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = (s) => {
  const p = s.split('.').map(Number), out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 127];
    for (let x = Math.floor(v / 128); x; x = Math.floor(x / 128)) b.unshift((x & 127) | 128);
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const time = (d) => {
  const p2 = (n) => String(n).padStart(2, '0'), y = d.getUTCFullYear();
  const s = p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + s)) : tlv(0x18, Buffer.from(y + s));
};
const explicit = (n, body) => tlv(0xa0 | n, body);
const ext = (id, value) => seq(oid(id), tlv(0x04, value));

/** A new key and self-signed certificate (PEM) for these host names and IP addresses. */
function makeCertificate(names, ips, days = 397) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sigAlg = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));          // sha256WithRSAEncryption
  const name = seq(set(seq(oid('2.5.4.3'), utf8('TRAILBREAK game server'))), set(seq(oid('2.5.4.10'), utf8('TRAILBREAK'))));
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const now = new Date(), from = new Date(now.getTime() - 24 * 3600e3), to = new Date(now.getTime() + days * 24 * 3600e3);
  const san = Buffer.concat([
    ...names.map((n) => tlv(0x82, Buffer.from(n))),                                          // dNSName
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),                   // iPAddress
  ]);
  const extensions = seq(
    ext('2.5.29.19', seq()),                                                                 // basicConstraints: not a CA
    ext('2.5.29.15', tlv(0x03, Buffer.from([0x05, 0xa0]))),                                  // keyUsage: signature, key encipherment
    ext('2.5.29.37', seq(oid('1.3.6.1.5.5.7.3.1'))),                                         // extKeyUsage: serverAuth
    ext('2.5.29.17', seq(san)),                                                              // subjectAltName
  );
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))),                                                      // v3
    int(serial), sigAlg, name, seq(time(from), time(to)), name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, sigAlg, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem };
}

// a folder the server may write to: beside it (a copy unpacked anywhere), else the user's own (an install in
// Program Files)
function certDir(root) {
  const app = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  for (const dir of [path.join(root, 'cert'), path.join(app, 'trailbreak', 'cert')]) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return dir; } catch { /* next */ }
  }
  return null;
}

/**
 * The key and certificate to serve, covering localhost and these IPv4 addresses: the saved one while it still covers
 * them and has a month left, else a new one (saved when it can be).
 */
function loadCertificate(root, ips) {
  const names = ['localhost', os.hostname()].filter(Boolean);
  const want = ['127.0.0.1', ...ips];
  const dir = certDir(root);
  if (dir) {
    try {
      const key = fs.readFileSync(path.join(dir, 'server.key'), 'utf8'), cert = fs.readFileSync(path.join(dir, 'server.crt'), 'utf8');
      const x = new crypto.X509Certificate(cert), alt = x.subjectAltName || '';
      const fresh = new Date(x.validTo).getTime() - Date.now() > 30 * 24 * 3600e3;
      if (fresh && want.every((ip) => alt.includes(`IP Address:${ip}`))) return { key, cert, dir, made: false };
    } catch { /* none yet, or unreadable: make one */ }
  }
  const c = makeCertificate(names, want);
  if (dir) {
    try { fs.writeFileSync(path.join(dir, 'server.key'), c.key, { mode: 0o600 }); fs.writeFileSync(path.join(dir, 'server.crt'), c.cert); } catch { /* served from memory */ }
  }
  return { ...c, dir, made: true };
}

module.exports = { makeCertificate, loadCertificate };
