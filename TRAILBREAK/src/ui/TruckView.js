// A truck turning slowly on the garage floor in a small canvas: what's picked in the lobby's truck list and at the
// dealer, with its build and paint. Drag to turn it (the garage's own 3D view, GaragePreview, does the drawing).
import { GaragePreview } from './GaragePreview.js';
import { truckSpec } from '../physics/trucks.js';

export class TruckView {
  constructor(canvas) {
    this.canvas = canvas;
    this.preview = null;
    this.raf = 0;
    this.shown = '';
    this.paint = '';
  }

  /** Show truck id with build code (blank: stock) in a paint (#hex); starts the view turning. */
  show(id, code, paint) {
    if (!this.preview) {
      try { this.preview = new GaragePreview(this.canvas); } catch (e) { console.warn('truck view', e); this.canvas.closest('.truck-view')?.classList.add('hidden'); return; }
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

  start() {
    if (this.raf || !this.preview) return;
    let last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      this.preview.frame(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  /** Free the view's WebGL context (the lobby's, before the game takes the GPU). */
  dispose() {
    this.stop();
    if (!this.preview) return;
    this.preview.dispose();
    this.preview.renderer.forceContextLoss();
    this.preview = null; this.shown = '';
  }
}
