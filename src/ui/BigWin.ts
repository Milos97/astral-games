import { Container, Graphics, Sprite, type BitmapText, type Text } from 'pixi.js';
import type { App } from '../core/App';
import { sfx } from '../core/Audio';
import { i18n, t, type TKey } from '../core/i18n';
import { Ease } from '../core/Tweens';
import { Particles } from '../fx/Particles';
import { Overlay } from './Overlay';
import { label, num, title } from './text';

export interface WinTier {
  key: TKey;
  x: number;
}

/**
 * Escalating big-win celebration. The amount counts up from zero; each time
 * it crosses the next tier threshold the title upgrades (BIG -> MEGA ->
 * EPIC) with a punch, screen shake, sky flash and a heavier coin fountain.
 * First tap skips to the final amount, second tap closes.
 */
export class BigWin extends Overlay {
  private rays = new Graphics();
  private glow: Sprite;
  private titleText: Text;
  private amount: BitmapText;
  private hint: Text;
  private coins: Particles;
  private tierIndex = -1;
  private fountain = 0;
  private time = 0;

  constructor(private readonly app: App) {
    super(app.tweens, 0.78);
    const atlas = app.atlas;
    this.glow = new Sprite(atlas.glow);
    this.glow.anchor.set(0.5);
    this.glow.scale.set(5);
    this.glow.tint = 0xff8a3d;
    this.glow.blendMode = 'add';
    this.drawRays();
    this.titleText = title('', 150);
    this.titleText.y = -150;
    this.amount = num('', 130, 'numGold');
    this.amount.y = 60;
    this.hint = label('', 26);
    this.hint.y = 230;
    this.coins = new Particles(atlas.coin);
    this.content.addChild(this.glow, this.rays, this.coins.view, this.titleText, this.amount, this.hint);
  }

  async play(win: number, bet: number, tiers: readonly WinTier[], capped = false): Promise<void> {
    this.tierIndex = -1;
    this.titleText.text = '';
    this.amount.text = i18n.fmt(0);
    this.hint.text = t('tapToContinue');
    this.hint.alpha = 0;
    this.fountain = 0;

    const finalTier = tiers.reduce((acc, tier, i) => (win / bet >= tier.x ? i : acc), 0);
    const duration = 2600 + finalTier * 2200;
    this.setTier(0, tiers);
    await this.fadeIn();

    const counter = { v: 0 };
    let skipped = false;
    this.onTap(() => {
      skipped = true;
      this.tweens.finishAll(counter);
    });
    await this.tweens.to(counter, { v: 1 }, {
      duration,
      ease: Ease.sineInOut,
      onUpdate: (k) => {
        const shown = Math.round(win * k);
        this.amount.text = i18n.fmt(shown);
        sfx.tick();
        const x = shown / bet;
        let ti = this.tierIndex;
        while (ti + 1 < tiers.length && x >= tiers[ti + 1].x) ti++;
        if (ti !== this.tierIndex) this.setTier(ti, tiers);
      },
    });
    if (capped) this.titleText.text = t('maxWin');
    if (skipped) this.setTier(finalTier, tiers);
    sfx.fanfare();
    this.app.shake(10);
    this.punch(this.amount, 1.25);
    void this.tweens.to(this.hint, { alpha: 1 }, { duration: 400, delay: 300 });
    await this.waitTapOrTimeout(3200);
    this.fountain = 0;
    await this.fadeOut();
    this.coins.clear();
  }

  private setTier(i: number, tiers: readonly WinTier[]) {
    if (i === this.tierIndex) return;
    this.tierIndex = i;
    this.titleText.text = t(tiers[i].key);
    this.fountain = 1 + i * 1.5;
    this.glow.tint = [0xff8a3d, 0xff4fb8, 0x8a5bff][Math.min(i, 2)];
    this.punch(this.titleText, 1.35);
    sfx.tierUp(i);
    this.app.shake(8 + i * 8);
    this.app.background.pulse = 1;
    this.coins.emit({
      texture: this.app.atlas.coin,
      x: 0,
      y: 40,
      count: 40 + i * 40,
      speed: [500, 1300],
      gravity: 1400,
      life: [1400, 2400],
      scale: [0.35, 0.7],
      flip: true,
      spin: [-2, 2],
    });
  }

  private punch(o: Container, k: number) {
    this.tweens.finishAll(o.scale);
    o.scale.set(k);
    void this.tweens.to(o.scale, { x: 1, y: 1 }, { duration: 600, ease: Ease.elasticOut });
  }

  private drawRays() {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const w = 0.07;
      this.rays
        .poly([0, 0, Math.cos(a - w) * 1100, Math.sin(a - w) * 1100, Math.cos(a + w) * 1100, Math.sin(a + w) * 1100])
        .fill({ color: 0xffe08a, alpha: 0.05 });
    }
  }

  update(dtMs: number) {
    if (!this.visible) return;
    this.time += dtMs;
    this.rays.rotation += dtMs * 0.00018;
    this.glow.alpha = 0.35 + Math.sin(this.time / 300) * 0.1;
    if (this.fountain > 0) {
      const l = this.layoutInfo;
      const bottom = l ? l.height / 2 + 40 : 600;
      this.coins.emit({
        texture: this.app.atlas.coin,
        x: (Math.random() - 0.5) * 700,
        y: bottom,
        count: Math.ceil(this.fountain * (dtMs / 16)),
        speed: [1100, 1700],
        angle: [-Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35],
        gravity: 1500,
        life: [1600, 2200],
        scale: [0.3, 0.6],
        flip: true,
        spin: [-3, 3],
      });
      if (Math.random() < 0.1) sfx.coin();
    }
    this.coins.update(dtMs);
  }
}
