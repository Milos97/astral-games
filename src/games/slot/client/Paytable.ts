import { Container, Graphics, Sprite } from 'pixi.js';
import type { App, Layout } from '../../../core/App';
import { i18n, t } from '../../../core/i18n';
import { Button } from '../../../ui/Button';
import { icons } from '../../../ui/icons';
import { Overlay } from '../../../ui/Overlay';
import { COLORS, label, title } from '../../../ui/text';
import { PAY_TIERS, SCATTER, SIMULATED_RTP, SYMBOLS } from '../math/config';

/**
 * Data-driven paytable: rows are generated from the math config and priced
 * at the player's current bet, so it can never drift from the real model.
 */
export class Paytable extends Overlay {
  private body = new Container();
  private bet = 100;

  constructor(private readonly app: App) {
    super(app.tweens, 0.82);
    this.content.addChild(this.body);
  }

  async open(bet: number) {
    this.bet = bet;
    this.rebuild();
    await this.fadeIn(200);
    await new Promise<void>((resolve) => this.onTap(resolve));
    await this.fadeOut(180);
  }

  layout(l: Layout) {
    super.layout(l);
    if (this.visible) this.rebuild();
  }

  private rebuild() {
    const l = this.layoutInfo;
    if (!l) return;
    this.body.removeChildren().forEach((c) => c.destroy({ children: true }));
    const portrait = l.orientation === 'portrait';
    const W = portrait ? 1000 : 1640;
    const H = portrait ? 1480 : 960;

    const panel = new Graphics()
      .roundRect(-W / 2, -H / 2, W, H, 40)
      .fill({ color: 0x120a2a, alpha: 0.97 })
      .stroke({ color: COLORS.panelEdge, width: 4 });
    this.body.addChild(panel);

    const heading = title(t('paytable'), 60);
    heading.y = -H / 2 + 70;
    this.body.addChild(heading);

    const close = new Button({ width: 72, height: 72, icon: icons.close(36), onTap: () => {} }); // the tap bubbles to the overlay, which closes it
    close.position.set(W / 2 - 60, -H / 2 + 60);
    this.body.addChild(close);

    const paying = SYMBOLS.filter((s) => !s.scatter).slice().reverse();
    const cols = portrait ? 2 : 4;
    const cellW = portrait ? 460 : 390;
    const cellH = 170;
    const top = -H / 2 + 170;
    paying.forEach((s, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * cellW;
      const y = top + r * cellH + cellH / 2;
      const card = new Container();
      card.position.set(x, y);
      card.addChild(new Graphics().roundRect(-cellW / 2 + 10, -cellH / 2 + 8, cellW - 20, cellH - 16, 22).fill({ color: 0x24164f, alpha: 0.8 }));
      const icon = new Sprite(this.app.atlas.symbols[s.id]);
      icon.anchor.set(0.5);
      icon.scale.set(0.58);
      icon.x = -cellW / 2 + 85;
      card.addChild(icon);
      const tiers = [`${PAY_TIERS[2]}+`, `${PAY_TIERS[1]}-${PAY_TIERS[2] - 1}`, `${PAY_TIERS[0]}-${PAY_TIERS[1] - 1}`];
      const pays = [s.pays[2], s.pays[1], s.pays[0]];
      tiers.forEach((tier, k) => {
        const a = label(tier, 24, COLORS.dim);
        a.anchor.set(0, 0.5);
        a.position.set(-cellW / 2 + 165, -42 + k * 42);
        const b = label(i18n.fmt(Math.round(pays[k] * this.bet)), 26, k === 0 ? COLORS.gold : COLORS.text, { fontWeight: '700' });
        b.anchor.set(1, 0.5);
        b.position.set(cellW / 2 - 30, -42 + k * 42);
        card.addChild(a, b);
      });
      this.body.addChild(card);
    });

    const rowsUsed = Math.ceil(paying.length / cols);
    let y = top + rowsUsed * cellH + 40;

    const scatter = new Sprite(this.app.atlas.symbols[SCATTER]);
    scatter.anchor.set(0.5);
    scatter.scale.set(0.6);
    scatter.position.set(-W / 2 + 140, y + 30);
    const sl = label(t('scatterPays'), 28, 0xffc2ff, { fontWeight: '700' });
    sl.anchor.set(0, 0.5);
    sl.position.set(-W / 2 + 220, y + 30);
    this.body.addChild(scatter, sl);
    y += 120;

    const rules = label(t('rulesTitle'), 30, COLORS.cyan, { fontWeight: '700' });
    rules.anchor.set(0, 0);
    rules.position.set(-W / 2 + 80, y);
    this.body.addChild(rules);
    y += 50;
    for (const key of ['rules1', 'rules2', 'rules3', 'rules4'] as const) {
      const p = label(`•  ${t(key)}`, 24, COLORS.text, { wordWrap: true, wordWrapWidth: W - 160, fontWeight: '400', lineHeight: 34 });
      p.anchor.set(0, 0);
      p.position.set(-W / 2 + 80, y);
      this.body.addChild(p);
      y += p.height + 12;
    }
    const rtp = label(t('rtpNote', { rtp: `${(SIMULATED_RTP * 100).toFixed(2)}%` }), 22, COLORS.dim);
    rtp.position.set(0, H / 2 - 40);
    this.body.addChild(rtp);

    const fit = Math.min(1, (l.height - 40) / H, (l.width - 40) / W);
    this.body.scale.set(fit);
  }
}
