// TRAILBREAK for Windows: the game in its own window, served on this PC by the game's own server (../server.js, run in
// a utility process of the app), so it plays offline, with its saves kept from one launch to the next.
//
// The server listens on a fixed port on 127.0.0.1: the game keeps its settings and career in the page's storage, which
// is kept per address, so the same address every launch keeps them. Hosting a game for friends on the same network
// (the game's Esc menu, or the Multiplayer menu) has it listen on every network instead, on the same port, without
// reloading the game (a room on it reconnects by itself), and the game hands its friends the network address in its
// invite link (preload.js). Joining a friend's game, or an online server's, loads that address in the window instead
// (its own saves); the app accepts the self-signed certificate of the address you gave it.
//
// It keeps itself up to date: a newer release on GitHub (package.json build.publish) downloads in the background and
// installs when the game is closed.
//
// No menu shortcuts on letter keys: W drives and Ctrl changes down a gear, so Ctrl+W must not close the window.
'use strict';
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');

/** Where the game's files are: next to the app once installed (resources/game), the repository's when run from it. */
const GAME = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, '..');
const ICON = path.join(__dirname, 'build', 'icon.png');
/** The port the game is served on (the next free one up from it if something else has it). */
const PORT = 47610;

let win = null, server = null, port = PORT, hosting = false, joined = null, quitting = false;

// a laptop with two graphics chips runs the game on the faster one (Chromium otherwise takes the one that saves power)
app.commandLine.appendSwitch('force_high_performance_gpu');
// the same id as the installer's shortcuts (package.json build.appId), so a pinned TRAILBREAK is the window's own icon
if (process.platform === 'win32') app.setAppUserModelId('app.trailbreak.game');

// ---------------------------------------------------------------- the app's own settings (where it last played)
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function writeSettings(s) { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch { /* not kept */ } }

// ---------------------------------------------------------------- the game's server
/** Whether a port is free to listen on at this host. */
function portFree(p, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, host, () => s.close(() => resolve(true)));
  });
}

/** Wait for the server to answer on its health address. */
function whenUp(p, ms = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port: p, path: '/api/health', timeout: 1500 }, (res) => { res.resume(); resolve(); });
      req.on('error', () => (Date.now() - t0 > ms ? reject(new Error('the game server did not start')) : setTimeout(tryOnce, 150)));
      req.on('timeout', () => req.destroy());
    };
    tryOnce();
  });
}

function stopServer() {
  if (!server) return Promise.resolve();
  const s = server; server = null;
  return new Promise((resolve) => { s.once('exit', () => resolve()); s.kill(); setTimeout(resolve, 2000); });
}

/** Start the game's server: on this PC alone, or (lan) on every network for friends to join. */
async function startServer(lan) {
  await stopServer();
  const host = lan ? '0.0.0.0' : '127.0.0.1';
  // (the port it had, so the game in the window stays where it is; else the first free one from PORT)
  if (!(await portFree(port, host))) { port = PORT; while (!(await portFree(port, host)) && port < PORT + 20) port++; }
  const log = [];
  server = utilityProcess.fork(path.join(GAME, 'server.js'), ['--port', String(port), '--host', host, '--multiplayer'], {
    cwd: GAME, stdio: 'pipe', serviceName: 'TRAILBREAK game server',
  });
  for (const s of [server.stdout, server.stderr]) s?.on('data', (d) => { log.push(String(d)); if (log.length > 40) log.shift(); });
  const proc = server;
  proc.once('exit', (code) => {
    if (proc !== server || quitting) return;
    server = null;
    dialog.showErrorBox('TRAILBREAK', `The game's server stopped (code ${code}).\n\n${log.join('').slice(-1500)}`);
  });
  await whenUp(port);
  hosting = lan;
}

/** The addresses friends on this PC's networks can reach it at. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

// ---------------------------------------------------------------- the window
const localUrl = () => `http://127.0.0.1:${port}/`;

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540, show: false, backgroundColor: '#0b0f14', title: 'TRAILBREAK',
    icon: ICON, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
      // (the audio may start at once; the game pauses itself when its window is hidden)
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
    },
  });
  win.maximize();
  win.once('ready-to-show', () => win.show());
  // (links out of the game open in the browser; the game stays in its window)
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  // (a page loaded again, or a friend's game joined, hears of an update that's ready too)
  win.webContents.on('did-finish-load', () => { if (updateReady) win?.webContents.send('update-ready', updateReady); });
  win.on('closed', () => { win = null; });
}

function load(url) { win?.loadURL(url); }

// ---------------------------------------------------------------- multiplayer
/** What the game's page is told: hosting or not, the address its invite links carry, a friend's game it has joined. */
function networkState() {
  const ip = hosting && !joined ? lanAddresses()[0] : null;
  return { hosting, inviteBase: ip ? `https://${ip}:${port}/` : null, addresses: hosting ? lanAddresses() : [], joined: joined ? joined.toString() : null };
}

/** Whether a message comes from this PC's own game (not a friend's or an online server's page in the window). */
function fromOwnGame(e) {
  try { const u = new URL(e.senderFrame?.url || ''); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && Number(u.port) === port; } catch { return false; }
}

/** Host a game for this PC's networks, or stop. From the game's own menu (quiet) it says nothing: the page shows it. */
async function hostOnNetwork(on, { quiet = false } = {}) {
  const wasJoined = !!joined, before = port;
  joined = null;
  try { await startServer(on); } catch (e) { dialog.showErrorBox('TRAILBREAK', String(e.message || e)); }
  writeSettings({ ...readSettings(), host: on });
  buildMenu();
  // the game in the window carries on (a room on this server reconnects by itself), unless it has to move
  if (wasJoined || port !== before || !(win?.webContents.getURL() || '').startsWith(localUrl())) load(localUrl());
  else win?.webContents.send('network-changed', networkState());
  if (on && !quiet) {
    const ips = lanAddresses();
    dialog.showMessageBox(win, {
      type: 'info', title: 'Hosting on this network', buttons: ['OK'],
      message: ips.length ? 'Friends on your network can join you' : 'No network found',
      detail: ips.length
        ? `Drive, then press Esc for the invite link and send it to them. They open it in TRAILBREAK (Multiplayer > Join a game) or in a browser:\n\n${ips.map((ip) => `https://${ip}:${port}`).join('\n')}\n\nIf Windows asks, allow TRAILBREAK on private networks. Their browser warns about the certificate the first time (it is this PC's own): they choose to go on.`
        : 'This PC is not on a network: connect to one and host again.',
    });
  }
}

/** A small window asking where to join: a friend's invite link or address, or an online server's. */
function askWhere() {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: win, modal: true, width: 520, height: 250, resizable: false, minimizable: false, maximizable: false, title: 'Join a game',
      icon: ICON, autoHideMenuBar: true, backgroundColor: '#0b0f14',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    w.setMenu(null);
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; ipcMain.removeListener('join-answer', onAnswer); resolve(v); if (!w.isDestroyed()) w.close(); };
    const onAnswer = (e, v) => { if (e.sender === w.webContents) done(v); };
    ipcMain.on('join-answer', onAnswer);
    w.on('closed', () => done(null));
    w.loadFile(path.join(__dirname, 'join.html'), { query: { last: readSettings().lastJoin || '' } });
  });
}

async function joinGame() {
  let where = (await askWhere() || '').trim();
  if (!where) return;
  if (!/^https?:\/\//i.test(where)) where = `https://${where}`;
  let url;
  try { url = new URL(where); } catch { dialog.showErrorBox('TRAILBREAK', `That isn't an address: ${where}`); return; }
  joined = url;
  writeSettings({ ...readSettings(), lastJoin: url.toString() });
  buildMenu();
  load(url.toString());
}

function playOwn() {
  joined = null;
  buildMenu();
  load(localUrl());
}

// a friend's PC serves the game with a certificate of its own making: accepted for the address you chose to join
app.on('certificate-error', (e, wc, url, error, cert, callback) => {
  try {
    if (joined && new URL(url).host === joined.host) { e.preventDefault(); callback(true); return; }
  } catch { /* refuse */ }
  callback(false);
});

// the page asks how it stands on the network (preload.js): hosting, the address its invite links should carry
ipcMain.on('network', (e) => { e.returnValue = networkState(); });
ipcMain.on('invite-base', (e) => { e.returnValue = networkState().inviteBase; });
// the game's own Esc menu hosts for the network, or stops; its lobby opens the "Join a game" window (this PC's game only)
ipcMain.handle('set-hosting', async (e, on) => {
  if (!fromOwnGame(e)) throw new Error('only this PC\'s own game can do that');
  await hostOnNetwork(!!on, { quiet: true });
  return networkState();
});
ipcMain.on('join-game', (e) => { if (fromOwnGame(e)) joinGame(); });

// ---------------------------------------------------------------- updates
let updater = null, updateReady = null;

/** Look for a newer release when the game starts and every few hours, download it, and install it when it's closed. */
function watchUpdates() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('error', (e) => console.warn(`updates: ${e?.message || e}`));
  updater.on('update-downloaded', (info) => {
    updateReady = info.version;
    buildMenu();
    win?.webContents.send('update-ready', updateReady);
  });
  const check = () => updater.checkForUpdates().catch(() => { /* offline: the next time */ });
  check();
  setInterval(check, 4 * 3600e3);
}

async function checkForUpdatesNow() {
  if (!updater) return;
  if (updateReady) { dialog.showMessageBox(win, { type: 'info', title: 'TRAILBREAK', message: `TRAILBREAK ${updateReady} is ready`, detail: 'It installs when you close the game, or now with Game > Restart to update.' }); return; }
  try {
    const r = await updater.checkForUpdates();
    const v = r?.updateInfo?.version;
    dialog.showMessageBox(win, {
      type: 'info', title: 'TRAILBREAK',
      message: r?.isUpdateAvailable ? `TRAILBREAK ${v} is downloading` : `This is the newest TRAILBREAK (${app.getVersion()})`,
      detail: r?.isUpdateAvailable ? 'The game says when it is ready. It installs when you close the game.' : '',
    });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', title: 'TRAILBREAK', message: 'Could not check for updates', detail: String(e?.message || e).slice(0, 400) });
  }
}

function restartToUpdate() {
  quitting = true;
  updater?.quitAndInstall(true, true);
}

// ---------------------------------------------------------------- the menu (shown with Alt; no letter shortcuts)
function buildMenu() {
  const template = [
    {
      label: 'Game',
      submenu: [
        ...(updateReady ? [{ label: `Restart to update to ${updateReady}`, click: () => restartToUpdate() }, { type: 'separator' }] : []),
        { label: 'Play on this PC', type: 'radio', checked: !joined, click: () => playOwn() },
        { label: 'Full screen', accelerator: 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
        { label: 'Reload the game', click: () => win?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Quit TRAILBREAK', click: () => app.quit() },
      ],
    },
    {
      label: 'Multiplayer',
      submenu: [
        { label: 'Host a game on this network', type: 'checkbox', checked: hosting, click: (item) => hostOnNetwork(item.checked) },
        { label: 'Join a game…', click: () => joinGame() },
        { label: 'Back to my own game', enabled: !!joined, click: () => playOwn() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Controls and how it plays (README)', click: () => shell.openPath(path.join(GAME, 'README.md')) },
        { label: 'Credits and licences', click: () => shell.openPath(path.join(GAME, 'public', 'assets', 'trucks', 'CREDITS.md')) },
        { type: 'separator' },
        { label: 'Check for updates', enabled: !!updater, click: () => checkForUpdatesNow() },
        { label: `TRAILBREAK ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- start and stop
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    buildMenu();
    createWindow();
    win.loadURL(`data:text/html,${encodeURIComponent('<body style="margin:0;background:#0b0f14;color:#ff7a1a;font:600 22px system-ui;display:grid;place-items:center;height:100vh">TRAILBREAK</body>')}`);
    try {
      await startServer(!!readSettings().host);
    } catch (e) {
      dialog.showErrorBox('TRAILBREAK', `The game could not start: ${e.message || e}`);
      app.quit();
      return;
    }
    load(localUrl());
    watchUpdates();
    buildMenu();
  });
  app.on('before-quit', () => { quitting = true; stopServer(); });
  app.on('window-all-closed', () => app.quit());
}
