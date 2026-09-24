// Host a game from your own PC and give friends anywhere a public https link (Cloudflare quick tunnel,
// no account, no port forwarding):   npm run share
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Tunnel, bin, install } from 'cloudflared';

const PORT = process.env.PORT || 3000;
if (!fs.existsSync(bin)) { console.log('Downloading cloudflared…'); await install(bin); }
const server = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT } });
await new Promise((r) => setTimeout(r, 2500));
const t = Tunnel.quick(`http://localhost:${PORT}`);
t.once('url', (url) => {
  console.log('\n================================================================');
  console.log(' STRIKEPOINT is online. Send this link to your friends:');
  console.log(`   ${url}`);
  console.log(' Private room invite links look like  ' + url + '/?room=CODE');
  console.log(' (link lives as long as this window stays open)');
  console.log('================================================================\n');
});
t.on('error', (e) => console.error('tunnel error:', e.message));
const stop = () => { t.stop(); server.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', (c) => { t.stop(); process.exit(c ?? 0); });
