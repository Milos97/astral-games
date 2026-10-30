import { Container, FillGradient, Graphics, Rectangle, Sprite, type BitmapText, type Text, type Texture } from 'pixi.js';
import type { App, Layout, SceneId } from '../../core/App';
import { sfx } from '../../core/Audio';
import { i18n, onLocale, t, type TKey } from '../../core/i18n';
import { Ease, Tweens } from '../../core/Tweens';
import { Particles } from '../../fx/Particles';
import { COLORS, label, num, title } from '../../ui/text';
import { CONFIG, type GamiUpdate, type GamiView, type MissionChange, type MissionView } from '../engine';

const PILL_W = 300;
const PILL_H = 62;
const CARD_W = 460;
const CARD_H = 100;

function starPoints(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

const star = (r: number) => new Graphics().poly(starPoints(r)).fill(COLORS.gold).stroke({ color: 0x8a4a00, width: 2, join: 'round' });

const progressText = (m: MissionView, p = m.progress) =>
  m.metric === 'winCents' ? `${i18n.fmt(p)} / ${i18n.fmt(m.target)}` : `${Math.floor(p)} / ${m.target}`;

const missionText = (m: MissionView) => t(m.text as TKey, { n: m.metric === 'winCents' ? i18n.fmt(m.target) : m.target });

/** One mission: text, reward, progress bar. Origin is the top-left corner. */
class MissionCard extends Container {
  private bg = new Graphics();
  private bar = new Graphics();
  private text: Text;
  private reward: Text;
  private count: Text;
  private stamp: Text;
  private view: MissionView | null = null;
  private shown = 0;

  constructor() {
    super();
    this.text = label('', 22, COLORS.text, { fontWeight: '600', letterSpacing: 0.5 });
    this.text.anchor.set(0, 0.5);
    this.text.position.set(20, 30);
    this.reward = label('', 18, COLORS.gold, { fontWeight: '700' });
    this.reward.anchor.set(1, 0.5);
    this.reward.position.set(CARD_W - 18, 30);
    this.count = label('', 18, COLORS.dim);
    this.count.anchor.set(1, 0.5);
    this.count.position.set(CARD_W - 18, 70);
    this.stamp = title('', 34);
    this.stamp.position.set(CARD_W / 2, CARD_H / 2);
    this.stamp.visible = false;
    this.addChild(this.bg, this.bar, this.text, this.reward, this.count, this.stamp);
    this.drawBg(false);
    onLocale(this, () => this.view && this.set(this.view, this.shown));
  }

  get mission() {
    return this.view;
  }

  set(m: MissionView, progress = m.progress) {
    this.view = m;
    this.text.text = missionText(m);
    this.text.scale.set(Math.min(1, (CARD_W - 170) / (this.text.width / this.text.scale.x)));
    this.reward.text = `+${m.reward.xp} XP · ★${m.reward.stars}`;
    this.stamp.visible = false;
    this.setDetailAlpha(1);
    this.drawBg(false);
    this.setProgress(progress);
  }

  setProgress(p: number) {
    const m = this.view!;
    this.shown = p;
    const k = Math.max(0, Math.min(1, p / m.target));
    const w = CARD_W - 150;
    this.bar.clear().roundRect(20, 63, w, 14, 7).fill({ color: 0x000000, alpha: 0.45 });
    if (k > 0)
      this.bar.roundRect(20, 63, Math.max(14, w * k), 14, 7).fill(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          colorStops: [
            { offset: 0, color: '#3fd8ff' },
            { offset: 1, color: k >= 1 ? '#ffd84a' : '#ff4fb8' },
          ],
          textureSpace: 'local',
        }),
      );
    this.count.text = progressText(m, p);
  }

  animateTo(p: number, tweens: Tweens): Promise<void> {
    const from = this.shown;
    return tweens.value({ duration: 650, ease: Ease.cubicOut, onUpdate: (k) => this.setProgress(from + (p - from) * k) });
  }

  async complete(tweens: Tweens) {
    this.drawBg(true);
    this.stamp.text = t('missionComplete');
    this.stamp.visible = true;
    this.stamp.scale.set(2);
    this.stamp.alpha = 0;
    void tweens.value({ duration: 160, onUpdate: (k) => this.setDetailAlpha(1 - 0.85 * k) });
    await tweens.to(this.stamp, { alpha: 1 }, { duration: 160 });
    await tweens.to(this.stamp.scale, { x: 1, y: 1 }, { duration: 380, ease: Ease.backOut });
  }

  private setDetailAlpha(a: number) {
    for (const o of [this.text, this.reward, this.count, this.bar]) o.alpha = a;
  }

  private drawBg(done: boolean) {
    this.bg
      .clear()
      .roundRect(0, 0, CARD_W, CARD_H, 20)
      .fill({ color: done ? 0x2a1a08 : 0x140a30, alpha: 0.96 })
      .stroke({ color: done ? COLORS.gold : COLORS.panelEdge, width: done ? 3 : 2 });
  }
}

/**
 * The engagement widget the gamification service drops on top of any game:
 * a level / XP / stars pill, a missions panel, progress "peeks" while you
 * play, and level-up celebrations. It has its own tween clock, so a game's
 * slam-stop or turbo never skips or speeds up its animations.
 */
export class GamiWidget extends Container {
  private readonly tweens = new Tweens();
  private pill = new Container();
  private pillBg = new Graphics();
  private ring = new Graphics();
  private levelText: BitmapText;
  private levelCaption: Text;
  private xpBar = new Graphics();
  private xpText: Text;
  private starIcon = star(16);
  private starsText: BitmapText;
  private chevron = new Graphics();
  private panel = new Container();
  private panelBg = new Graphics();
  private panelTitle: Text;
  private panelNote: Text;
  private cards: MissionCard[] = [];
  private catcher = new Graphics();
  private peek = new MissionCard();
  private banner = new Container();
  private bannerTitle: Text;
  private bannerSub: Text;
  private flyLayer = new Container();
  private fx: Particles;
  private starTex: Texture;

  private level: number;
  private xp: number;
  private xpToNext: number;
  private queue: GamiUpdate[] = [];
  private running = false;

  constructor(private readonly app: App) {
    super();
    const v = app.gami.view;
    this.level = v.level;
    this.xp = v.xp;
    this.xpToNext = v.xpToNext;
    this.starTex = app.pixi.renderer.generateTexture({ target: star(14), resolution: 2 });

    // ---- pill
    this.levelText = num(String(v.level), 30);
    this.levelCaption = label('', 13, COLORS.dim, { fontWeight: '700', letterSpacing: 2 });
    this.levelCaption.anchor.set(0, 0.5);
    this.xpText = label('', 15, COLORS.dim);
    this.xpText.anchor.set(0, 0.5);
    this.starsText = num(String(v.stars), 28);
    this.starsText.anchor.set(1, 0.5);
    this.chevron.moveTo(-7, -4).lineTo(0, 3).lineTo(7, -4).stroke({ color: COLORS.dim, width: 3, cap: 'round', join: 'round' });
    this.pillBg
      .roundRect(0, -PILL_H / 2, PILL_W, PILL_H, PILL_H / 2)
      .fill({ color: 0x0c0624, alpha: 0.85 })
      .stroke({ color: COLORS.panelEdge, width: 2 });
    this.levelText.position.set(31, 1);
    this.levelCaption.position.set(70, -14);
    this.xpBar.position.set(70, 4);
    this.xpText.position.set(70, 20);
    this.starIcon.position.set(PILL_W - 92, 0);
    this.starsText.position.set(PILL_W - 36, 2);
    this.chevron.position.set(PILL_W - 18, 0);
    this.pill.addChild(this.pillBg, this.ring, this.levelText, this.levelCaption, this.xpBar, this.xpText, this.starIcon, this.starsText, this.chevron);
    this.pill.eventMode = 'static';
    this.pill.cursor = 'pointer';
    this.pill.hitArea = new Rectangle(0, -PILL_H / 2, PILL_W, PILL_H);
    this.pill.on('pointertap', () => this.togglePanel());

    // ---- missions panel
    this.catcher.rect(-4000, -4000, 12000, 12000).fill({ color: 0x000000, alpha: 0.001 });
    this.catcher.eventMode = 'static';
    this.catcher.on('pointertap', () => this.togglePanel(false));
    this.catcher.visible = false;
    this.panelTitle = label('', 20, COLORS.gold, { fontWeight: '700', letterSpacing: 3 });
    this.panelTitle.anchor.set(0, 0.5);
    this.panelTitle.position.set(24, 30);
    this.panelNote = label('', 15, COLORS.dim, { fontWeight: '400' });
    this.panelNote.anchor.set(0, 0.5);
    const ph = 60 + 3 * (CARD_H + 12) + 34;
    this.panelBg.roundRect(0, 0, CARD_W + 32, ph, 26).fill({ color: 0x0c0624, alpha: 0.97 }).stroke({ color: COLORS.panelEdge, width: 2 });
    this.panelNote.position.set(24, ph - 26);
    this.panel.addChild(this.panelBg, this.panelTitle, this.panelNote);
    v.missions.forEach((m, i) => {
      const c = new MissionCard();
      c.set(m);
      c.position.set(16, 60 + i * (CARD_H + 12));
      this.cards.push(c);
      this.panel.addChild(c);
    });
    this.panel.eventMode = 'static';
    this.panel.visible = false;
    this.peek.visible = false;

    // ---- level-up banner
    this.bannerTitle = title('', 84);
    this.bannerSub = label('', 30, COLORS.gold, { fontWeight: '700' });
    this.bannerSub.y = 70;
    const plate = new Graphics()
      .roundRect(-280, -80, 560, 200, 40)
      .fill({ color: 0x0c0624, alpha: 0.88 })
      .stroke({ color: COLORS.gold, width: 3 });
    this.banner.addChild(plate, this.bannerTitle, this.bannerSub);
    this.banner.visible = false;

    this.fx = new Particles(app.atlas.spark);
    this.addChild(this.catcher, this.banner, this.fx.view, this.pill, this.panel, this.peek, this.flyLayer);

    this.drawXp(this.xp, this.xpToNext);
    this.refreshText();
    onLocale(this, () => this.refreshText());
    app.gami.on('reveal', (u) => {
      this.queue.push(u);
      void this.run();
    });
  }

  layout(l: Layout, scene: SceneId | null) {
    const portrait = l.orientation === 'portrait';
    const s = portrait ? 0.92 : 1;
    const x = scene === 'lobby' || scene === null ? 40 : portrait ? 400 : 440;
    this.pill.position.set(x, 46);
    this.pill.scale.set(s);
    // the panel and peek drop down under the pill, kept on screen
    const px = Math.min(x, l.width - (CARD_W + 32) - 16);
    this.panel.position.set(px, 46 + PILL_H / 2 + 12);
    this.peek.position.set(px + 16, 46 + PILL_H / 2 + 12);
    this.banner.position.set(l.width / 2, portrait ? 330 : 240);
  }

  update(dtMs: number) {
    this.tweens.tick(dtMs);
    this.fx.update(dtMs);
  }

  private refreshText() {
    this.levelCaption.text = t('level');
    this.panelTitle.text = t('missions');
    this.panelNote.text = t('gamiNote');
    this.xpText.text = `${this.xp} / ${this.xpToNext} XP`;
  }

  private togglePanel(open = !this.panel.visible) {
    if (open === this.panel.visible) return;
    sfx.click();
    this.catcher.visible = open;
    if (open) {
      // the panel always shows the latest revealed state
      this.app.gami.view.missions.forEach((m, i) => this.cards[i].set(m));
      this.panel.visible = true;
      this.panel.alpha = 0;
      this.panel.pivot.y = 16;
      void this.tweens.to(this.panel, { alpha: 1 }, { duration: 160 });
      void this.tweens.to(this.panel.pivot, { y: 0 }, { duration: 260, ease: Ease.backOut });
      this.peek.visible = false;
    } else {
      void this.tweens.to(this.panel, { alpha: 0 }, { duration: 140 }).then(() => (this.panel.visible = false));
    }
    this.chevron.rotation = open ? Math.PI : 0;
  }

  // ------------------------------------------------------------ reveal sequence

  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const u = this.queue.shift()!;
      // autoplay + turbo can outpace the animations: settle routine updates instantly
      const routine = u.levelUps.length === 0 && u.missions.every((m) => !m.completed);
      if (routine && this.queue.length > 0) this.applyInstant(u);
      else await this.play(u);
    }
    this.running = false;
  }

  private applyInstant(u: GamiUpdate) {
    this.setView(u.view);
    if (this.panel.visible) u.view.missions.forEach((m, i) => this.cards[i].set(m));
  }

  private setView(v: GamiView) {
    this.level = v.level;
    this.xp = v.xp;
    this.xpToNext = v.xpToNext;
    this.levelText.text = String(v.level);
    this.starsText.text = String(v.stars);
    this.drawXp(v.xp, v.xpToNext);
  }

  private async play(u: GamiUpdate) {
    if (u.xpGained > 0) this.floatXp(u.xpGained);
    await this.animateXp(u);
    for (const change of u.missions) await this.playMission(change);
    this.setView(u.view);
  }

  private async animateXp(u: GamiUpdate) {
    let level = this.level;
    let from = this.xp;
    for (const next of u.levelUps) {
      const need = this.xpToNext;
      await this.tweens.value({ duration: 380, ease: Ease.quadOut, onUpdate: (k) => this.drawXp(from + (need - from) * k, need) });
      level = next;
      from = 0;
      this.xpToNext = CONFIG.xpToNext(level);
      this.levelUp(level, u);
      await this.tweens.wait(500);
    }
    const target = u.view.xp;
    await this.tweens.value({ duration: 420, ease: Ease.quadOut, onUpdate: (k) => this.drawXp(from + (target - from) * k, u.view.xpToNext) });
  }

  private levelUp(level: number, u: GamiUpdate) {
    this.level = level;
    this.levelText.text = String(level);
    this.tweens.finishAll(this.levelText.scale);
    this.levelText.scale.set(1.8);
    void this.tweens.to(this.levelText.scale, { x: 1, y: 1 }, { duration: 500, ease: Ease.elasticOut });
    sfx.tierUp(1);
    this.app.shake(6);

    const g = this.pill.getGlobalPosition();
    const p = this.toLocal(g);
    this.fx.emit({ texture: this.app.atlas.sparkle, x: p.x + 31, y: p.y, count: 40, speed: [120, 420], drag: 0.2, life: [500, 1000], scale: [0.15, 0.4], scaleEnd: 0.1, tint: [COLORS.gold, COLORS.cyan, 0xffffff] });

    this.bannerTitle.text = t('levelUp', { n: level });
    const reward = u.starsGained > 0 ? CONFIG.levelReward(level) : 0;
    this.bannerSub.text = reward ? `+★${reward}` : '';
    this.banner.visible = true;
    this.banner.alpha = 0;
    this.banner.scale.set(0.6);
    this.fx.emit({ texture: this.app.atlas.sparkle, x: this.banner.x, y: this.banner.y, count: 90, speed: [200, 800], drag: 0.25, life: [700, 1400], scale: [0.2, 0.55], scaleEnd: 0.1, tint: [COLORS.gold, COLORS.accent, COLORS.cyan, 0xffffff] });
    void (async () => {
      await Promise.all([
        this.tweens.to(this.banner, { alpha: 1 }, { duration: 180 }),
        this.tweens.to(this.banner.scale, { x: 1, y: 1 }, { duration: 520, ease: Ease.backOut }),
      ]);
      if (reward) this.flyStars(this.banner.x, this.banner.y + 70, reward);
      await this.tweens.wait(1300);
      await this.tweens.to(this.banner, { alpha: 0, y: this.banner.y - 30 }, { duration: 300 });
      this.banner.visible = false;
      this.banner.y += 30;
    })();
  }

  private shouldPeek(c: MissionChange) {
    if (c.completed) return true;
    if (c.after.target <= 3) return true;
    const half = c.after.target / 2;
    return c.before.progress < half && c.after.progress >= half;
  }

  private async playMission(c: MissionChange) {
    const card = this.panel.visible ? this.cards[c.slot] : this.shouldPeek(c) ? this.peek : null;
    if (!card) return;
    const isPeek = card === this.peek;
    card.set(c.before);
    if (isPeek) {
      card.visible = true;
      card.alpha = 0;
      card.pivot.y = 20;
      await Promise.all([
        this.tweens.to(card, { alpha: 1 }, { duration: 160 }),
        this.tweens.to(card.pivot, { y: 0 }, { duration: 280, ease: Ease.backOut }),
      ]);
    }
    await card.animateTo(c.after.progress, this.tweens);
    if (c.completed) {
      sfx.fanfare();
      await card.complete(this.tweens);
      const p = this.toLocal(card.getGlobalPosition());
      this.fx.emit({ texture: this.app.atlas.sparkle, x: p.x + CARD_W / 2, y: p.y + CARD_H / 2, count: 50, speed: [150, 500], drag: 0.25, life: [500, 1100], scale: [0.15, 0.4], scaleEnd: 0.1, tint: [COLORS.gold, 0xffffff] });
      this.flyStars(p.x + CARD_W - 60, p.y + 30, c.after.reward.stars);
      await this.tweens.wait(900);
      if (c.next) {
        await this.tweens.to(card, { alpha: 0 }, { duration: 160 });
        card.set(c.next);
        await this.tweens.to(card, { alpha: 1 }, { duration: 200 });
        await this.tweens.wait(isPeek ? 900 : 200);
      }
    } else {
      await this.tweens.wait(isPeek ? 1000 : 150);
    }
    if (isPeek) {
      await this.tweens.to(card, { alpha: 0 }, { duration: 220 });
      card.visible = false;
    }
  }

  /** Stars fly from (x, y) into the pill's counter, which ticks up per arrival. */
  private flyStars(x: number, y: number, amount: number) {
    const n = Math.min(12, Math.max(4, Math.round(amount / 5)));
    const target = this.toLocal(this.starIcon.getGlobalPosition());
    const start = Number(this.starsText.text) || 0;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.starTex);
      s.anchor.set(0.5);
      s.position.set(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 30);
      this.flyLayer.addChild(s);
      const sx = s.x;
      const sy = s.y;
      const lift = 80 + Math.random() * 120;
      void this.tweens
        .value({
          duration: 600 + i * 45,
          delay: i * 40,
          ease: Ease.cubicIn,
          onUpdate: (k) => {
            s.x = sx + (target.x - sx) * k;
            s.y = sy + (target.y - sy) * k - Math.sin(k * Math.PI) * lift;
            s.rotation = k * 6;
            s.scale.set(1.2 - 0.6 * k);
          },
        })
        .then(() => {
          s.destroy();
          sfx.coin();
          this.starsText.text = String(start + Math.round((amount * (i + 1)) / n));
          this.tweens.finishAll(this.starIcon.scale);
          this.starIcon.scale.set(1.35);
          void this.tweens.to(this.starIcon.scale, { x: 1, y: 1 }, { duration: 220, ease: Ease.backOut });
        });
    }
  }

  private floatXp(xp: number) {
    const p = this.toLocal(this.xpBar.getGlobalPosition());
    const txt = label(`+${xp} XP`, 22, COLORS.cyan, { fontWeight: '700' });
    txt.position.set(p.x + 160, p.y + 8);
    this.flyLayer.addChild(txt);
    void this.tweens.to(txt, { y: txt.y + 46, alpha: 0 }, { duration: 1000, ease: Ease.quadOut }).then(() => txt.destroy());
  }

  private drawXp(xp: number, need: number) {
    const w = 130;
    const k = Math.max(0, Math.min(1, xp / need));
    this.xpBar.clear().roundRect(0, -5, w, 10, 5).fill({ color: 0x000000, alpha: 0.5 });
    if (k > 0) this.xpBar.roundRect(0, -5, Math.max(10, w * k), 10, 5).fill(COLORS.cyan);
    this.xpText.text = `${Math.round(xp)} / ${need} XP`;
    this.ring.clear().circle(31, 0, 25).fill({ color: 0x24164f }).stroke({ color: 0x000000, width: 6, alpha: 0.45 });
    if (k > 0)
      this.ring
        .moveTo(31, -25)
        .arc(31, 0, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k)
        .stroke({ color: COLORS.gold, width: 6, cap: 'round' });
  }
}
