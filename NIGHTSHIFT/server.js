#!/usr/bin/env node
'use strict';
/*
 * NIGHTSHIFT game server.
 * Zero npm dependencies: Node.js >= 18 built-ins only.
 *
 *   node server.js [--port 3000] [--host 0.0.0.0] [--multiplayer] [--config path] [--verbose]
 *
 * Serves public/ at "/" and src/ at "/src/". Optional multiplayer WebSocket at "/ws".
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { attachWebSocketServer } = require('./server/ws');
const { Room } = require('./server/room');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SRC_DIR = path.join(ROOT, 'src');
const START_TIME = Date.now();

// ---------------------------------------------------------------- config

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (key) {
      case '--port': case '-p': out.port = next(); break;
      case '--host': case '-h': out.host = next(); break;
      case '--config': out.config = next(); break;
      case '--multiplayer': case '--mp': out.multiplayer = true; break;
      case '--no-multiplayer': out.multiplayer = false; break;
      case '--verbose': case '-v': out.verbose = true; break;
      case '--help':
        console.log('Usage: node server.js [--port 3000] [--host 0.0.0.0] [--multiplayer] [--config config.json] [--verbose]');
        process.exit(0);
        break;
      default:
        console.warn(`Ignoring unknown argument: ${a}`);
    }
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Warning: could not read ${path.basename(file)}: ${e.message}`);
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const fileConfig = readJson(args.config ? path.resolve(args.config) : path.join(ROOT, 'config.json')) || {};
const pkg = readJson(path.join(ROOT, 'package.json')) || {};

const config = {
  port: Number(args.port ?? process.env.PORT ?? fileConfig.port ?? 3000),
  host: String(args.host ?? process.env.HOST ?? fileConfig.host ?? '0.0.0.0'),
  serverName: fileConfig.serverName || 'NIGHTSHIFT Server',
  multiplayer: {
    enabled: false,
    tickRate: 20,
    maxPlayers: 8,
    ...(fileConfig.multiplayer || {}),
  },
  verbose: !!args.verbose,
};
if (args.multiplayer !== undefined) config.multiplayer.enabled = args.multiplayer;
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  console.error(`Invalid port "${args.port ?? process.env.PORT ?? fileConfig.port}". Use a number between 1 and 65535.`);
  process.exit(1);
}

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.gltf', '.txt', '.md']);
const LONG_CACHE = new Set(['.glb', '.gltf', '.bin', '.ktx2', '.png', '.jpg', '.jpeg', '.webp', '.ogg', '.mp3', '.m4a', '.wav', '.woff2', '.ico', '.wasm']);
const MAX_COMPRESS_SIZE = 32 * 1024 * 1024;

// Compressed bytes cache: key = encoding|path|mtime|size
const compressCache = new Map();
let compressCacheBytes = 0;
const COMPRESS_CACHE_LIMIT = 128 * 1024 * 1024;

function getCompressed(file, stat, encoding) {
  const key = `${encoding}|${file}|${stat.mtimeMs}|${stat.size}`;
  const hit = compressCache.get(key);
  if (hit) {
    compressCache.delete(key); compressCache.set(key, hit); // LRU bump
    return hit;
  }
  const raw = fs.readFileSync(file);
  const out = encoding === 'br'
    ? zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    })
    : zlib.gzipSync(raw, { level: 9 });
  // Drop stale versions of the same file.
  for (const k of compressCache.keys()) {
    if (k.startsWith(`${encoding}|${file}|`)) { compressCacheBytes -= compressCache.get(k).length; compressCache.delete(k); }
  }
  compressCache.set(key, out);
  compressCacheBytes += out.length;
  while (compressCacheBytes > COMPRESS_CACHE_LIMIT && compressCache.size > 1) {
    const oldest = compressCache.keys().next().value;
    compressCacheBytes -= compressCache.get(oldest).length;
    compressCache.delete(oldest);
  }
  return out;
}

function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  const accepts = (name) => new RegExp(`(^|,)\\s*${name}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$))[\\d.]+)?\\s*(,|$)`, 'i').test(ae);
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return null;
}

/** Map a URL pathname to a file inside public/ or src/, or null if outside. */
function resolvePath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  let base = PUBLIC_DIR;
  let rel = decoded;
  if (decoded === '/src' || decoded.startsWith('/src/')) {
    base = SRC_DIR;
    rel = decoded.slice(4);
  }
  const full = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function sendText(res, status, text, extra = {}) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...extra });
  res.end(body);
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let file = resolvePath(pathname);
  if (!file) return sendText(res, 403, '403 Forbidden');

  let stat;
  try {
    stat = fs.statSync(file);
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        return res.end();
      }
      file = path.join(file, 'index.html');
      stat = fs.statSync(file);
    }
  } catch {
    return sendText(res, 404, `404 Not Found: ${pathname}`);
  }
  if (!stat.isFile()) return sendText(res, 404, `404 Not Found: ${pathname}`);

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': LONG_CACHE.has(ext) ? 'public, max-age=86400' : 'no-cache',
  };

  const compressible = COMPRESSIBLE.has(ext) && stat.size > 256 && stat.size <= MAX_COMPRESS_SIZE;
  const encoding = compressible ? pickEncoding(req) : null;
  const baseTag = `${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
  const etag = `"${baseTag}${encoding ? '-' + encoding : ''}"`;
  headers.ETag = etag;
  if (compressible) headers.Vary = 'Accept-Encoding';

  const inm = req.headers['if-none-match'];
  if (inm && (inm === '*' || inm.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(etag))) {
    res.writeHead(304, headers);
    return res.end();
  }

  if (encoding) {
    let body;
    try { body = getCompressed(file, stat, encoding); } catch (e) {
      return sendText(res, 500, '500 Internal Server Error');
    }
    headers['Content-Encoding'] = encoding;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  // Uncompressed: stream, with single-range support (useful for audio seeking).
  headers['Accept-Ranges'] = 'bytes';
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range && stat.size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = parseInt(m[1], 10); if (m[2]) end = Math.min(parseInt(m[2], 10), end); } else { start = Math.max(0, stat.size - parseInt(m[2], 10)); }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
  }
  headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || stat.size === 0) return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// ---------------------------------------------------------------- HTTP server

function publicConfig() {
  return {
    serverName: config.serverName,
    version: pkg.version || '0.0.0',
    multiplayer: {
      enabled: !!config.multiplayer.enabled,
      tickRate: config.multiplayer.tickRate,
      maxPlayers: config.multiplayer.maxPlayers,
      path: '/ws',
    },
  };
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return sendText(res, 400, '400 Bad Request');
  }
  if (config.verbose) console.log(`${req.socket.remoteAddress} ${req.method} ${req.url}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  if (pathname === '/api/config') return sendJson(res, 200, publicConfig());
  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      uptime: Math.round((Date.now() - START_TIME) / 1000),
      players: room ? room.players.size : 0,
    });
  }
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'not found' });

  try {
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error('Request error:', e);
    if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
    else res.destroy();
  }
});

// ---------------------------------------------------------------- multiplayer

const room = new Room({
  tickRate: config.multiplayer.tickRate,
  maxPlayers: config.multiplayer.maxPlayers,
  log: (m) => console.log(m),
});
const wss = attachWebSocketServer(server, {
  path: '/ws',
  enabled: () => !!config.multiplayer.enabled,
  onConnection: (ws) => room.addConnection(ws),
});
if (config.multiplayer.enabled) room.start();

// ---------------------------------------------------------------- startup

function classify(ip) {
  const [a, b] = ip.split('.').map(Number);
  if (a === 26) return 'RADMIN';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'LAN';
  if (a === 100 && b >= 64 && b <= 127) return 'VPN';
  return 'NETWORK';
}

function networkAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      const v4 = info.family === 'IPv4' || info.family === 4;
      if (v4 && !info.internal) out.push({ ip: info.address, kind: classify(info.address), name });
    }
  }
  const order = { LAN: 0, RADMIN: 1, VPN: 2, NETWORK: 3 };
  return out.sort((x, y) => order[x.kind] - order[y.kind]);
}

function banner() {
  const port = config.port;
  const line = '========================================';
  const row = (label, value) => ` ${(label + ':').padEnd(7)} ${value}`;
  const lines = [line, ' NIGHTSHIFT SERVER', line, ' Server started.'];
  const wildcard = ['0.0.0.0', '::', ''].includes(config.host);
  const local = wildcard || ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (local) lines.push(row('LOCAL', `http://localhost:${port}`));
  if (wildcard) {
    const addrs = networkAddresses();
    for (const a of addrs) lines.push(row(a.kind, `http://${a.ip}:${port}`));
    if (addrs.length === 0) lines.push(' (no network adapters found - only this PC can connect)');
  } else if (!local) {
    lines.push(row(classify(config.host), `http://${config.host}:${port}`));
  }
  lines.push(row('PORT', String(port)));
  if (config.multiplayer.enabled) {
    lines.push(row('MULTI', `enabled, ws path /ws, ${config.multiplayer.tickRate} Hz, max ${config.multiplayer.maxPlayers}`));
  }
  lines.push(line);
  lines.push(' Players open one of the URLs above in Chrome, Edge or Firefox.');
  lines.push(' Press Ctrl+C to stop.');
  return lines.join('\n');
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`ERROR: Port ${config.port} is already in use.`);
    console.error('Another program (or another copy of this server) is using it.');
    console.error('Close that program, or start on another port, for example:');
    console.error(`    start.bat --port ${config.port + 1}`);
    console.error(`    node server.js --port ${config.port + 1}`);
    console.error('or change "port" in config.json.');
  } else if (err.code === 'EACCES') {
    console.error(`ERROR: No permission to use port ${config.port}. Try a port above 1024, e.g. --port 3000.`);
  } else if (err.code === 'EADDRNOTAVAIL') {
    console.error(`ERROR: Host address ${config.host} is not available on this machine. Use --host 0.0.0.0.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  console.warn('Warning: public/index.html not found - the game page will not load.');
}

server.listen(config.port, config.host, () => console.log(banner()));

function shutdown() {
  console.log('\nStopping NIGHTSHIFT server...');
  room.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
