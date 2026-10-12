// Browsers give steering wheels and gamepads only to secure pages: https, or http://localhost. A player on another
// PC who opened http://<ip>:<port> has none, whatever is plugged in; the server answers https on the same port (a
// certificate of its own: the browser warns once, Advanced > Proceed). The https page is another origin with its
// own storage, so the move carries this browser's progress and settings across.
import { Storage } from './Storage.js';

const PREFIX = 'nightshift.';

/** No controllers can reach this page (plain http from another PC). */
export const controllersBlocked = () => !window.isSecureContext;

/** This page's address on https (same host and port). */
export const secureUrl = () => `https://${location.host}${location.pathname}`;

/** Open the https address, then hand it this page's storage once it asks (it keeps its own save if it has one). */
export function openSecure() {
  const data = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) data[k] = localStorage.getItem(k); } } catch { /* no storage */ }
  const w = window.open(`${secureUrl()}#carry`, '_blank');
  if (!w) { location.href = secureUrl(); return; }   // (pop-ups blocked: go there, progress stays on this address)
  const target = `https://${location.host}`;
  const onMsg = (e) => {
    if (e.source !== w || e.origin !== target || e.data?.type !== 'nightshift:ready') return;
    w.postMessage({ type: 'nightshift:carry', data }, target);
    removeEventListener('message', onMsg);
  };
  addEventListener('message', onMsg);
}

/**
 * On the https page opened by openSecure: ask the http page for its storage and take it (only when this origin has no
 * save of its own: never over progress made here). Waits at most a few seconds; call before anything reads storage.
 */
export function receiveCarry(timeout = 4000) {
  if (location.hash !== '#carry') return Promise.resolve(false);
  history.replaceState(null, '', location.pathname + location.search);
  const from = `http://${location.host}`;
  if (!window.opener) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (v) => { removeEventListener('message', onMsg); clearTimeout(t); resolve(v); };
    const onMsg = (e) => {
      if (e.origin !== from || e.source !== window.opener || e.data?.type !== 'nightshift:carry') return;
      const data = e.data.data || {};
      if (Storage.load('save', null)) { done(false); return; }
      try { for (const [k, v] of Object.entries(data)) if (k.startsWith(PREFIX) && typeof v === 'string') localStorage.setItem(k, v); } catch { /* full or blocked */ }
      done(true);
    };
    addEventListener('message', onMsg);
    const t = setTimeout(() => done(false), timeout);
    try { window.opener.postMessage({ type: 'nightshift:ready' }, from); } catch { done(false); }
  });
}
