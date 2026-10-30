import { Container, type Text } from 'pixi.js';
import type { App, DebugHooks, Layout, Scene } from '../../../core/App';
import { sfx } from '../../../core/Audio';
import { t } from '../../../core/i18n';
import { prefs, savePrefs } from '../../../core/Settings';
import { StateMachine } from '../../../core/StateMachine';
import type { FsState, SlotForce, SlotRound } from '../../../shared/protocol';
import { BigWin, type WinTier } from '../../../ui/BigWin';
import { Hud } from '../../../ui/Hud';
import { title } from '../../../ui/text';
import {
  BASE_LADDER,
  BIG_WIN_TIERS,
  bigWinTier,
  COLS,
  FS_RETRIGGER,
  FS_TRIGGER,
  MIN_CLUSTER,
  ROWS,
  SYMBOLS,
} from '../math/config';
import type { Grid as GridData } from '../math/engine';
import { FeatureOverlay } from './FeatureOverlay';
import { Grid } from './Grid';
import { FsCounter, Logo, MultiplierMeter } from './Panels';
import { Paytable } from './Paytable';

type S = 'boot' | 'idle' | 'requesting' | 'spinning' | 'cascading' | 'settling' | 'bigWin' | 'fsIntro' | 'fsOutro';

/**
 * Every legal move of the slot client. Anything else throws in dev.
 *   boot -> spinning/fsIntro is the "resume after reload" path.
 *   idle -> spinning is a replay (no request, no money).
 */
const TRANSITIONS: Record<S, readonly S[]> = {
  boot: ['idle', 'spinning', 'fsIntro'],
  idle: ['requesting', 'spinning'],
  requesting: ['spinning', 'idle'],
  spinning: ['cascading', 'settling'],
  cascading: ['cascading', 'settling'],
  settling: ['bigWin', 'fsIntro', 'fsOutro', 'idle', 'requesting'],
  bigWin: ['fsIntro', 'fsOutro', 'idle'],
  fsIntro: ['requesting'],
  fsOutro: ['idle'],
};

const TIERS: WinTier[] = BIG_WIN_TIERS.map((b) => ({ key: b.key, x: b.x }));
const FORCES: readonly SlotForce[] = ['noWin', 'win', 'big', 'mega', 'epic', 'freeSpins', 'longCascade'];
const GRID_CELL = 140;

export class SlotScene implements Scene {
  readonly root = new Container();
  readonly fsm = new StateMachine<S>('slot', 'boot', TRANSITIONS);
  private hud: Hud;
  private grid: Grid;
  private meter: MultiplierMeter;
  private fsCounter = new FsCounter();
  private logo = new Logo();
  private bigWin: BigWin;
  private feature: FeatureOverlay;
  private paytable: Paytable;
  private replayBanner: Text;
  private betIndex = prefs.betIndex;
  private balance = 0;
  private autoLeft = 0;
  private force: SlotForce | null = null;
  private inFreeSpins = false;
  private lastGrid: GridData;
  private disposers: (() => void)[] = [];

  readonly debug: DebugHooks = {
    fsm: this.fsm as unknown as StateMachine<string>,
    forces: FORCES,
    setForce: (f) => (this.force = f as SlotForce | null),
    replay: (id) => void this.replay(id),
  };

  constructor(private readonly app: App) {
    this.hud = new Hud(app.tweens, { title: 'slotTitle', turbo: true, autoplay: true });
    this.grid = new Grid(app, GRID_CELL);
    this.meter = new MultiplierMeter(app);
    this.bigWin = new BigWin(app);
    this.feature = new FeatureOverlay(app);
    this.paytable = new Paytable(app);
    this.replayBanner = title('', 40);
    this.replayBanner.visible = false;
    this.root.addChild(this.logo, this.meter, this.fsCounter, this.grid, this.hud, this.replayBanner, this.feature, this.bigWin, this.paytable);

    this.lastGrid = idleGrid();
    this.grid.setInstant(this.lastGrid);
    app.tweens.timeScale = prefs.turbo ? 2.2 : 1;
    this.wireHud();
    void this.start();
  }

  private get bet() {
    return this.app.session.betLevels[this.betIndex];
  }

  private wireHud() {
    const e = this.hud.events;
    this.disposers.push(
      e.on('spin', () => this.onSpinPressed()),
      e.on('betUp', () => this.changeBet(1)),
      e.on('betDown', () => this.changeBet(-1)),
      e.on('turbo', (on) => (this.app.tweens.timeScale = on ? 2.2 : 1)),
      e.on('auto', (n) => (n > 0 ? this.startAuto(n) : this.stopAuto())),
      e.on('info', () => void this.paytable.open(this.bet)),
      e.on('lobby', () => this.app.goto('lobby')),
    );
  }

  /** Fresh session state from the server; resume anything left unfinished. */
  private async start() {
    const info = await this.app.server.call('session.init', {});
    this.app.session = info;
    this.betIndex = Math.min(this.betIndex, info.betLevels.length - 1);
    this.balance = info.balance;
    this.hud.setBalance(this.balance);
    this.hud.setBet(this.bet);
    void this.hud.setWin(0);

    const { pending, fs } = info.slot;
    if (pending) {
      this.app.toast(t('resumed'), 'info', 3000);
      if (pending.mode === 'free') {
        await this.runFreeSpins(pending.fsBefore!, true, pending);
      } else {
        this.balance = pending.balanceBefore - pending.bet;
        this.hud.setBalance(this.balance);
        await this.grid.dropOut();
        await this.present(pending);
        await this.afterRound(pending);
      }
    } else if (fs) {
      await this.runFreeSpins(fs, true);
    } else {
      this.fsm.go('idle');
      this.idleUi();
    }
  }

  // ------------------------------------------------------------ input

  private onSpinPressed() {
    if (this.autoLeft > 0) {
      this.stopAuto();
      return;
    }
    if (this.fsm.is('idle')) {
      sfx.click();
      void this.spin();
    } else if (this.fsm.is('spinning', 'cascading')) {
      this.slam();
    }
  }

  onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return;
    for (const o of [this.paytable, this.bigWin, this.feature]) {
      if (o.visible) {
        o.tap();
        return;
      }
    }
    this.onSpinPressed();
  }

  /** Slam-stop: fast-forward the current phase to its end state. */
  private slam() {
    this.app.tweens.skipping = true;
    this.app.tweens.finishAll();
  }

  private changeBet(dir: number) {
    if (!this.fsm.is('idle') || this.inFreeSpins) return;
    const next = Math.max(0, Math.min(this.app.session.betLevels.length - 1, this.betIndex + dir));
    if (next === this.betIndex) return;
    this.betIndex = next;
    savePrefs({ betIndex: next });
    this.hud.setBet(this.bet);
  }

  private startAuto(n: number) {
    if (this.inFreeSpins && !this.fsm.is('idle')) return;
    this.autoLeft = n;
    this.hud.setSpinMode('auto', n);
    this.hud.setBetEnabled(false);
    if (this.fsm.is('idle')) this.continueAuto();
  }

  private stopAuto() {
    this.autoLeft = 0;
    if (this.fsm.is('idle')) this.idleUi();
    else this.hud.setSpinMode('stop');
  }

  private continueAuto() {
    if (this.autoLeft <= 0 || !this.fsm.is('idle')) return;
    void this.app.tweens.wait(250).then(() => {
      if (this.autoLeft <= 0 || !this.fsm.is('idle')) return;
      this.autoLeft--;
      void this.spin();
    });
  }

  private idleUi() {
    this.hud.setSpinMode(this.autoLeft > 0 ? 'auto' : 'spin', this.autoLeft);
    this.hud.setBetEnabled(this.autoLeft === 0 && !this.inFreeSpins);
  }

  private busyUi() {
    this.hud.setSpinMode(this.autoLeft > 0 ? 'auto' : 'stop', this.autoLeft);
    this.hud.setBetEnabled(false);
  }

  busy() {
    return !this.fsm.is('idle') || this.autoLeft > 0;
  }

  // ------------------------------------------------------------ game flow

  private async spin() {
    if (!this.fsm.is('idle')) return;
    const bet = this.bet;
    if (this.balance < bet) {
      this.app.toast(t('insufficientFunds'), 'warn');
      this.stopAuto();
      return;
    }
    this.fsm.go('requesting');
    this.busyUi();
    void this.hud.setWin(0);
    this.meter.set(1, false);
    // optimistic debit; the server's balanceAfter is authoritative later
    this.balance -= bet;
    this.hud.setBalance(this.balance);
    sfx.spin();

    // the old grid falls away while we wait for the server: latency hidden
    const out = this.grid.dropOut();
    let round: SlotRound;
    try {
      const force = this.force ?? undefined;
      this.force = null;
      round = await this.app.server.call('slot.spin', { bet, requestId: this.app.server.newRequestId(), force });
    } catch (e) {
      await out;
      this.balance += bet;
      this.hud.setBalance(this.balance);
      this.app.errorToast(e);
      this.stopAuto();
      await this.grid.dropIn(this.lastGrid, 99);
      this.fsm.go('idle');
      this.idleUi();
      return;
    }
    await out;
    await this.present(round);
    await this.afterRound(round);
  }

  /** Animate a finished round: drop, then every tumble step in order. */
  private async present(round: SlotRound, replay = false) {
    const free = round.mode === 'free';
    this.fsm.go('spinning');
    this.busyUi();
    this.meter.set(free ? round.fsMultiplierStart : 1, false);

    await this.phase(() => this.grid.dropIn(round.grid, (free ? FS_RETRIGGER : FS_TRIGGER) - 1));

    let acc = free ? (round.fsBefore?.totalWin ?? 0) : 0;
    for (let i = 0; i < round.steps.length; i++) {
      const step = round.steps[i];
      this.fsm.go('cascading');
      this.meter.set(step.multiplier);
      await this.phase(async () => {
        await this.grid.showWins(step, round.bet, i);
        acc += Math.round(step.winX * round.bet);
        void this.hud.setWin(acc, 700);
        await this.grid.explode(step.removed);
        await this.grid.tumble(step);
      });
      const next = free ? step.multiplier + 1 : BASE_LADDER[Math.min(i + 1, BASE_LADDER.length - 1)];
      this.meter.set(next);
    }

    const sc = round.scatter;
    if (sc.count >= (free ? FS_RETRIGGER : FS_TRIGGER)) await this.grid.celebrateScatters(sc.positions);

    this.fsm.go('settling');
    this.lastGrid = this.grid.data;
    const shown = free ? (round.fsAfter?.totalWin ?? acc) : round.win;
    if (shown > 0) await this.hud.setWin(shown, 300);

    if (!replay) {
      this.balance = round.balanceAfter;
      this.hud.setBalance(this.balance);
      this.hud.credit(round.win);
      this.app.server.call('slot.ack', { roundId: round.roundId }).catch(() => {
        /* the round stays pending server-side and replays on next load */
      });
    }
  }

  /** Run `fn` as one slam-able phase: a slam only fast-forwards to its end. */
  private async phase(fn: () => Promise<void>) {
    try {
      await fn();
    } finally {
      this.app.tweens.skipping = false;
    }
  }

  private async afterRound(round: SlotRound) {
    if (round.mode === 'base' && bigWinTier(round.totalX)) {
      this.fsm.go('bigWin');
      await this.bigWin.play(round.win, round.bet, TIERS, round.capped);
    }
    this.app.gami.reveal(round.roundId);
    if (round.mode === 'base' && round.fsAfter && round.scatter.freeSpins > 0) {
      await this.runFreeSpins(round.fsAfter, false);
      return;
    }
    this.fsm.go('idle');
    this.idleUi();
    this.continueAuto();
  }

  private async runFreeSpins(fs: FsState, resumed: boolean, pendingFirst?: SlotRound) {
    this.fsm.go('fsIntro');
    this.inFreeSpins = true;
    this.busyUi();
    void this.app.tweens.to(this.app.background, { mood: 1 }, { duration: 1200 });
    this.meter.setMood(true);
    this.meter.set(fs.multiplier, false);
    this.fsCounter.visible = true;
    this.fsCounter.set(fs.total - fs.remaining, fs.total);
    if (resumed) this.app.toast(t('resumedFs'), 'info', 2500);
    else await this.feature.intro(fs.total, this.autoLeft > 0 ? 2500 : 8000);
    void this.hud.setWin(fs.totalWin);

    let state = fs;
    let last: SlotRound | null = null;
    let first = pendingFirst;
    for (;;) {
      this.fsm.go('requesting');
      this.fsCounter.set(state.total - state.remaining + 1, state.total);
      const out = this.grid.dropOut();
      const round = first ?? (await this.requestFreeSpin());
      first = undefined;
      await out;
      await this.present(round);
      this.app.gami.reveal(round.roundId);
      last = round;
      state = round.fsAfter ?? state;
      this.fsCounter.set(state.total - state.remaining, state.total);
      if (round.scatter.freeSpins > 0) {
        await this.feature.retrigger(round.scatter.freeSpins);
        this.fsCounter.set(state.total - state.remaining, state.total);
      }
      if (round.fsEnded) break;
      await this.app.tweens.wait(300);
    }

    const total = last!.fsAfter!.totalWin;
    const bet = last!.bet;
    if (bigWinTier(total / bet)) {
      this.fsm.go('bigWin');
      await this.bigWin.play(total, bet, TIERS);
    }
    this.fsm.go('fsOutro');
    await this.feature.outro(total);
    void this.app.tweens.to(this.app.background, { mood: 0 }, { duration: 1200 });
    this.meter.setMood(false);
    this.meter.set(1, false);
    this.fsCounter.visible = false;
    this.inFreeSpins = false;
    void this.hud.setWin(total);
    this.fsm.go('idle');
    this.idleUi();
    this.continueAuto();
  }

  /** A free spin must complete: keep retrying through network trouble. */
  private async requestFreeSpin(): Promise<SlotRound> {
    for (;;) {
      try {
        return await this.app.server.call('slot.spin', { bet: 0, requestId: this.app.server.newRequestId() });
      } catch (e) {
        this.app.errorToast(e);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async replay(roundId: string) {
    if (!this.fsm.is('idle') || this.inFreeSpins) return;
    let round: SlotRound;
    try {
      round = await this.app.server.call('slot.replay', { roundId });
    } catch (e) {
      this.app.errorToast(e);
      return;
    }
    if (!this.fsm.is('idle')) return;
    this.replayBanner.text = t('replayOf', { id: round.roundId });
    this.replayBanner.visible = true;
    void this.hud.setWin(0);
    if (round.mode === 'free') {
      this.app.background.mood = 1;
      this.meter.setMood(true);
    }
    await this.grid.dropOut();
    await this.present(round, true);
    if (round.mode === 'base' && bigWinTier(round.totalX)) {
      this.fsm.go('bigWin');
      await this.bigWin.play(round.win, round.bet, TIERS, round.capped);
    }
    this.app.background.mood = 0;
    this.meter.setMood(false);
    this.replayBanner.visible = false;
    this.fsm.go('idle');
    this.idleUi();
  }

  // ------------------------------------------------------------ frame

  layout(l: Layout) {
    const W = l.width;
    this.hud.layout(l);
    for (const o of [this.bigWin, this.feature, this.paytable]) o.layout(l);
    if (l.orientation === 'landscape') {
      this.grid.position.set(W / 2, 498);
      this.grid.scale.set(1);
      this.logo.compact(false);
      this.logo.position.set(300, 300);
      this.logo.scale.set(1);
      this.meter.position.set(1620, 360);
      this.meter.scale.set(1);
      this.fsCounter.position.set(1620, 640);
      this.fsCounter.scale.set(1);
      this.replayBanner.position.set(W / 2, 110);
    } else {
      this.grid.position.set(W / 2, 740);
      this.grid.scale.set(1.17);
      this.logo.compact(true);
      this.logo.position.set(W / 2, 175);
      this.logo.scale.set(1);
      this.meter.position.set(140, 1262);
      this.meter.scale.set(0.66);
      this.fsCounter.position.set(W - 148, 1262);
      this.fsCounter.scale.set(0.74);
      this.replayBanner.position.set(W / 2, 260);
    }
  }

  update(dtMs: number) {
    this.hud.update(dtMs);
    this.grid.update(dtMs);
    this.meter.update(dtMs);
    this.bigWin.update(dtMs);
    this.feature.update(dtMs);
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.app.tweens.timeScale = 1;
    this.app.background.mood = 0;
    this.root.destroy({ children: true });
  }
}

/** A random-looking idle grid with no winning clusters (purely cosmetic). */
function idleGrid(): GridData {
  const ids = SYMBOLS.filter((s) => !s.scatter).map((s) => s.id);
  for (;;) {
    const grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => ids[(Math.random() * ids.length) | 0]));
    const counts = new Map<number, number>();
    grid.flat().forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
    if ([...counts.values()].every((n) => n < MIN_CLUSTER)) return grid;
  }
}
