import { Container, FillGradient, Graphics, type BitmapText } from 'pixi.js';
import type { App } from '../../../core/App';
import { sfx } from '../../../core/Audio';
import { i18n } from '../../../core/i18n';
import { prefs } from '../../../core/Settings';
import { Ease } from '../../../core/Tweens';
import { DissolveFilter } from '../../../fx/filters';
import { Particles } from '../../../fx/Particles';
import { num } from '../../../ui/text';
import { COLS, ROWS, SCATTER } from '../math/config';
import type { Cell, Grid as GridData, TumbleStep } from '../math/engine';
import { SymbolView } from './SymbolView';

const PAD = 18;

/**
 * The 6x5 playfield. Owns symbol views (pooled), the masked symbol layer,
 * its own particle layer for explosions, and every grid animation:
 * drop out, drop in (with scatter anticipation), win highlight, explode,
 * tumble. All animation goes through app.tweens so slam-stop and turbo
 * apply uniformly.
 */
export class Grid extends Container {
  readonly cell: number;
  private frame = new Graphics();
  private anticipation = new Graphics();
  private symbols = new Container();
  private maskShape = new Graphics();
  private popups = new Container();
  readonly fx: Particles;
  private views: (SymbolView | null)[][] = [];
  private pool: SymbolView[] = [];
  data: GridData = [];

  constructor(
    private readonly app: App,
    cell: number,
  ) {
    super();
    this.cell = cell;
    this.fx = new Particles(app.atlas.spark);
    this.drawFrame();
    this.symbols.mask = this.maskShape;
    this.addChild(this.frame, this.anticipation, this.symbols, this.maskShape, this.fx.view, this.popups);
    for (let c = 0; c < COLS; c++) this.views.push(Array(ROWS).fill(null));
  }

  get w() {
    return COLS * this.cell;
  }

  get h() {
    return ROWS * this.cell;
  }

  pos(c: number, r: number) {
    return { x: (c + 0.5) * this.cell - this.w / 2, y: (r + 0.5) * this.cell - this.h / 2 };
  }

  private drawFrame() {
    const { w, h, cell } = this;
    const bg = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 'rgba(40,20,90,0.82)' },
        { offset: 1, color: 'rgba(12,6,36,0.9)' },
      ],
      textureSpace: 'local',
    });
    this.frame
      .roundRect(-w / 2 - PAD - 6, -h / 2 - PAD - 6, w + PAD * 2 + 12, h + PAD * 2 + 12, 34)
      .fill({ color: 0xff4fb8, alpha: 0.12 })
      .roundRect(-w / 2 - PAD, -h / 2 - PAD, w + PAD * 2, h + PAD * 2, 28)
      .fill(bg)
      .stroke({ color: 0x8a5bff, width: 4 })
      .roundRect(-w / 2 - PAD + 6, -h / 2 - PAD + 6, w + PAD * 2 - 12, h + PAD * 2 - 12, 24)
      .stroke({ color: 0xffffff, width: 1.5, alpha: 0.15 });
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const { x, y } = this.pos(c, r);
        this.frame
          .roundRect(x - cell / 2 + 4, y - cell / 2 + 4, cell - 8, cell - 8, 16)
          .fill({ color: (c + r) % 2 ? 0x2a1a5e : 0x23154f, alpha: 0.55 });
      }
    }
    this.maskShape.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 20).fill(0xffffff);
  }

  private take(id: number): SymbolView {
    const v = (this.pool.pop() ?? new SymbolView(this.app.atlas)).set(id, this.cell);
    this.symbols.addChild(v);
    return v;
  }

  private recycle(v: SymbolView) {
    this.app.tweens.kill(v);
    this.app.tweens.kill(v.scale);
    this.symbols.removeChild(v);
    this.pool.push(v);
  }

  /** Show a grid without animation (boot / restore). */
  setInstant(grid: GridData) {
    this.clearViews();
    this.data = grid.map((c) => c.slice());
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const v = this.take(grid[c][r]);
        const p = this.pos(c, r);
        v.position.set(p.x, p.y);
        this.views[c][r] = v;
      }
    }
  }

  private clearViews() {
    for (const col of this.views) {
      for (let r = 0; r < ROWS; r++) {
        if (col[r]) this.recycle(col[r]!);
        col[r] = null;
      }
    }
  }

  /** Current symbols fall out of the bottom. */
  async dropOut(): Promise<void> {
    const tw = this.app.tweens;
    const jobs: Promise<void>[] = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const v = this.views[c][r];
        if (!v) continue;
        v.setHighlight(false);
        this.views[c][r] = null;
        jobs.push(
          tw
            .to(v, { y: v.y + this.h + this.cell }, { duration: 320, delay: c * 45 + (ROWS - 1 - r) * 22, ease: Ease.quadIn })
            .then(() => this.recycle(v)),
        );
      }
    }
    await Promise.all(jobs);
  }

  /**
   * New grid drops in column by column. Once `anticipateAt` scatters have
   * landed, every following column is held back with a glow and a riser so
   * the player feels the feature might trigger.
   */
  async dropIn(grid: GridData, anticipateAt: number): Promise<void> {
    const tw = this.app.tweens;
    this.clearViews();
    this.data = grid.map((c) => c.slice());
    const jobs: Promise<void>[] = [];
    let delay = 0;
    let scatters = 0;
    this.anticipation.clear();

    for (let c = 0; c < COLS; c++) {
      if (scatters >= anticipateAt) {
        delay += 950;
        this.flashAnticipation(c, delay - 950);
      }
      let colScatters = 0;
      for (let r = 0; r < ROWS; r++) {
        const id = grid[c][r];
        const v = this.take(id);
        const p = this.pos(c, r);
        v.position.set(p.x, p.y - this.h - this.cell * 0.6);
        this.views[c][r] = v;
        const isScatter = id === SCATTER;
        if (isScatter) colScatters++;
        const job = tw.to(v, { y: p.y }, { duration: 430, delay: delay + (ROWS - 1 - r) * 34, ease: Ease.backOut });
        jobs.push(r === ROWS - 1 ? job.then(() => this.landed(c)) : job);
        if (isScatter) {
          const n = scatters + colScatters;
          void job.then(() => this.scatterLanded(v, n));
        }
      }
      scatters += colScatters;
      delay += 105;
    }
    await Promise.all(jobs);
    this.anticipation.clear();
  }

  private landed(c: number) {
    if (!this.app.tweens.skipping) sfx.land(c);
    for (let r = 0; r < ROWS; r++) {
      const v = this.views[c][r];
      if (!v) continue;
      v.scale.set(1.06, 0.92);
      void this.app.tweens.to(v.scale, { x: 1, y: 1 }, { duration: 260, ease: Ease.backOut });
    }
  }

  private scatterLanded(v: SymbolView, n: number) {
    if (!this.app.tweens.skipping) sfx.scatterLand(n);
    this.fx.emit({ texture: this.app.atlas.sparkle, x: v.x, y: v.y, count: 10, speed: [80, 260], life: [400, 800], scale: [0.15, 0.35], scaleEnd: 0.2, tint: 0xffc2ff });
  }

  private flashAnticipation(c: number, at: number) {
    const tw = this.app.tweens;
    void tw.wait(at).then(() => {
      if (!tw.skipping) sfx.anticipation();
      const { x } = this.pos(c, 0);
      this.anticipation
        .clear()
        .roundRect(x - this.cell / 2, -this.h / 2, this.cell, this.h, 18)
        .fill({ color: 0xff7cf2, alpha: 0.28 })
        .stroke({ color: 0xffc2ff, width: 4, alpha: 0.9 });
      this.fx.emit({
        texture: this.app.atlas.spark,
        x,
        y: this.h / 2,
        count: 40,
        speed: [200, 500],
        angle: [-Math.PI / 2 - 0.15, -Math.PI / 2 + 0.15],
        life: [500, 900],
        scale: [0.1, 0.3],
        tint: [0xff7cf2, 0xffffff],
        spread: this.cell * 0.4,
      });
    });
  }

  /** Highlight winning clusters and pop their amounts. */
  async showWins(step: TumbleStep, bet: number, depth: number): Promise<void> {
    const tw = this.app.tweens;
    if (!tw.skipping) sfx.win(depth);
    const labels: BitmapText[] = [];
    for (const win of step.wins) {
      let sx = 0;
      let sy = 0;
      for (const [c, r] of win.positions) {
        this.views[c][r]?.setHighlight(true);
        const p = this.pos(c, r);
        sx += p.x;
        sy += p.y;
      }
      const amount = Math.round(win.payX * step.multiplier * bet);
      const text = num(i18n.fmt(amount), 58, 'numGold');
      text.position.set(sx / win.positions.length, sy / win.positions.length);
      text.scale.set(0);
      this.popups.addChild(text);
      labels.push(text);
      void tw.to(text.scale, { x: 1, y: 1 }, { duration: 420, ease: Ease.backOut });
    }
    await tw.wait(720);
    for (const l of labels) {
      void tw.to(l, { y: l.y - 50, alpha: 0 }, { duration: 500, delay: 250 }).then(() => l.destroy());
    }
  }

  async explode(cells: readonly Cell[]): Promise<void> {
    const tw = this.app.tweens;
    if (!tw.skipping) sfx.explode();
    this.app.shake(4);
    const hq = prefs.quality === 'high';
    const jobs = cells.map(([c, r]) => {
      const v = this.views[c][r];
      if (!v) return Promise.resolve();
      v.setHighlight(false);
      this.views[c][r] = null;
      const color = v.color;
      this.fx.emit({ texture: this.app.atlas.shard, x: v.x, y: v.y, count: hq ? 12 : 5, speed: [180, 560], gravity: 900, drag: 0.4, life: [500, 900], scale: [0.18, 0.4], scaleEnd: 0.3, spin: [-10, 10], tint: color });
      this.fx.emit({ texture: this.app.atlas.spark, x: v.x, y: v.y, count: hq ? 8 : 3, speed: [40, 220], life: [300, 600], scale: [0.25, 0.6], scaleEnd: 0, tint: [color, 0xffffff] });
      this.fx.emit({ texture: this.app.atlas.ring, x: v.x, y: v.y, count: 1, speed: [0, 0], life: [380, 380], scale: [0.15, 0.15], scaleEnd: 6, tint: color });

      if (hq) {
        const f = new DissolveFilter(color);
        v.sprite.filters = [f];
        return Promise.all([
          tw.to(f, { progress: 1 }, { duration: 420, ease: Ease.quadIn }),
          tw.to(v.scale, { x: 1.2, y: 1.2 }, { duration: 420, ease: Ease.quadOut }),
        ]).then(() => {
          v.sprite.filters = null;
          f.destroy();
          this.recycle(v);
        });
      }
      return tw.to(v.scale, { x: 0, y: 0 }, { duration: 260, ease: Ease.backIn }).then(() => this.recycle(v));
    });
    await Promise.all(jobs);
  }

  /** Survivors fall into the gaps, refill symbols drop in from the top. */
  async tumble(step: TumbleStep): Promise<void> {
    const tw = this.app.tweens;
    if (!tw.skipping) sfx.tumble();
    const jobs: Promise<void>[] = [];
    for (let c = 0; c < COLS; c++) {
      const kept = this.views[c].filter((v): v is SymbolView => v !== null);
      const fresh = step.refill[c].map((id, i) => {
        const v = this.take(id);
        const p = this.pos(c, i);
        v.position.set(p.x, p.y - step.refill[c].length * this.cell - this.cell * 0.4);
        return v;
      });
      const column = [...fresh, ...kept];
      for (let r = 0; r < ROWS; r++) {
        const v = column[r];
        this.views[c][r] = v;
        const target = this.pos(c, r).y;
        if (Math.abs(v.y - target) < 0.5) continue;
        const dist = (target - v.y) / this.cell;
        jobs.push(
          tw.to(v, { y: target }, { duration: 260 + dist * 40, delay: c * 28 + (ROWS - 1 - r) * 30, ease: Ease.bounceOut }),
        );
      }
    }
    await Promise.all(jobs);
    this.data = step.gridAfter.map((c) => c.slice());
    this.verify();
  }

  async celebrateScatters(cells: readonly Cell[]): Promise<void> {
    for (const [c, r] of cells) {
      const v = this.views[c][r];
      if (!v) continue;
      v.setHighlight(true);
      this.fx.emit({ texture: this.app.atlas.sparkle, x: v.x, y: v.y, count: 18, speed: [120, 380], life: [600, 1100], scale: [0.2, 0.45], scaleEnd: 0.1, tint: [0xff7cf2, 0xffffff, 0xffd84a] });
    }
    this.app.background.pulse = 1;
    await this.app.tweens.wait(1300);
    for (const [c, r] of cells) this.views[c][r]?.setHighlight(false);
  }

  /** Dev check: the views on screen must equal the server's grid. */
  private verify() {
    if (!import.meta.env.DEV) return;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (this.views[c][r]?.id !== this.data[c][r]) {
          console.error(`[grid] desync at ${c},${r}: view=${this.views[c][r]?.id} data=${this.data[c][r]}`);
        }
      }
    }
  }

  update(dtMs: number) {
    for (const col of this.views) for (const v of col) v?.update(dtMs);
    this.fx.update(dtMs);
  }
}
