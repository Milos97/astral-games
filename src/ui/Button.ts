import { Container, FillGradient, Graphics, Ticker, type Text } from 'pixi.js';
import { sfx } from '../core/Audio';
import { COLORS } from './text';

export interface ButtonOptions {
  width: number;
  height: number;
  radius?: number;
  colors?: [top: string, bottom: string];
  edge?: number;
  icon?: Container;
  label?: Text;
  onTap: () => void;
  silent?: boolean;
}

/**
 * Pointer-driven button with hover/press feedback. Scale feedback is done
 * with a damped spring in update() instead of tweens so rapid presses
 * never queue animations.
 */
export class Button extends Container {
  readonly bg = new Graphics();
  readonly content = new Container();
  private _enabled = true;
  private _active = false;
  private target = 1;
  private vel = 0;
  private s = 1;

  constructor(private readonly opts: ButtonOptions) {
    super();
    this.addChild(this.bg, this.content);
    if (opts.icon) this.content.addChild(opts.icon);
    if (opts.label) this.content.addChild(opts.label);
    this.redraw();

    const tick = (t: Ticker) => this.update(t.deltaMS);
    Ticker.shared.add(tick);
    this.once('destroyed', () => Ticker.shared.remove(tick));

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => (this.target = this._enabled ? 1.06 : 1));
    this.on('pointerout', () => (this.target = 1));
    this.on('pointerdown', () => (this.target = this._enabled ? 0.92 : 1));
    this.on('pointerup', () => (this.target = 1));
    this.on('pointerupoutside', () => (this.target = 1));
    this.on('pointertap', () => {
      if (!this._enabled) return;
      if (!opts.silent) sfx.click();
      opts.onTap();
    });
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v: boolean) {
    if (v === this._enabled) return;
    this._enabled = v;
    this.alpha = v ? 1 : 0.4;
    this.cursor = v ? 'pointer' : 'default';
  }

  /** Toggle-style highlighted state (turbo on, autoplay running...). */
  set active(v: boolean) {
    if (v === this._active) return;
    this._active = v;
    this.redraw();
  }

  get active() {
    return this._active;
  }

  /** Swap the icon. Removed icons are not destroyed unless asked: callers often reuse them. */
  setIcon(icon: Container, destroyOld = false) {
    const old = this.content.removeChildren();
    if (destroyOld) old.forEach((c) => c !== icon && c !== this.opts.label && c.destroy());
    this.content.addChild(icon);
    if (this.opts.label) this.content.addChild(this.opts.label);
  }

  private redraw() {
    const { width: w, height: h } = this.opts;
    const r = this.opts.radius ?? h / 2;
    const [top, bottom] = this._active ? ['#ff7ad0', '#b0127a'] : (this.opts.colors ?? ['#3a2a7a', '#1d1248']);
    const fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: top },
        { offset: 1, color: bottom },
      ],
      textureSpace: 'local',
    });
    this.bg
      .clear()
      .roundRect(-w / 2, -h / 2 + 4, w, h, r)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(-w / 2, -h / 2, w, h, r)
      .fill(fill)
      .stroke({ color: this._active ? 0xffc2ec : (this.opts.edge ?? COLORS.panelEdge), width: 3, alignment: 1 })
      .roundRect(-w / 2 + 6, -h / 2 + 4, w - 12, h * 0.38, r * 0.8)
      .fill({ color: 0xffffff, alpha: 0.08 });
  }

  private update(dtMs: number) {
    if (this.s === this.target && this.vel === 0) return;
    // under-damped spring toward the target scale, fixed 16ms substeps so
    // it behaves the same at 30 and 144 fps
    for (let left = Math.min(dtMs, 100); left > 0; left -= 16) {
      const dt = Math.min(16, left) / 16;
      this.vel += (this.target - this.s) * 0.5 * dt;
      this.vel *= 1 - 0.35 * dt;
      this.s += this.vel * dt;
    }
    if (Math.abs(this.target - this.s) < 0.001 && Math.abs(this.vel) < 0.001) {
      this.s = this.target;
      this.vel = 0;
    }
    this.scale.set(this.s);
  }
}
