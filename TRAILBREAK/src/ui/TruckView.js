// A truck turning slowly on the garage floor in a small canvas: what's picked in the lobby's truck list and at the
// dealer, with its build and paint. Drag to turn it (the garage's own 3D view, GaragePreview, does the drawing).
import { GaragePreview } from './GaragePreview.js';
import { truckSpec, TRUCKS } from '../physics/trucks.js';
import { loadTruckAsset, truckAsset, truckAssetProgress, MODEL_BODIES } from '../render/TruckAssets.js';

export class TruckView {
  /** opts: for the 3D view (GaragePreview): { showroom }. */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.preview = null;
    this.raf = 0;
    this.shown = '';
    this.paint = '';
  }

  /**
   * Show truck id with build code (blank: stock) in a paint (#hex); starts the view turning. A show waiting on its
   * model when the view is stopped or let go (the lobby closed, the dealer left) does nothing when the model comes:
   * it used to carry on, make the view again (a WebGL context of its own) and set it turning, hidden, drawn every
   * frame for the rest of the session, beside the game: whenever Drive was pressed before the lobby's truck was in.
   */
  async show(id, code, paint) {
    if (this.disposed) return;
    this.want = `${id}:${code || ''}:${paint}`;
    const want = this.want;
    // (a model body loads first: meanwhile the last truck stays, dimmed, under how far the new one has come)
    if (!truckAsset(id) && MODEL_BODIES.has(id)) this.loading(id);
    await loadTruckAsset(id);
    if (want !== this.want) return;                  // (another was picked while it loaded, or the view was stopped)
    this.loading(null);
    if (!this.preview) {
      try { this.preview = new GaragePreview(this.canvas, this.opts); } catch (e) { console.warn('truck view', e); this.canvas.closest('.truck-view')?.classList.add('hidden'); return; }
    }
    const key = `${id}:${code || ''}`;
    if (key !== this.shown) {
      this.preview.show(truckSpec(id, code || undefined), paint);
      this.preview.fit();                            // framed for this truck, small or tall
      this.shown = key; this.paint = paint;
    } else if (paint !== this.paint) {
      this.preview.model.setPaint(paint);
      this.preview.dirty = true; this.paint = paint;
    }
    this.start();
  }

  /** Over the view while truck id's model comes down (null: done): its name and how far it has got. */
  loading(id) {
    clearInterval(this.loadT);
    const host = this.canvas.parentElement;
    let el = host?.querySelector('.tv-load');
    if (!id) { el?.remove(); return; }
    if (!host) return;
    if (!el) { el = document.createElement('div'); el.className = 'tv-load'; el.innerHTML = '<span></span><i><b></b></i>'; host.appendChild(el); }
    const tick = () => {
      const p = truckAssetProgress(id);
      el.querySelector('span').textContent = `Loading the ${TRUCKS[id]?.name || 'truck'}${p != null ? ` · ${Math.round(p * 100)}%` : '…'}`;
      el.querySelector('b').style.width = `${Math.round((p ?? 0) * 100)}%`;
    };
    tick();
    this.loadT = setInterval(tick, 150);
  }

  start() {
    if (this.raf || !this.preview || this.disposed) return;
    let last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      this.preview.frame(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Stop it turning (and drop a show still waiting on its model: show again to go on). */
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.want = null; this.loading(null); }

  /** Free the view's WebGL context (the lobby's, before the game takes the GPU); for good. */
  dispose() {
    this.disposed = true;
    this.stop();
    if (!this.preview) return;
    this.preview.dispose();
    this.preview.renderer.forceContextLoss();
    this.preview = null; this.shown = '';
  }
}
