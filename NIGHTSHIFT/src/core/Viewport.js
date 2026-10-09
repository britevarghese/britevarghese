// Viewport: the game is always played sideways. On a touch screen held upright (and iPhones can't lock the
// orientation from a web page), the whole app (#app) is turned 90 degrees so it fills the screen in landscape:
// width() / height() are then the app's own size (the screen's height and width), and toApp() turns a touch's
// screen position into the app's. Everything that sizes the 3D view or reads touch positions goes through here.
const touch = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0;

let rot = false;
const W = () => (window.visualViewport?.width ? Math.round(visualViewport.width) : innerWidth);
const H = () => (window.visualViewport?.height ? Math.round(visualViewport.height) : innerHeight);

export const isRotated = () => rot;
export const width = () => (rot ? H() : W());
export const height = () => (rot ? W() : H());
// screen (client) position -> app position
export const toApp = (x, y) => (rot ? [y, W() - x] : [x, y]);
// an element's box in app coordinates
export function appRect(el) {
  const r = el.getBoundingClientRect();
  return rot ? { left: r.top, top: W() - r.right, width: r.height, height: r.width } : { left: r.left, top: r.top, width: r.width, height: r.height };
}

function apply() {
  const app = document.getElementById('app');
  const want = touch() && H() > W();
  rot = want;
  document.documentElement.classList.toggle('rot', rot);
  document.documentElement.classList.toggle('short', height() <= 520);   // (menus compact: see the css)
  if (app) {
    if (rot) Object.assign(app.style, { position: 'fixed', left: W() + 'px', top: '0px', right: 'auto', bottom: 'auto', width: H() + 'px', height: W() + 'px', transformOrigin: '0 0', transform: 'rotate(90deg)' });
    else Object.assign(app.style, { position: '', left: '', top: '', right: '', bottom: '', width: '', height: '', transformOrigin: '', transform: '' });
  }
  dispatchEvent(new Event('app-resize'));
}

// re-measure on every turn of the phone (iOS reports the new size late: once more a moment after)
let t = 0;
const later = () => { apply(); clearTimeout(t); t = setTimeout(apply, 350); };
addEventListener('resize', later);
addEventListener('orientationchange', later);
window.visualViewport?.addEventListener('resize', later);
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', apply); else apply();
