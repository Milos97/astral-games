import { Container, Graphics, Text } from 'pixi.js';
import { Ease } from '../core/Tweens';
import { FONT } from './text';

export type ToastKind = 'info' | 'warn' | 'error' | 'ok';
const tones: Record<ToastKind, number> = { info: 0x5a3fa8, warn: 0xe0a020, error: 0xe0304a, ok: 0x2fbf71 };

/** Stacked notifications at the top of the design area. */
export class Toasts extends Container {
  private items: Container[] = [];

  show(message: string, kind: ToastKind = 'info', ms = 2600) {
    const item = new Container();
    const text = new Text({ text: message, style: { fontFamily: FONT, fontSize: 26, fontWeight: '600', fill: 0xffffff } });
    text.anchor.set(0.5);
    const w = text.width + 64;
    const bg = new Graphics()
      .roundRect(-w / 2, -28, w, 56, 28)
      .fill({ color: 0x120a2a, alpha: 0.92 })
      .stroke({ color: tones[kind], width: 3 })
      .circle(-w / 2 + 26, 0, 7)
      .fill(tones[kind]);
    text.x = 10;
    item.addChild(bg, text);
    item.alpha = 0;
    item.y = -30;
    this.addChild(item);
    this.items.unshift(item);
    this.restack();

    // toasts run on real time, not game time (turbo / slam must not hide them)
    const fade = (to: number, dur: number) =>
      new Promise<void>((resolve) => {
        const from = item.alpha;
        const t0 = performance.now();
        const step = () => {
          if (item.destroyed) return resolve();
          const k = Math.min(1, (performance.now() - t0) / dur);
          item.alpha = from + (to - from) * Ease.cubicOut(k);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
    void fade(1, 200)
      .then(() => new Promise((r) => setTimeout(r, ms)))
      .then(() => fade(0, 300))
      .then(() => {
        this.items = this.items.filter((i) => i !== item);
        item.destroy({ children: true });
        this.restack();
      });
  }

  private restack() {
    this.items.forEach((item, i) => {
      item.y = i * 66;
    });
  }
}
