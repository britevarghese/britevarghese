// What the desktop app tells the game's page (main.js): the address its invite links should carry while this PC hosts
// a game on its network (null otherwise: the page's own); when a newer TRAILBREAK has downloaded (its version); and, in
// the "Join a game" window, how to answer.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trailbreakDesktop', {
  inviteBase: ipcRenderer.sendSync('invite-base'),
  onUpdate: (cb) => { ipcRenderer.on('update-ready', (_e, version) => cb(String(version))); },
  answerJoin: (where) => ipcRenderer.send('join-answer', typeof where === 'string' ? where.slice(0, 500) : null),
});
