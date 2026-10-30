import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import type { App, DebugHooks, Layout, Scene } from '../../../core/App';
import { sfx } from '../../../core/Audio';
import { i18n, onLocale, t } from '../../../core/i18n';
import { prefs, savePrefs } from '../../../core/Settings';
import { StateMachine } from '../../../core/StateMachine';
import { Ease } from '../../../core/Tweens';
import { Particles } from '../../../fx/Particles';
import type { PlinkoForce, PlinkoRound } from '../../../shared/protocol';
import { BigWin, type WinTier } from '../../../ui/BigWin';
import { Button } from '../../../ui/Button';
import { Hud } from '../../../ui/Hud';
import { COLORS, label, num, title } from '../../../ui/text';
import { BUCKETS, PLINKO_ROWS, RISKS, type Risk } from '../math/engine';

type S = 'boot' | 'idle' | 'active';
const TRANSITIONS: Record<S, readonly S[]> = {
  boot: ['idle'],
  idle: ['active'],
  active: ['idle'],
};

const DX = 64;
const DY = 58;
const HOP_MS = 150;
const MAX_BALLS = 12;
const TIERS: WinTier[] = [
  { key: 'big', x: 15 },
  { key: 'mega', x: 40 },
  { key: 'epic', x: 100 },
];

interface Ball {
  sprite: Sprite;
  round: PlinkoRound;
  /** Index into the path: segment being travelled. */
  seg: number;
  t: number;
  k: number;
}

const BUCKET_COLORS = [0xff3b5c, 0xff5a3d, 0xff8a3d, 0xffb347, 0xffd84a, 0xffe98a, 0xfff3c4];

/**
 * Plinko on the same shell: same HUD, RGS client, atlas, particles,
 * big-win overlay and state machine — only the board and the ball
 * presentation are new. Balls run concurrently; the server decides each
 * path, the client only animates it.
 */
export class PlinkoScene implements Scene {
  readonly root = new Container();
  readonly fsm = new StateMachine<S>('plinko', 'boot', TRANSITIONS);
  private hud: Hud;
  private board = new Container();
  private pegs: Sprite[][] = [];
  private buckets: Container[] = [];
  private bucketLabels: Text[] = [];
  private balls: Ball[] = [];
  private ballLayer = new Container();
  private fx: Particles;
  private bigWin: BigWin;
  private riskButtons: Button[] = [];
  private riskRow = new Container();
  private riskCaption: Text;
  private heading: Text;
  private betIndex = prefs.betIndex;
  private risk: Risk = prefs.risk;
  private display = 0;
  private serverBalance = 0;
  private pending = 0;
  private autoLeft = 0;
  private autoTimer = 0;
  private force: PlinkoForce | null = null;
  private bigWinQueue: { win: number; bet: number }[] = [];
  private showingBigWin = false;
  private disposers: (() => void)[] = [];

  readonly debug: DebugHooks = {
    fsm: this.fsm as unknown as StateMachine<string>,
    forces: ['edge', 'centre'],
    setForce: (f) => (this.force = f as PlinkoForce | null),
  };

  constructor(private readonly app: App) {
    this.hud = new Hud(app.tweens, { title: 'plinkoTitle', spinLabel: 'drop', autoplay: true });
    this.fx = new Particles(app.atlas.spark);
    this.bigWin = new BigWin(app);
    this.heading = title('PLINKO', 90);
    this.riskCaption = label('', 22);
    this.buildBoard();
    this.buildRisk();
    this.root.addChild(this.heading, this.board, this.riskRow, this.hud, this.bigWin);
    this.board.addChild(this.ballLayer, this.fx.view);
    app.tweens.timeScale = 1;

    const e = this.hud.events;
    this.disposers.push(
      e.on('spin', () => this.onDrop()),
      e.on('betUp', () => this.changeBet(1)),
      e.on('betDown', () => this.changeBet(-1)),
      e.on('auto', (n) => {
        this.autoLeft = n;
        this.autoTimer = 0;
        this.syncUi();
      }),
      e.on('lobby', () => this.app.goto('lobby')),
      e.on('info', () => this.app.toast(t('plinkoDesc'), 'info', 3000)),
    );
    onLocale(this.root, () => this.refreshText());
    this.refreshText();
    void this.start();
  }

  private get bet() {
    return this.app.session.betLevels[this.betIndex];
  }

  private async start() {
    const info = await this.app.server.call('session.init', {});
    this.app.session = info;
    this.serverBalance = this.display = info.balance;
    this.hud.setBalance(this.display);
    this.hud.setBet(this.bet);
    void this.hud.setWin(0);
    this.fsm.go('idle');
    this.syncUi();
  }

  // ------------------------------------------------------------ board

  private pegPos(row: number, i: number) {
    return { x: (i - (row + 2) / 2) * DX, y: row * DY };
  }

  private bucketX(b: number) {
    return (b - PLINKO_ROWS / 2) * DX;
  }

  private get bucketY() {
    return PLINKO_ROWS * DY + 10;
  }

  private buildBoard() {
    const w = (PLINKO_ROWS + 3) * DX;
    const frame = new Graphics()
      .roundRect(-w / 2, -DY * 1.6, w, PLINKO_ROWS * DY + DY * 3.4, 36)
      .fill({ color: 0x120a2a, alpha: 0.7 })
      .stroke({ color: COLORS.panelEdge, width: 3 });
    this.board.addChild(frame);
    for (let r = 0; r < PLINKO_ROWS; r++) {
      const row: Sprite[] = [];
      for (let i = 0; i < r + 3; i++) {
        const p = new Sprite(this.app.atlas.peg);
        p.anchor.set(0.5);
        p.scale.set(0.42);
        const { x, y } = this.pegPos(r, i);
        p.position.set(x, y);
        this.board.addChild(p);
        row.push(p);
      }
      this.pegs.push(row);
    }
    for (let b = 0; b <= PLINKO_ROWS; b++) {
      const c = new Container();
      c.position.set(this.bucketX(b), this.bucketY);
      const color = BUCKET_COLORS[Math.min(b, PLINKO_ROWS - b)];
      c.addChild(
        new Graphics()
          .roundRect(-DX / 2 + 3, -22, DX - 6, 44, 10)
          .fill({ color, alpha: 0.9 })
          .roundRect(-DX / 2 + 3, -22, DX - 6, 16, 8)
          .fill({ color: 0xffffff, alpha: 0.2 }),
      );
      const txt = label('', 17, 0x2a0a20, { fontWeight: '700', letterSpacing: 0 });
      c.addChild(txt);
      this.bucketLabels.push(txt);
      this.buckets.push(c);
      this.board.addChild(c);
    }
  }

  private buildRisk() {
    this.riskRow.addChild(this.riskCaption);
    this.riskCaption.y = -52;
    RISKS.forEach((r, i) => {
      const b = new Button({
        width: 170,
        height: 60,
        radius: 18,
        label: label('', 24, 0xffffff, { fontWeight: '700' }),
        onTap: () => this.setRisk(r),
      });
      b.x = (i - 1) * 186;
      b.active = r === this.risk;
      this.riskButtons.push(b);
      this.riskRow.addChild(b);
    });
  }

  private refreshText() {
    this.riskCaption.text = t('risk');
    RISKS.forEach((r, i) => ((this.riskButtons[i].content.children[0] as Text).text = t(r)));
    BUCKETS[this.risk].forEach((m, b) => (this.bucketLabels[b].text = `${m}x`));
  }

  private setRisk(r: Risk) {
    if (this.balls.length || this.pending) return;
    this.risk = r;
    savePrefs({ risk: r });
    this.riskButtons.forEach((b, i) => (b.active = RISKS[i] === r));
    this.refreshText();
  }

  private changeBet(dir: number) {
    if (!this.fsm.is('idle')) return;
    const next = Math.max(0, Math.min(this.app.session.betLevels.length - 1, this.betIndex + dir));
    this.betIndex = next;
    savePrefs({ betIndex: next });
    this.hud.setBet(this.bet);
  }

  // ------------------------------------------------------------ play

  private onDrop() {
    if (this.autoLeft > 0) {
      this.autoLeft = 0;
      this.syncUi();
      return;
    }
    void this.drop();
  }

  onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    if (this.bigWin.visible) this.bigWin.tap();
    else this.onDrop();
  }

  private async drop() {
    if (this.fsm.is('boot')) return;
    if (this.balls.length + this.pending >= MAX_BALLS) return;
    const bet = this.bet;
    if (this.display < bet) {
      this.app.toast(t('insufficientFunds'), 'warn');
      this.autoLeft = 0;
      this.syncUi();
      return;
    }
    sfx.click();
    if (this.fsm.is('idle')) this.fsm.go('active');
    this.pending++;
    this.display -= bet;
    this.hud.setBalance(this.display);
    this.syncUi();
    try {
      const force = this.force ?? undefined;
      this.force = null;
      const round = await this.app.server.call('plinko.drop', {
        bet,
        risk: this.risk,
        requestId: this.app.server.newRequestId(),
        force,
      });
      this.serverBalance = round.balanceAfter;
      this.spawn(round);
    } catch (e) {
      this.display += bet;
      this.hud.setBalance(this.display);
      this.autoLeft = 0;
      this.app.errorToast(e);
    } finally {
      this.pending--;
      this.settleIfDone();
    }
  }

  private spawn(round: PlinkoRound) {
    const sprite = new Sprite(this.app.atlas.ball);
    sprite.anchor.set(0.5);
    sprite.scale.set(0.5);
    const start = this.pegPos(0, 1);
    sprite.position.set(start.x + (Math.random() - 0.5) * 6, start.y - DY * 1.1);
    this.ballLayer.addChild(sprite);
    this.balls.push({ sprite, round, seg: -1, t: 0, k: 0 });
  }

  /** Ball position along its server-decided path: hop from peg to peg. */
  private stepBall(ball: Ball, dtMs: number): boolean {
    ball.t += dtMs / HOP_MS;
    while (ball.t >= 1) {
      ball.t -= 1;
      ball.seg++;
      if (ball.seg >= 0 && ball.seg < PLINKO_ROWS) {
        const peg = this.pegs[ball.seg][ball.k + 1];
        this.hitPeg(peg, ball.seg);
        ball.k += ball.round.path[ball.seg];
      }
      if (ball.seg >= PLINKO_ROWS) return true;
    }
    const contact = (row: number, k: number) => {
      const p = this.pegPos(row, k + 1);
      return { x: p.x, y: p.y - 22 };
    };
    let from: { x: number; y: number };
    let to: { x: number; y: number };
    if (ball.seg < 0) {
      from = { x: ball.sprite.x, y: this.pegPos(0, 1).y - DY * 1.1 };
      to = contact(0, 0);
    } else {
      const r = ball.seg;
      from = contact(r, ball.k - ball.round.path[r]);
      from = { x: from.x, y: from.y };
      to = r + 1 < PLINKO_ROWS ? contact(r + 1, ball.k) : { x: this.bucketX(ball.k), y: this.bucketY - 14 };
    }
    const tt = ball.t;
    // horizontal eases out (bounce off the peg), vertical is a small hop then gravity
    ball.sprite.x = from.x + (to.x - from.x) * Ease.quadOut(tt);
    ball.sprite.y = from.y + (to.y - from.y) * tt * tt - Math.sin(tt * Math.PI) * (ball.seg < 0 ? 0 : 14);
    return false;
  }

  private hitPeg(peg: Sprite, row: number) {
    sfx.peg(row);
    peg.tint = 0xffc2ff;
    peg.scale.set(0.62);
    void this.app.tweens.to(peg.scale, { x: 0.42, y: 0.42 }, { duration: 240, ease: Ease.quadOut }).then(() => (peg.tint = 0xffffff));
  }

  private land(ball: Ball) {
    const { round } = ball;
    const bucket = this.buckets[round.bucket];
    sfx.bucket(round.multiplier);
    this.app.tweens.finishAll(bucket);
    bucket.y = this.bucketY + 14;
    void this.app.tweens.to(bucket, { y: this.bucketY }, { duration: 380, ease: Ease.backOut });
    const color = BUCKET_COLORS[Math.min(round.bucket, PLINKO_ROWS - round.bucket)];
    this.fx.emit({ texture: this.app.atlas.sparkle, x: bucket.x, y: this.bucketY, count: round.multiplier >= 1 ? 24 : 6, speed: [100, 360], angle: [-Math.PI, 0], gravity: 500, life: [400, 800], scale: [0.15, 0.35], tint: [color, 0xffffff] });

    this.display += round.win;
    this.hud.setBalance(this.display);
    void this.hud.setWin(round.win, 300);
    if (round.win > 0) {
      const pop = num(`+${i18n.fmt(round.win)}`, 34, 'numGold');
      pop.position.set(bucket.x, this.bucketY - 50);
      this.board.addChild(pop);
      void this.app.tweens.to(pop, { y: pop.y - 70, alpha: 0 }, { duration: 1100, ease: Ease.quadOut }).then(() => pop.destroy());
    }
    if (round.multiplier >= TIERS[0].x) {
      this.app.shake(10);
      this.bigWinQueue.push({ win: round.win, bet: round.bet });
      void this.playBigWins();
    }
    ball.sprite.destroy();
    this.app.gami.reveal(round.roundId);
  }

  private async playBigWins() {
    if (this.showingBigWin) return;
    this.showingBigWin = true;
    while (this.bigWinQueue.length) {
      const { win, bet } = this.bigWinQueue.shift()!;
      await this.bigWin.play(win, bet, TIERS);
    }
    this.showingBigWin = false;
  }

  private settleIfDone() {
    if (this.balls.length === 0 && this.pending === 0 && this.fsm.is('active')) {
      this.fsm.go('idle');
      // all rounds settled: snap to the server's authoritative balance
      this.display = this.serverBalance;
      this.hud.setBalance(this.display);
      this.syncUi();
    }
  }

  private syncUi() {
    const busy = !this.fsm.is('idle');
    this.hud.setBetEnabled(!busy && this.autoLeft === 0);
    this.hud.setSpinMode(this.autoLeft > 0 ? 'auto' : 'spin', this.autoLeft);
    this.riskButtons.forEach((b) => (b.enabled = !busy && this.autoLeft === 0));
  }

  busy() {
    return !this.fsm.is('idle') || this.autoLeft > 0;
  }

  // ------------------------------------------------------------ frame

  layout(l: Layout) {
    const W = l.width;
    this.hud.layout(l);
    this.bigWin.layout(l);
    if (l.orientation === 'landscape') {
      this.board.position.set(W / 2 + 60, 190);
      this.board.scale.set(0.95);
      this.heading.position.set(300, 330);
      this.riskRow.position.set(300, 560);
      this.riskRow.scale.set(0.8);
    } else {
      this.board.position.set(W / 2, 330);
      this.board.scale.set(1.03);
      this.heading.position.set(W / 2, 170);
      this.riskRow.position.set(W / 2, 1220);
      this.riskRow.scale.set(1);
    }
  }

  update(dtMs: number) {
    this.hud.update(dtMs);
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (this.stepBall(b, dtMs)) {
        this.balls.splice(i, 1);
        this.land(b);
        this.settleIfDone();
      } else if (prefs.quality === 'high') {
        this.fx.emit({ texture: this.app.atlas.spark, x: b.sprite.x, y: b.sprite.y, count: 1, speed: [0, 20], life: [200, 320], scale: [0.18, 0.24], scaleEnd: 0.2, tint: 0xff7cd0 });
      }
    }
    this.fx.update(dtMs);
    this.bigWin.update(dtMs);

    if (this.autoLeft > 0 && !this.fsm.is('boot')) {
      this.autoTimer -= dtMs;
      if (this.autoTimer <= 0 && this.balls.length + this.pending < MAX_BALLS) {
        this.autoTimer = 260;
        this.autoLeft--;
        void this.drop();
        this.syncUi();
      }
    }
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.root.destroy({ children: true });
  }
}
