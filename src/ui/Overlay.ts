import { Container, Graphics } from 'pixi.js';
import type { Layout } from '../core/App';
import { Ease, type Tweens } from '../core/Tweens';

/**
 * Base for full-screen overlays (big win, feature intro/outro, paytable):
 * a dimmer that covers the whole screen regardless of design-space letterboxing,
 * a centred content container, fade in/out, and tap handling.
 */
export class Overlay extends Container {
  protected readonly dim = new Graphics();
  readonly content = new Container();
  protected layoutInfo: Layout | null = null;
  private tapHandler: (() => void) | null = null;

  constructor(
    protected readonly tweens: Tweens,
    private readonly dimAlpha = 0.72,
  ) {
    super();
    this.visible = false;
    this.addChild(this.dim, this.content);
    this.eventMode = 'static';
    this.on('pointertap', () => this.tapHandler?.());
  }

  /** Keyboard equivalent of tapping the overlay. */
  tap() {
    this.tapHandler?.();
  }

  onTap(fn: (() => void) | null) {
    this.tapHandler = fn;
  }

  layout(l: Layout) {
    this.layoutInfo = l;
    // cover the full screen: design space may be letterboxed
    const ox = (l.screenW / l.scale - l.width) / 2;
    const oy = (l.screenH / l.scale - l.height) / 2;
    this.dim
      .clear()
      .rect(-ox - 2, -oy - 2, l.width + ox * 2 + 4, l.height + oy * 2 + 4)
      .fill({ color: 0x05010f, alpha: this.dimAlpha });
    this.content.position.set(l.width / 2, l.height / 2);
  }

  async fadeIn(ms = 260) {
    this.visible = true;
    this.alpha = 0;
    this.content.scale.set(0.85);
    await Promise.all([
      this.tweens.to(this as Container, { alpha: 1 }, { duration: ms }),
      this.tweens.to(this.content.scale, { x: 1, y: 1 }, { duration: ms * 1.6, ease: Ease.backOut }),
    ]);
  }

  async fadeOut(ms = 240) {
    this.onTap(null);
    await this.tweens.to(this as Container, { alpha: 0 }, { duration: ms });
    this.visible = false;
  }

  /** Resolve on tap or after `ms` (whichever first). */
  waitTapOrTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.onTap(null);
        resolve();
      };
      this.onTap(finish);
      void this.tweens.wait(ms).then(finish);
    });
  }
}
