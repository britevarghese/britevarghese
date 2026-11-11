// Overhead markers (IFF): a chevron over every teammate in view — green for my squad, blue for the rest of the team —
// with the name for squad mates, for anyone close, and for whoever is under the crosshair. They show through walls,
// like Battlefield's, so you know where your own side is and don't shoot at it.
// Spotted enemies (Q, by anyone on my team or its bots) get a red diamond while the spot lasts — over a soldier's
// head, or over a vehicle with what it is — and the distance when the crosshair is on them.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEAD = { stand: 2.05, crouch: 1.55, prone: 0.75 };

export class Markers {
  constructor(game) {
    this.g = game;
    this.root = document.createElement('div'); this.root.id = 'iffmarks';
    document.body.appendChild(this.root);
    this.pool = [];
    this.v = null;
  }

  update(cam) {
    const g = this.g, show = [];
    if (cam && !g.royale && g.lastSnap) {
      const V = this.v || (this.v = cam.position.clone());
      const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2;
      for (const p of g.players.map.values()) {
        if (!p.alive || p.id === g.myId || p.team !== g.myTeam || (p.flags & 128) || p.loading) continue;
        const y = p.y + (HEAD[p.stance] ?? 2.05);
        const d = Math.hypot(p.x - cam.position.x, y - cam.position.y, p.z - cam.position.z);
        if (d > 160) continue;
        V.set(p.x, y, p.z).project(cam);
        if (V.z > 1 || Math.abs(V.x) > 1.05 || Math.abs(V.y) > 1.05) continue;
        const sx = ((V.x + 1) / 2) * W, sy = ((1 - V.y) / 2) * H;
        const squad = !!g.hud.squadIds?.has(p.id);
        const aimed = Math.abs(sx - cx) < 60 && Math.abs(sy - cy) < 80;
        const named = squad ? d < 90 : d < 22 || aimed;
        show.push({ sx, sy, cls: `iff${squad ? ' sq' : ''}${d > 70 ? ' far' : ''}`, html: `<i></i>${named ? `<span>${esc(p.name || '')}</span>` : ''}` });
      }
      // spotted enemies
      const now = performance.now(), mark = (x, y, z, label) => {
        const d = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
        V.set(x, y, z).project(cam);
        if (V.z > 1 || Math.abs(V.x) > 1.05 || Math.abs(V.y) > 1.05) return;
        const sx = ((V.x + 1) / 2) * W, sy = ((1 - V.y) / 2) * H, aimed = Math.abs(sx - cx) < 70 && Math.abs(sy - cy) < 90;
        const txt = [label, aimed ? `${Math.round(d)} m` : ''].filter(Boolean).join(' · ');
        show.push({ sx, sy, cls: 'iff foe', html: `<i></i>${txt ? `<span>${txt}</span>` : ''}` });
      };
      // my squad's ordered flag: ATTACK / DEFEND and the distance, over its middle
      const ord = g.order && g.lastSnap.f && g.flagPos?.(g.order.f);
      if (ord) {
        const d = Math.hypot(ord.x - cam.position.x, ord.z - cam.position.z);
        V.set(ord.x, ord.y + 4, ord.z).project(cam);
        if (V.z <= 1 && Math.abs(V.x) <= 1.05 && Math.abs(V.y) <= 1.05) {
          show.push({ sx: ((V.x + 1) / 2) * W, sy: ((1 - V.y) / 2) * H, cls: `iff ord ${g.order.kind}`, html: `<i></i><span>${g.order.kind === 'attack' ? 'ATTACK' : 'DEFEND'} ${g.order.f} · ${Math.round(d)} m</span>` });
        }
      }
      const inSpotted = new Set();
      for (const v of g.vehicles.map.values()) {
        if (v.dead || !(v.spotMark > now) || v.team === g.myTeam) continue;
        for (const id of v.seats || []) if (id) inSpotted.add(id);
        mark(v.x, v.y + (v.type === 'tank' ? 3.6 : v.type === 'heli' ? 3.2 : 2.4), v.z, String(v.type).toUpperCase());
      }
      for (const p of g.players.map.values()) {
        if (!p.alive || p.team === g.myTeam || !(p.spotMark > now) || (p.flags & 128) || inSpotted.has(p.id)) continue;
        mark(p.x, p.y + (HEAD[p.stance] ?? 2.05) + 0.15, p.z, '');
      }
    }
    while (this.pool.length < show.length) { const e = document.createElement('div'); this.root.appendChild(e); this.pool.push(e); }
    this.pool.forEach((e, i) => {
      const s = show[i];
      if (!s) { if (e._vis !== false) { e.style.display = 'none'; e._vis = false; } return; }
      if (e._vis !== true) { e.style.display = ''; e._vis = true; }
      if (e.className !== s.cls) e.className = s.cls;
      if (e._h !== s.html) { e.innerHTML = s.html; e._h = s.html; }
      e.style.transform = `translate(${s.sx.toFixed(1)}px, ${s.sy.toFixed(1)}px) translate(-50%, -100%)`;
    });
  }
}
