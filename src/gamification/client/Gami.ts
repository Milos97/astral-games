import { Emitter } from '../../core/Emitter';
import type { ServerClient } from '../../core/ServerClient';
import type { GamiUpdate, GamiView, RoundEvent } from '../engine';

/** Reveal a held update anyway after this long (e.g. a round that was never presented). */
const HOLD_LIMIT_MS = 60_000;

export interface LoggedEvent {
  event: RoundEvent;
  xp: number;
  completed: number;
}

/**
 * Client side of the gamification service. Updates are pushed by the
 * server as soon as a round settles, which is *before* the player has seen
 * the result animate. Showing "+1 free spins mission" while the reels are
 * still dropping would spoil the outcome, so each update is held until the
 * game calls reveal(roundId) at the end of its presentation.
 */
export class Gami extends Emitter<{ reveal: [GamiUpdate]; log: [] }> {
  /** The state the player has seen so far. */
  view: GamiView;
  readonly log: LoggedEvent[] = [];
  private held: { update: GamiUpdate; at: number }[] = [];
  private early = new Set<string>();

  constructor(server: ServerClient, initial: GamiView) {
    super();
    this.view = initial;
    server.on('gami', (update, event) => {
      if (event) {
        this.log.unshift({ event, xp: update.xpGained, completed: update.missions.filter((m) => m.completed).length });
        if (this.log.length > 30) this.log.pop();
        this.emit('log');
      }
      if (!update.roundId || this.early.delete(update.roundId)) this.show(update);
      else this.held.push({ update, at: performance.now() });
    });
    setInterval(() => {
      const stale = this.held.find((h) => performance.now() - h.at > HOLD_LIMIT_MS);
      if (stale) this.reveal(stale.update.roundId);
    }, 1000);
  }

  /** The game finished presenting `roundId`: show its progress. */
  reveal(roundId: string) {
    const i = this.held.findIndex((h) => h.update.roundId === roundId);
    if (i < 0) {
      // presented before the push arrived; show it the moment it does
      this.early.add(roundId);
      return;
    }
    // every update carries a full snapshot, so reveal older ones first or the view would go backwards
    const due = this.held.filter((h) => h.update.seq <= this.held[i].update.seq).sort((a, b) => a.update.seq - b.update.seq);
    this.held = this.held.filter((h) => !due.includes(h));
    due.forEach((h) => this.show(h.update));
  }

  private show(update: GamiUpdate) {
    this.view = update.view;
    this.emit('reveal', update);
  }
}
