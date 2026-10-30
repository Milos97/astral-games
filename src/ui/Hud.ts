import { Container, FillGradient, Graphics, type BitmapText, type Text } from 'pixi.js';
import { sfx } from '../core/Audio';
import { Emitter } from '../core/Emitter';
import { i18n, onLocale, t, type TKey } from '../core/i18n';
import { prefs, savePrefs } from '../core/Settings';
import type { Layout } from '../core/App';
import type { Tweens } from '../core/Tweens';
import { Ease } from '../core/Tweens';
import { Button } from './Button';
import { icons } from './icons';
import { COLORS, label, num } from './text';

export interface HudOptions {
  title: TKey;
  spinLabel?: TKey;
  turbo?: boolean;
  autoplay?: boolean;
}

type HudEvents = {
  spin: [];
  betUp: [];
  betDown: [];
  turbo: [on: boolean];
  auto: [count: number];
  info: [];
  lobby: [];
};

const AUTO_OPTIONS = [10, 25, 50, 100];

/**
 * Shared game HUD: top bar (lobby, title, session timer, clock, sound,
 * info) and bottom controls (balance, bet, win meter, spin, turbo,
 * autoplay). Every game reuses it; games only react to its events.
 */
export class Hud extends Container {
  readonly events = new Emitter<HudEvents>();
  private top = new Container();
  private bottom = new Container();
  private balanceCaption: Text;
  private balanceValue: BitmapText;
  private betCaption: Text;
  private betValue: BitmapText;
  private winCaption: Text;
  private winValue: BitmapText;
  private titleText: Text;
  private sessionText: Text;
  private clockText: Text;
  private winPanel = new Graphics();
  private betPanel = new Graphics();
  private balancePanel = new Graphics();
  readonly spinBtn: Button;
  private spinIcon: Container;
  private stopIcon: Container;
  private autoCountText: BitmapText;
  private spinLabelText: Text | null = null;
  readonly betDown: Button;
  readonly betUp: Button;
  readonly turboBtn: Button | null = null;
  readonly autoBtn: Button | null = null;
  private soundBtn: Button;
  private infoBtn: Button;
  private lobbyBtn: Button;
  private autoMenu = new Container();
  private sessionStart = Date.now();
  private secondTimer = 0;
  private winShown = 0;
  private winTarget = 0;
  private spinMode: 'spin' | 'stop' | 'auto' = 'spin';

  constructor(
    private readonly tweens: Tweens,
    private readonly opts: HudOptions,
  ) {
    super();
    this.addChild(this.top, this.bottom);

    // ---- top bar
    this.lobbyBtn = new Button({ width: 64, height: 52, icon: icons.home(30), onTap: () => this.events.emit('lobby') });
    this.titleText = label('', 26, COLORS.text, { fontWeight: '700', letterSpacing: 4 });
    this.titleText.anchor.set(0, 0.5);
    this.sessionText = label('', 20, COLORS.dim);
    this.sessionText.anchor.set(1, 0.5);
    this.clockText = label('', 20, COLORS.dim);
    this.clockText.anchor.set(1, 0.5);
    this.soundBtn = new Button({
      width: 64,
      height: 52,
      icon: icons.sound(30, 0xffffff, prefs.sound),
      onTap: () => this.toggleSound(),
    });
    this.infoBtn = new Button({ width: 64, height: 52, icon: icons.info(30), onTap: () => this.events.emit('info') });
    this.top.addChild(this.lobbyBtn, this.titleText, this.sessionText, this.clockText, this.soundBtn, this.infoBtn);

    // ---- bottom
    this.balanceCaption = label('', 20);
    this.balanceValue = num('', 40);
    this.betCaption = label('', 20);
    this.betValue = num('', 40);
    this.winCaption = label('', 22, COLORS.gold);
    this.winValue = num('', 64, 'numGold');
    this.betDown = new Button({ width: 64, height: 64, icon: icons.minus(34), onTap: () => this.events.emit('betDown') });
    this.betUp = new Button({ width: 64, height: 64, icon: icons.plus(34), onTap: () => this.events.emit('betUp') });

    this.spinIcon = opts.spinLabel ? new Container() : icons.spin(96);
    this.stopIcon = icons.stop(96);
    this.autoCountText = num('', 52);
    this.spinBtn = new Button({
      width: 176,
      height: 176,
      colors: ['#ff6ac8', '#8a0f68'],
      edge: 0xffc2ec,
      icon: this.spinIcon,
      onTap: () => this.events.emit('spin'),
      silent: true,
    });
    if (opts.spinLabel) {
      this.spinLabelText = label('', 40, 0xffffff, { fontWeight: '700' });
      this.spinIcon.addChild(this.spinLabelText);
    }
    const ring = new Graphics().circle(0, 0, 100).stroke({ color: 0xff4fb8, width: 4, alpha: 0.35 });
    this.spinBtn.addChildAt(ring, 0);

    this.bottom.addChild(
      this.balancePanel,
      this.betPanel,
      this.winPanel,
      this.balanceCaption,
      this.balanceValue,
      this.betCaption,
      this.betValue,
      this.winCaption,
      this.winValue,
      this.betDown,
      this.betUp,
      this.spinBtn,
    );

    if (opts.turbo) {
      this.turboBtn = new Button({ width: 88, height: 88, icon: icons.turbo(40), onTap: () => this.toggleTurbo() });
      this.turboBtn.active = prefs.turbo;
      this.bottom.addChild(this.turboBtn);
    }
    if (opts.autoplay) {
      this.autoBtn = new Button({ width: 88, height: 88, icon: icons.auto(42), onTap: () => this.toggleAutoMenu() });
      this.bottom.addChild(this.autoBtn, this.autoMenu);
      this.buildAutoMenu();
    }

    this.refreshText();
    onLocale(this, () => this.refreshText());
    this.tickClock();
  }

  setBalance(cents: number) {
    this.balanceValue.text = i18n.fmt(cents);
  }

  /**
   * Make a credit visible: "+€0.80" floats up off the balance, which pulses
   * gold. Matters most after a slam-stop, when the count-up is skipped and a
   * win smaller than the bet would otherwise look like nothing happened.
   */
  credit(cents: number) {
    if (cents <= 0) return;
    const pop = num(`+${i18n.fmt(cents)}`, 34, 'numGold');
    pop.position.set(this.balanceValue.x, this.balanceValue.y - 72);
    pop.alpha = 0;
    this.bottom.addChild(pop);
    void this.tweens
      .to(pop, { alpha: 1, y: pop.y - 20 }, { duration: 180, ease: Ease.quadOut })
      .then(() => this.tweens.to(pop, { alpha: 0, y: pop.y - 50 }, { duration: 900, delay: 500, ease: Ease.quadIn }))
      .then(() => pop.destroy());
    this.tweens.finishAll(this.balanceValue.scale);
    this.balanceValue.tint = COLORS.gold;
    void this.tweens
      .to(this.balanceValue.scale, { x: 1.15, y: 1.15 }, { duration: 120, ease: Ease.quadOut })
      .then(() => this.tweens.to(this.balanceValue.scale, { x: 1, y: 1 }, { duration: 320, ease: Ease.backOut }))
      .then(() => (this.balanceValue.tint = 0xffffff));
  }

  setBet(cents: number) {
    this.betValue.text = i18n.fmt(cents);
  }

  /** Animate the win meter to `cents`. Returns when the count-up ends. */
  setWin(cents: number, countMs = 0): Promise<void> {
    this.winTarget = cents;
    if (cents === 0) {
      this.winShown = 0;
      this.winValue.text = '';
      this.winCaption.alpha = 0.5;
      return Promise.resolve();
    }
    this.winCaption.alpha = 1;
    const from = this.winShown;
    this.tweens.finishAll(this.winValue.scale);
    void this.tweens
      .to(this.winValue.scale, { x: 1.18, y: 1.18 }, { duration: 120, ease: Ease.quadOut })
      .then(() => this.tweens.to(this.winValue.scale, { x: 1, y: 1 }, { duration: 260, ease: Ease.backOut }));
    return this.tweens.value({
      duration: countMs,
      ease: Ease.quadOut,
      onUpdate: (k) => {
        if (this.winTarget !== cents) return; // superseded by a newer value
        this.winShown = Math.round(from + (cents - from) * k);
        this.winValue.text = i18n.fmt(this.winShown);
        if (k < 1) sfx.tick();
      },
    });
  }

  setSpinMode(mode: 'spin' | 'stop' | 'auto', autoLeft = 0) {
    this.spinMode = mode;
    this.spinBtn.setIcon(mode === 'spin' ? this.spinIcon : mode === 'stop' ? this.stopIcon : this.autoCountText);
    if (mode === 'auto') this.autoCountText.text = String(autoLeft);
    if (this.autoBtn) this.autoBtn.active = mode === 'auto';
  }

  get mode() {
    return this.spinMode;
  }

  setBetEnabled(on: boolean) {
    this.betDown.enabled = on;
    this.betUp.enabled = on;
    if (this.autoBtn) this.autoBtn.enabled = on || this.spinMode === 'auto';
    this.lobbyBtn.enabled = on;
  }

  /** Spin the arrow icon while a round is running. */
  update(dtMs: number) {
    if (this.spinMode !== 'auto' && !this.opts.spinLabel) this.spinIcon.rotation += (this.betDown.enabled ? 0.0006 : 0.012) * dtMs;
    this.secondTimer += dtMs;
    if (this.secondTimer >= 1000) {
      this.secondTimer = 0;
      this.tickClock();
    }
  }

  layout(l: Layout) {
    const W = l.width;
    const H = l.height;
    this.top.position.set(0, 0);
    this.lobbyBtn.position.set(52, 46);
    this.titleText.position.set(100, 46);
    this.infoBtn.position.set(W - 52, 46);
    this.soundBtn.position.set(W - 128, 46);
    this.clockText.position.set(W - 180, 34);
    this.sessionText.position.set(W - 180, 60);

    const panel = (g: Graphics, w: number, h: number) =>
      g
        .clear()
        .roundRect(-w / 2, -h / 2, w, h, 22)
        .fill({ color: 0x0c0624, alpha: 0.72 })
        .stroke({ color: COLORS.panelEdge, width: 2, alpha: 0.8 });

    if (l.orientation === 'landscape') {
      const y = H - 92;
      this.place(this.balanceCaption, 230, y - 26);
      this.place(this.balanceValue, 230, y + 14);
      panel(this.balancePanel, 340, 110).position.set(230, y);

      this.place(this.betCaption, 640, y - 26);
      this.place(this.betValue, 640, y + 14);
      panel(this.betPanel, 380, 110).position.set(640, y);
      this.betDown.position.set(500, y + 6);
      this.betUp.position.set(780, y + 6);

      this.place(this.winCaption, 1080, y - 30);
      this.place(this.winValue, 1080, y + 16);
      panel(this.winPanel, 400, 120).position.set(1080, y);

      this.spinBtn.position.set(1640, H - 150);
      this.turboBtn?.position.set(1460, H - 92);
      this.autoBtn?.position.set(1820, H - 92);
      this.autoMenu.position.set(1820, H - 160);
    } else {
      const yWin = H - 520;
      this.place(this.winCaption, W / 2, yWin - 32);
      this.place(this.winValue, W / 2, yWin + 16);
      panel(this.winPanel, 520, 124).position.set(W / 2, yWin);

      this.spinBtn.position.set(W / 2, H - 310);
      this.turboBtn?.position.set(W / 2 - 230, H - 310);
      this.autoBtn?.position.set(W / 2 + 230, H - 310);
      this.autoMenu.position.set(W / 2 + 230, H - 380);

      const y = H - 110;
      this.place(this.balanceCaption, 250, y - 26);
      this.place(this.balanceValue, 250, y + 14);
      panel(this.balancePanel, 420, 110).position.set(250, y);
      this.place(this.betCaption, W - 250, y - 26);
      this.place(this.betValue, W - 250, y + 14);
      panel(this.betPanel, 420, 110).position.set(W - 250, y);
      this.betDown.position.set(W - 410, y + 6);
      this.betUp.position.set(W - 90, y + 6);
    }
  }

  private place(o: Container, x: number, y: number) {
    o.position.set(x, y);
  }

  private refreshText() {
    this.titleText.text = t(this.opts.title);
    this.balanceCaption.text = t('balance');
    this.betCaption.text = t('bet');
    this.winCaption.text = t('win');
    if (this.spinLabelText) this.spinLabelText.text = t(this.opts.spinLabel!);
    if (this.winTarget) this.winValue.text = i18n.fmt(this.winShown);
    this.tickClock();
  }

  private tickClock() {
    const s = Math.floor((Date.now() - this.sessionStart) / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    this.sessionText.text = `${t('session')} ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    this.clockText.text = new Date().toLocaleTimeString(i18n.locale === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  private toggleSound() {
    savePrefs({ sound: !prefs.sound });
    sfx.muted = !prefs.sound;
    this.soundBtn.setIcon(icons.sound(30, 0xffffff, prefs.sound), true);
  }

  private toggleTurbo() {
    savePrefs({ turbo: !prefs.turbo });
    this.turboBtn!.active = prefs.turbo;
    this.events.emit('turbo', prefs.turbo);
  }

  private toggleAutoMenu() {
    if (this.spinMode === 'auto') {
      this.events.emit('auto', 0);
      return;
    }
    this.autoMenu.visible = !this.autoMenu.visible;
  }

  private buildAutoMenu() {
    this.autoMenu.visible = false;
    const h = 70;
    const bg = new Graphics()
      .roundRect(-60, -AUTO_OPTIONS.length * h - 10, 120, AUTO_OPTIONS.length * h + 20, 20)
      .fill(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: '#2a1a5e' },
            { offset: 1, color: '#120a2a' },
          ],
          textureSpace: 'local',
        }),
      )
      .stroke({ color: COLORS.panelEdge, width: 2 });
    this.autoMenu.addChild(bg);
    AUTO_OPTIONS.forEach((n, i) => {
      const b = new Button({
        width: 100,
        height: 58,
        radius: 16,
        label: label(String(n), 30, 0xffffff, { fontWeight: '700' }),
        onTap: () => {
          this.autoMenu.visible = false;
          this.events.emit('auto', n);
        },
      });
      b.position.set(0, -(AUTO_OPTIONS.length - i) * h + h / 2 - 4);
      this.autoMenu.addChild(b);
    });
  }
}
