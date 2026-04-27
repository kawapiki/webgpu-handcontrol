/**
 * Tiny typed event bus. No dependencies, no DOM coupling — picked up
 * by both the in-app webpage scene and (eventually) the npm-package
 * public surface. EventEmitter-shaped so it's familiar.
 */

export type Listener<T> = (payload: T) => void;

export class EventBus<EventMap> {
  private listeners: { [K in keyof EventMap]?: Set<Listener<EventMap[K]>> } = {};

  on<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): void {
    this.listeners[event]?.delete(fn);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.listeners = {};
  }
}
