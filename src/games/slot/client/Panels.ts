import { Container, Graphics, Sprite, type BitmapText, type Text } from 'pixi.js';
import type { App } from '../../../core/App';
import { sfx } from '../../../core/Audio';
import { onLocale, t } from '../../../core/i18n';
import { Ease } from '../../../core/Tweens';
import { COLORS, label, num, title } from '../../../ui/text';

/** The glowing multiplier orb. Punches and flares when the value changes. */
export class MultiplierMeter extends Container {
  private glow: Sprite;
  private orb = new Graphics();
  private value: BitmapText;
  private caption: Text;
  private current = 1;
  private time = 0;

  constructor(private readonly app: App) {
    super();
    this.glow = new Sprite(app.atlas.glow);
    this.glow.anchor.set(0.5);
    this.glow.scale.set(1.5);
    this.glow.blendMode = 'add';
    this.glow.tint = 0x8a5bff;
    this.orb
      .circle(0, 0, 92)
      .fill({ color: 0x1a0f3a, alpha: 0.85 })
      .stroke({ color: 0x8a5bff, width: 5 })
      .circle(0, 0, 78)
      .stroke({ color: 0xffffff, width: 1.5, alpha: 0.2 });
    this.value = num('x1', 76, 'numGold');
    this.value.y = 4;
    this.caption = label('', 20, COLORS.dim);
    this.caption.y = 124;
    this.addChild(this.glow, this.orb, this.value, this.caption);
    this.refresh();
    onLocale(this, () => this.refresh());
  }

  private refresh() {
    this.caption.text = t('multiplier');
  }

  set(v: number, fx = true) {
    if (v === this.current) return;
    const up = v > this.current;
    this.current = v;
    this.value.text = `x${v}`;
    if (!fx || !up) return;
    sfx.multiplier(Math.min(10, v));
    this.app.tweens.finishAll(this.value.scale);
    this.value.scale.set(1.6);
    void this.app.tweens.to(this.value.scale, { x: 1, y: 1 }, { duration: 500, ease: Ease.elasticOut });
    this.glow.alpha = 1;
    this.glow.scale.set(2.2);
    void this.app.tweens.to(this.glow.scale, { x: 1.5, y: 1.5 }, { duration: 600 });
  }

  setMood(free: boolean) {
    this.glow.tint = free ? 0xff8a3d : 0x8a5bff;
  }

  update(dtMs: number) {
    this.time += dtMs;
    this.glow.alpha += (0.45 + Math.sin(this.time / 500) * 0.1 - this.glow.alpha) * 0.05;
  }
}

/** "FREE SPINS 3 OF 10" counter, shown only during the feature. */
export class FsCounter extends Container {
  private caption: Text;
  private value: Text;
  private n = 0;
  private total = 0;

  constructor() {
    super();
    const bg = new Graphics()
      .roundRect(-170, -60, 340, 120, 26)
      .fill({ color: 0x2a0a20, alpha: 0.85 })
      .stroke({ color: 0xff8a3d, width: 4 });
    this.caption = label('', 22, 0xffc27a, { fontWeight: '700' });
    this.caption.y = -24;
    this.value = title('', 44);
    this.value.y = 18;
    this.addChild(bg, this.caption, this.value);
    this.visible = false;
    onLocale(this, () => this.refresh());
  }

  set(played: number, total: number) {
    this.n = played;
    this.total = total;
    this.refresh();
  }

  private refresh() {
    this.caption.text = t('freeSpins');
    this.value.text = t('fsCounter', { n: this.n, total: this.total });
  }
}

/** Game logo + tagline. */
export class Logo extends Container {
  private wordmark: Text;
  private sub: Text;
  private sub2: Text;

  constructor() {
    super();
    this.wordmark = title('ASTRAL\nTUMBLE', 84, { lineHeight: 82 });
    this.sub = label('', 26, COLORS.cyan, { fontWeight: '700', letterSpacing: 3 });
    this.sub2 = label('', 20, COLORS.dim, { wordWrap: true, wordWrapWidth: 340, align: 'center' });
    this.addChild(this.wordmark, this.sub, this.sub2);
    this.refresh();
    onLocale(this, () => this.refresh());
  }

  compact(on: boolean) {
    this.wordmark.text = on ? 'ASTRAL TUMBLE' : 'ASTRAL\nTUMBLE';
    this.wordmark.scale.set(on ? 0.8 : 1);
    this.sub.visible = this.sub2.visible = !on;
    this.sub.y = 130;
    this.sub2.y = 180;
  }

  private refresh() {
    this.sub.text = t('tagline');
    this.sub2.text = t('taglineSub');
  }
}
