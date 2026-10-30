type Listener<A extends unknown[]> = (...args: A) => void;

/** Minimal typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    this.listeners[event]?.forEach((fn) => fn(...args));
  }
}
