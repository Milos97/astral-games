import { Graphics, Sprite, type BitmapText, type Text } from 'pixi.js';
import type { App } from '../../../core/App';
import { sfx } from '../../../core/Audio';
import { i18n, t } from '../../../core/i18n';
import { Ease } from '../../../core/Tweens';
import { Particles } from '../../../fx/Particles';
import { Overlay } from '../../../ui/Overlay';
import { COLORS, label, num, title } from '../../../ui/text';

/** Free-spins intro, retrigger banner and outro summary. */
export class FeatureOverlay extends Overlay {
  private panel = new Graphics();
  private portal: Sprite;
  private heading: Text;
  private sub: Text;
  private amount: BitmapText;
  private hint: Text;
  private sparks: Particles;

  constructor(private readonly app: App) {
    super(app.tweens, 0.6);
    this.portal = new Sprite(app.atlas.symbols[8]);
    this.portal.anchor.set(0.5);
    this.portal.scale.set(0.9);
    this.portal.y = -235;
    this.panel
      .roundRect(-470, -230, 940, 460, 40)
      .fill({ color: 0x1a0626, alpha: 0.9 })
      .stroke({ color: 0xff8a3d, width: 5 })
      .roundRect(-458, -218, 916, 436, 32)
      .stroke({ color: 0xffffff, width: 1.5, alpha: 0.18 });
    this.heading = title('', 96);
    this.heading.y = -70;
    this.sub = label('', 28, COLORS.text, { wordWrap: true, wordWrapWidth: 780, align: 'center' });
    this.sub.y = 40;
    this.amount = num('', 110, 'numGold');
    this.amount.y = 50;
    this.hint = label('', 24, COLORS.dim);
    this.hint.y = 170;
    this.sparks = new Particles(app.atlas.spark);
    this.content.addChild(this.panel, this.portal, this.sparks.view, this.heading, this.sub, this.amount, this.hint);
  }

  private setHeading(text: string) {
    this.heading.text = text;
    this.heading.scale.set(Math.min(1, 860 / this.heading.width));
  }

  private burst() {
    this.sparks.emit({ texture: this.app.atlas.sparkle, x: 0, y: -60, count: 70, speed: [200, 700], drag: 0.3, life: [700, 1400], scale: [0.2, 0.5], scaleEnd: 0.1, tint: [0xff8a3d, 0xffd84a, 0xffffff, 0xff4fb8] });
  }

  async intro(spins: number, autoMs: number) {
    this.panel.visible = true;
    this.portal.visible = true;
    this.setHeading(t('fsAwarded', { n: spins }));
    this.sub.text = t('fsSubtitle');
    this.sub.visible = true;
    this.amount.visible = false;
    this.hint.text = t('tapToContinue');
    this.hint.visible = true;
    sfx.fanfare();
    this.app.shake(10);
    this.burst();
    await this.fadeIn();
    await this.waitTapOrTimeout(autoMs);
    await this.fadeOut();
  }

  async retrigger(extra: number) {
    this.panel.visible = false;
    this.setHeading(t('fsRetrigger', { n: extra }));
    this.sub.visible = false;
    this.amount.visible = false;
    this.hint.visible = false;
    sfx.tierUp(1);
    this.burst();
    await this.fadeIn();
    await this.tweens.wait(1400);
    await this.fadeOut();
  }

  async outro(total: number) {
    this.panel.visible = true;
    this.portal.visible = true;
    this.setHeading(t('fsComplete'));
    this.sub.visible = false;
    this.amount.visible = true;
    this.amount.text = i18n.fmt(0);
    this.hint.text = t('tapToContinue');
    this.hint.visible = true;
    this.burst();
    await this.fadeIn();
    await this.tweens.value({
      duration: total > 0 ? 1400 : 0,
      ease: Ease.quadOut,
      onUpdate: (k) => {
        this.amount.text = i18n.fmt(Math.round(total * k));
        sfx.tick();
      },
    });
    sfx.fanfare();
    await this.waitTapOrTimeout(3500);
    await this.fadeOut();
  }

  update(dtMs: number) {
    if (!this.visible) return;
    this.portal.rotation += dtMs * 0.0006;
    this.sparks.update(dtMs);
  }
}
