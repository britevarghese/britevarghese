// Background work while the game is played (the open world's maps coming in: their colours, their part of the map, their
// renderers), a few ms at a time: each piece waits its turn here.
//
// On the loading screen a turn is the next task (setTimeout 0): nothing is being drawn, the work has the page to
// itself. Once the game is drawing frames, a turn comes in the browser's idle time: after a frame's own work, when
// there is time to spare before the next (requestIdleCallback). Taken a task after a task, the pieces of several maps
// coming in at once ran back to back for a second and more at a stretch, and every frame in that time waited on
// whichever piece was running when it was due: late by up to a piece's length, some of them dropped.
//
// On a machine with no time to spare between frames the work still gets a turn every WAIT ms, so the world comes in
// (slower) and the frame rate keeps most of what it had. Hurried (a fast travel waiting on a map that isn't in yet, or
// the truck within a kilometre of one: core/Game.js), it goes back to a task after a task.

const WAIT = 33;                 // ms: the longest a piece of work waits for idle time (two frames at 60 a second)
let playing = false, hurried = false;

/** The game is drawing frames (true), or a loading screen is up (false). */
export function setPlaying(on) { playing = !!on; }

/** Something is waiting on the background work (a fast travel to a map still coming in, a map close by): don't wait for idle time. */
export function setHurry(on) { hurried = !!on; }

/**
 * A turn for a piece of background work that takes about `ms` ms: resolves when the page has that much time to spare
 * before its next frame (or after WAIT ms without).
 */
export function idle(ms = 6) {
  if (!playing || hurried || typeof requestIdleCallback !== 'function') return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ask = () => {
      const left = WAIT - (performance.now() - t0);
      if (left <= 0 || !playing || hurried) { resolve(); return; }
      requestIdleCallback((d) => {
        // (not time enough before this frame: asked again after it)
        if (d.didTimeout || d.timeRemaining() >= Math.min(ms, 12)) resolve(); else setTimeout(ask, 4);
      }, { timeout: left });
    };
    ask();
  });
}
