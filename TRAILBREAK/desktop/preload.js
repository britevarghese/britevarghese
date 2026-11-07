// What the desktop app tells the game's page (main.js), and what the page can ask of it: the address its invite links
// should carry while this PC hosts a game on its network (null otherwise: the page's own), hosting or not and joining a
// friend's game (from the game's own menus), when a newer TRAILBREAK has downloaded (its version); and, in the "Join a
// game" window, how to answer.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trailbreakDesktop', {
  inviteBase: ipcRenderer.sendSync('invite-base'),
  // how the game stands on the network now ({ hosting, inviteBase, addresses, joined }), and when that changes
  network: () => ipcRenderer.sendSync('network'),
  onNetwork: (cb) => { ipcRenderer.on('network-changed', (_e, state) => cb(state)); },
  // host this game for friends on the same network, or stop (resolves with the new state); open the "Join a game" window
  setHosting: (on) => ipcRenderer.invoke('set-hosting', !!on),
  join: () => ipcRenderer.send('join-game'),
  onUpdate: (cb) => { ipcRenderer.on('update-ready', (_e, version) => cb(String(version))); },
  answerJoin: (where) => ipcRenderer.send('join-answer', typeof where === 'string' ? where.slice(0, 500) : null),
});
