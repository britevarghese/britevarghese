// Full-screen rifle scope (Battlefield-style) shown when fully aimed with a magnified optic: the world is rendered
// with the magnified FOV from the camera itself, so the reticle centre is exactly where the bullet leaves the
// barrel line — no picture-in-picture parallax. The reticle carries bullet-drop compensation (BDC) marks computed
// from the real ballistics for the current sight zeroing: hold the "4" mark on a target at 400 m.
import { bulletPath, zeroAngle } from '/shared/ballistics.js';

const OPEN = { raycast: () => null };

export class ScopeOverlay {
  constructor() {
    this.el = document.createElement('canvas');
    this.el.id = 'scope';
    document.getElementById('hud').appendChild(this.el);
    this.key = '';
    this.visible = false;
  }

  show(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
    document.body.classList.toggle('scoped', v);
  }

  // fov: vertical camera FOV in degrees while scoped
  update(def, zero, fov, swayX = 0, swayY = 0) {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio, 2);
    const key = `${w}x${h}@${dpr}|${def.id}|${zero}|${fov.toFixed(2)}`;
    if (key !== this.key) { this.key = key; this.#draw(def, zero, fov, w, h, dpr); }
    // slight breathing sway of the whole scope image
    this.el.style.transform = `translate(${swayX.toFixed(1)}px, ${swayY.toFixed(1)}px)`;
  }

  // drop marks: angle below the line of sight at each distance, for the current zero
  #holdovers(def, zero) {
    const a = zeroAngle(def, zero);
    const { pts } = bulletPath(OPEN, { x: 0, y: 0, z: 0 }, { x: Math.cos(a), y: Math.sin(a), z: 0 }, def);
    const out = [];
    for (let D = Math.ceil((zero + 1) / 100) * 100; D <= Math.min(def.maxRange, 1000); D += 100) {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].x < D) continue;
        const p = pts[i - 1], q = pts[i], k = (D - p.x) / (q.x - p.x), y = p.y + (q.y - p.y) * k;
        out.push({ D, ang: Math.atan2(-y, D) });
        break;
      }
    }
    return out;
  }

  #draw(def, zero, fov, w, h, dpr) {
    const c = this.el;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.47;
    // housing: black outside the lens, soft dark rim, faint blue lens tint at the edge
    g.fillStyle = '#000';
    g.beginPath(); g.rect(0, 0, w, h); g.arc(cx, cy, R, 0, Math.PI * 2, true); g.fill('evenodd');
    const rim = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.75, 'rgba(0,0,0,0.35)'); rim.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = rim; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // pixels per radian at the screen centre
    const ppr = (h / 2) / Math.tan((fov * Math.PI) / 360);
    g.strokeStyle = '#050505'; g.fillStyle = '#050505'; g.lineCap = 'butt';
    // thick posts (left, right, bottom) with gaps around the centre
    const gap = R * 0.2;
    g.fillRect(cx - R, cy - 3, R - gap, 6); g.fillRect(cx + gap, cy - 3, R - gap, 6);
    g.fillRect(cx - 3.5, cy + gap * 1.6, 7, R - gap * 1.6);
    // fine crosshair
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - gap, cy); g.lineTo(cx + gap, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + gap * 1.6); g.stroke();
    // centre chevron (aim point = where the bullet goes at the zero distance)
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 9, cy + 9); g.lineTo(cx, cy); g.lineTo(cx + 9, cy + 9); g.stroke();
    // bullet drop compensation marks
    g.font = '600 11px "Segoe UI", Roboto, sans-serif'; g.textBaseline = 'middle';
    let lastY = cy + 10; // keep marks readable: skip ones closer than 11 px to the previous
    for (const { D, ang } of this.#holdovers(def, zero)) {
      const y = cy + Math.tan(ang) * ppr;
      if (y > cy + gap * 1.6 - 4 || y < lastY + 11) continue;
      lastY = y;
      const len = D % 200 === 0 ? 12 : 7;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - len, y); g.lineTo(cx + len, y); g.stroke();
      g.fillText(String(D / 100), cx + len + 4, y);
    }
    // mil scale on the horizontal line (1 mil = 1 m at 1000 m) for leading moving targets
    for (let m = 1; m <= 5; m++) {
      const dx = Math.tan(m / 1000) * ppr;
      if (dx > gap) break;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * dx, cy - (m % 5 ? 3 : 6)); g.lineTo(cx + s * dx, cy + (m % 5 ? 3 : 6)); g.stroke(); }
    }
    // zeroing label on the lens edge
    g.fillStyle = 'rgba(210,225,235,0.8)';
    g.font = '600 12px "Segoe UI", Roboto, sans-serif';
    g.fillText(`${zero} m`, cx + R * 0.55, cy + R * 0.72);
  }
}
