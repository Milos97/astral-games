import { Container, FillGradient, Graphics, Sprite, type BitmapText, type Text } from 'pixi.js';
import type { App, Layout, Scene, SceneId } from '../core/App';
import { i18n, onLocale, t, type TKey } from '../core/i18n';
import { Button } from '../ui/Button';
import { COLORS, label, num, title } from '../ui/text';

interface CardSpec {
  id: SceneId;
  name: TKey;
  desc: TKey;
  art: (app: App) => Container;
  colors: [string, string];
}

const CARDS: CardSpec[] = [
  {
    id: 'slot',
    name: 'slotTitle',
    desc: 'slotDesc',
    colors: ['#3a1a7a', '#120a2a'],
    art: (app) => {
      const c = new Container();
      [7, 8, 6].forEach((id, i) => {
        const s = new Sprite(app.atlas.symbols[id]);
        s.anchor.set(0.5);
        s.scale.set(i === 1 ? 0.95 : 0.7);
        s.position.set((i - 1) * 150, i === 1 ? -10 : 20);
        c.addChild(s);
      });
      return c;
    },
  },
  {
    id: 'plinko',
    name: 'plinkoTitle',
    desc: 'plinkoDesc',
    colors: ['#5a0f4a', '#160624'],
    art: (app) => {
      const c = new Container();
      for (let r = 0; r < 6; r++) {
        for (let k = 0; k <= r + 2; k++) {
          const p = new Sprite(app.atlas.peg);
          p.anchor.set(0.5);
          p.scale.set(0.45);
          p.position.set((k - (r + 2) / 2) * 52, -110 + r * 42);
          c.addChild(p);
        }
      }
      const ball = new Sprite(app.atlas.ball);
      ball.anchor.set(0.5);
      ball.scale.set(0.7);
      ball.position.set(12, -150);
      c.addChild(ball);
      return c;
    },
  },
];

/** Game picker. Proves the shell hosts multiple games on one framework. */
export class Lobby implements Scene {
  readonly root = new Container();
  private heading: Text;
  private balance: BitmapText;
  private cards: Container[] = [];
  private time = 0;

  constructor(private readonly app: App) {
    this.heading = title('ASTRAL GAMES', 96);
    this.balance = num(i18n.fmt(app.session.balance), 40);
    this.root.addChild(this.heading, this.balance);
    for (const spec of CARDS) {
      const card = this.makeCard(spec);
      this.cards.push(card);
      this.root.addChild(card);
    }
    void app.server.call('session.init', {}).then((s) => {
      app.session = s;
      if (!this.balance.destroyed) this.balance.text = i18n.fmt(s.balance);
    });
  }

  private makeCard(spec: CardSpec): Container {
    const card = new Container();
    const W = 620;
    const H = 640;
    const bg = new Graphics()
      .roundRect(-W / 2, -H / 2, W, H, 40)
      .fill(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: spec.colors[0] },
            { offset: 1, color: spec.colors[1] },
          ],
          textureSpace: 'local',
        }),
      )
      .stroke({ color: COLORS.panelEdge, width: 4 });
    const art = spec.art(this.app);
    art.y = -110;
    const name = title('', 52);
    name.y = 90;
    const desc = label('', 24, COLORS.text, { wordWrap: true, wordWrapWidth: W - 100, align: 'center', fontWeight: '400' });
    desc.y = 160;
    const playLabel = label('', 32, 0xffffff, { fontWeight: '700' });
    const play = new Button({
      width: 260,
      height: 78,
      colors: ['#ff6ac8', '#8a0f68'],
      edge: 0xffc2ec,
      label: playLabel,
      onTap: () => this.app.goto(spec.id),
    });
    play.y = 250;
    card.addChild(bg, art, name, desc, play);
    const refresh = () => {
      name.text = t(spec.name);
      desc.text = t(spec.desc);
      playLabel.text = t('play');
    };
    refresh();
    onLocale(card, refresh);
    bg.eventMode = 'static';
    bg.cursor = 'pointer';
    bg.on('pointertap', () => this.app.goto(spec.id));
    return card;
  }

  layout(l: Layout) {
    const W = l.width;
    if (l.orientation === 'landscape') {
      this.heading.position.set(W / 2, 130);
      this.balance.position.set(W / 2, 215);
      this.cards.forEach((c, i) => {
        c.position.set(W / 2 + (i - 0.5) * 700, 610);
        c.scale.set(1);
      });
    } else {
      this.heading.position.set(W / 2, 170);
      this.balance.position.set(W / 2, 255);
      this.cards.forEach((c, i) => {
        c.position.set(W / 2, 700 + i * 760);
        c.scale.set(1.05);
      });
    }
  }

  update(dtMs: number) {
    this.time += dtMs;
    this.cards.forEach((c, i) => (c.children[1].y = -110 + Math.sin(this.time / 900 + i * 2) * 8));
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
