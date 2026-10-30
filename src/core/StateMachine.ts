import { Emitter } from './Emitter';

/**
 * Finite state machine with an explicit transition table. Illegal
 * transitions throw in development so presentation bugs (e.g. spinning
 * while a big win is still on screen) surface immediately instead of
 * becoming a desynced game.
 */
export class StateMachine<S extends string> extends Emitter<{ change: [to: S, from: S] }> {
  private current: S;
  readonly history: { from: S; to: S; at: number }[] = [];

  constructor(
    readonly name: string,
    initial: S,
    private readonly table: Readonly<Record<S, readonly S[]>>,
  ) {
    super();
    this.current = initial;
  }

  get state(): S {
    return this.current;
  }

  is(...states: S[]): boolean {
    return states.includes(this.current);
  }

  can(to: S): boolean {
    return this.table[this.current].includes(to);
  }

  go(to: S): void {
    const from = this.current;
    if (!this.can(to)) {
      const msg = `[fsm:${this.name}] illegal transition ${from} -> ${to}`;
      if (import.meta.env.DEV) throw new Error(msg);
      console.error(msg);
    }
    this.current = to;
    this.history.push({ from, to, at: performance.now() });
    if (this.history.length > 100) this.history.shift();
    this.emit('change', to, from);
  }
}
