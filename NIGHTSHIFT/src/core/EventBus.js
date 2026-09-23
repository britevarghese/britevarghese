// Minimal publish/subscribe bus used to decouple gameplay systems from UI/audio.
export class EventBus {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, data) {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(data); } catch (e) { console.error(`[EventBus] handler for "${name}" failed`, e); }
    }
  }
}
export const bus = new EventBus();
