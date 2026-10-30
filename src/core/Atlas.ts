import { Container, FillGradient, Graphics, Rectangle, RenderTexture, Texture, type Renderer } from 'pixi.js';

/**
 * Every game texture is drawn procedurally into ONE render-texture atlas at
 * boot: symbols, particles, pegs, coins. Sharing a single texture source
 * means the whole grid of symbols, and every particle, batches into a
 * single draw call — and there are zero image downloads.
 */
export const SYMBOL_COLORS = [0x3fd8ff, 0x46f08a, 0xb46bff, 0xff8a3d, 0x41e0c8, 0xffb347, 0xffd84a, 0xff4fb8, 0xff7cf2];

export interface Atlas {
  symbols: Texture[];
  glow: Texture;
  ring: Texture;
  spark: Texture;
  shard: Texture;
  coin: Texture;
  sparkle: Texture;
  peg: Texture;
  ball: Texture;
  source: RenderTexture;
}

const SIZE = 1024;
const CELL = 224;
const S = 100; // symbol half-extent inside a cell

type Pt = [number, number];

const lin = (stops: [number, string][], vertical = true) =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: vertical ? { x: 0, y: 1 } : { x: 1, y: 1 },
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: 'local',
  });

const rad = (stops: [number, string][], cx = 0.5, cy = 0.5) =>
  new FillGradient({
    type: 'radial',
    center: { x: cx, y: cy },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: 'local',
  });

function ngon(n: number, r: number, rot = -Math.PI / 2, sx = 1, sy = 1): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r * sx, Math.sin(a) * r * sy]);
  }
  return pts;
}

const flat = (pts: Pt[]) => pts.flat();
const scale = (pts: Pt[], k: number, dy = 0): Pt[] => pts.map(([x, y]) => [x * k, y * k + dy]);

interface GemColors {
  light: string;
  mid: string;
  dark: string;
  edge: string;
}

function gem(g: Graphics, outer: Pt[], c: GemColors) {
  // soft halo
  g.poly(flat(scale(outer, 1.1))).fill({ color: c.mid, alpha: 0.22 });
  g.poly(flat(outer)).fill(lin([[0, c.light], [0.55, c.mid], [1, c.dark]]));

  // facets between the outline and an inner "table"
  const inner = scale(outer, 0.52, -6);
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const facet = [outer[i], outer[j], inner[j], inner[i]];
    const lightSide = (outer[i][1] + outer[j][1]) / 2 < 0;
    g.poly(flat(facet)).fill({ color: lightSide ? 0xffffff : 0x000000, alpha: lightSide ? 0.18 - i * 0.015 : 0.16 + i * 0.01 });
    g.moveTo(outer[i][0], outer[i][1]).lineTo(inner[i][0], inner[i][1]).stroke({ color: 0xffffff, width: 1.5, alpha: 0.25 });
  }
  g.poly(flat(inner)).fill(lin([[0, '#ffffff'], [1, c.light]])).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
  g.poly(flat(inner)).fill({ color: c.mid, alpha: 0.35 });
  g.poly(flat(outer)).stroke({ color: c.edge, width: 5, alignment: 1 });

  specular(g, -S * 0.32, -S * 0.42);
}

function specular(g: Graphics, x: number, y: number) {
  g.ellipse(x, y, 16, 9).fill({ color: 0xffffff, alpha: 0.75 });
  g.star(x + 30, y - 6, 4, 11, 2.5).fill({ color: 0xffffff, alpha: 0.9 });
}

function drawSymbol(id: number): Graphics {
  const g = new Graphics();
  switch (id) {
    case 0: // aqua — diamond
      gem(g, ngon(4, S * 0.92, -Math.PI / 2, 0.82, 1), { light: '#c9f6ff', mid: '#3fd8ff', dark: '#0a5bd6', edge: '#06307a' });
      break;
    case 1: // verde — hexagon
      gem(g, ngon(6, S * 0.82, 0), { light: '#d4ffe2', mid: '#3fe882', dark: '#0b8a4a', edge: '#064a28' });
      break;
    case 2: // violet — trillion
      gem(g, ngon(3, S * 0.95, Math.PI / 2, 1, 0.92).map(([x, y]) => [x, y - 8] as Pt), {
        light: '#f0dcff',
        mid: '#b46bff',
        dark: '#5a1fb8',
        edge: '#300e66',
      });
      break;
    case 3: {
      // ember — emerald cut
      const w = S * 0.72;
      const h = S * 0.86;
      const k = 26;
      const pts: Pt[] = [[-w + k, -h], [w - k, -h], [w, -h + k], [w, h - k], [w - k, h], [-w + k, h], [-w, h - k], [-w, -h + k]];
      gem(g, pts, { light: '#ffe2c4', mid: '#ff8a3d', dark: '#c2340a', edge: '#6a1a04' });
      break;
    }
    case 4: {
      // planet with ring
      const tilt = -0.35;
      const ring = (from: number, to: number, rx: number, ry: number) => {
        const pts: number[] = [];
        for (let i = 0; i <= 40; i++) {
          const a = from + ((to - from) * i) / 40;
          const x = Math.cos(a) * rx;
          const y = Math.sin(a) * ry;
          pts.push(x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt));
        }
        return pts;
      };
      g.poly(ring(Math.PI, Math.PI * 2, S * 0.98, S * 0.3), false).stroke({ color: 0xf5d27a, width: 10, alpha: 0.7 });
      g.circle(0, 0, S * 0.62).fill(rad([[0, '#d9fff8'], [0.35, '#41e0c8'], [0.8, '#13628a'], [1, '#0a2f55']], 0.36, 0.32));
      for (const [y, a] of [[-22, 0.25], [4, 0.18], [28, 0.22]] as const) {
        g.ellipse(0, y, S * 0.58, 7).fill({ color: 0x0a2f55, alpha: a });
      }
      g.circle(0, 0, S * 0.62).stroke({ color: 0x0a2f55, width: 4 });
      g.poly(ring(0, Math.PI, S * 0.98, S * 0.3), false).stroke({ color: 0xffe9a8, width: 10 });
      g.poly(ring(0, Math.PI, S * 0.98, S * 0.3), false).stroke({ color: 0xa8742a, width: 2, alpha: 0.6 });
      specular(g, -S * 0.25, -S * 0.32);
      break;
    }
    case 5: {
      // comet
      for (let i = 0; i < 5; i++) {
        const spread = 18 + i * 6;
        const len = S * (1.25 - i * 0.12);
        const a = -Math.PI * 0.75 + (i - 2) * 0.12;
        const tx = Math.cos(a) * len + 30;
        const ty = Math.sin(a) * len + 30;
        g.poly([30 - spread * 0.7, 30 + spread * 0.7, 30 + spread * 0.7, 30 - spread * 0.7, tx, ty]).fill({
          color: i % 2 ? 0xffd27a : 0xff8a3d,
          alpha: 0.35 - i * 0.04,
        });
      }
      g.circle(30, 30, S * 0.48).fill({ color: 0xff8a3d, alpha: 0.35 });
      g.circle(30, 30, S * 0.38).fill(rad([[0, '#ffffff'], [0.4, '#fff1b8'], [0.85, '#ffb347'], [1, '#e0611a']], 0.4, 0.38));
      g.circle(30, 30, S * 0.38).stroke({ color: 0xa83a0a, width: 4 });
      specular(g, 14, 8);
      break;
    }
    case 6: {
      // star
      g.star(0, 4, 5, S * 1.0, S * 0.5).fill({ color: 0xffd84a, alpha: 0.2 });
      g.star(0, 4, 5, S * 0.9, S * 0.44).fill(lin([[0, '#fff7c2'], [0.5, '#ffd84a'], [1, '#e08a00']]));
      const tips = ngon(5, S * 0.9, -Math.PI / 2).map(([x, y]) => [x, y + 4] as Pt);
      for (const [x, y] of tips) g.moveTo(0, 4).lineTo(x, y).stroke({ color: 0xffffff, width: 2, alpha: 0.45 });
      g.star(0, 4, 5, S * 0.42, S * 0.2).fill({ color: 0xffffff, alpha: 0.55 });
      g.star(0, 4, 5, S * 0.9, S * 0.44).stroke({ color: 0x9a5200, width: 5 });
      specular(g, -S * 0.2, -S * 0.3);
      break;
    }
    case 7: {
      // crown
      const pts: number[] = [-78, 36, -86, -46, -44, -2, 0, -70, 44, -2, 86, -46, 78, 36];
      g.poly([-60, 30, -50, -20, 0, -40, 50, -20, 60, 30]).fill({ color: 0x7a1a8a });
      g.poly(pts).fill(lin([[0, '#fff2b0'], [0.5, '#ffc93a'], [1, '#c77700']])).stroke({ color: 0x7a3a00, width: 5 });
      g.roundRect(-84, 30, 168, 40, 10).fill(lin([[0, '#ffe07a'], [1, '#b56a00']])).stroke({ color: 0x7a3a00, width: 5 });
      for (const [x, c] of [[-48, 0x3fd8ff], [0, 0xff4fb8], [48, 0x46f08a]] as const) {
        g.circle(x, 50, 12).fill(c).stroke({ color: 0x7a3a00, width: 3 });
        g.circle(x - 4, 46, 4).fill({ color: 0xffffff, alpha: 0.8 });
      }
      for (const [x, y] of [[-86, -46], [0, -70], [86, -46]] as const) {
        g.circle(x, y, 11).fill(0xff4fb8).stroke({ color: 0x7a3a00, width: 3 });
        g.circle(x - 3, y - 3, 3.5).fill({ color: 0xffffff, alpha: 0.85 });
      }
      specular(g, -40, -6);
      break;
    }
    case 8: {
      // portal (scatter)
      g.circle(0, 0, S * 0.98).fill(rad([[0, '#ffffff'], [0.25, '#ffb8f6'], [0.6, '#b02ad8'], [0.85, '#3a0a6a'], [1, 'rgba(58,10,106,0)']]));
      for (let i = 0; i < 3; i++) {
        const r = S * (0.42 + i * 0.17);
        g.circle(0, 0, r).stroke({ color: 0xffffff, width: 3 - i * 0.6, alpha: 0.65 - i * 0.15 });
      }
      for (let k = 0; k < 4; k++) {
        const pts: number[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const a = k * (Math.PI / 2) + t * 2.6;
          const r = S * (0.12 + t * 0.72);
          pts.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.poly(pts, false).stroke({ color: 0xfff0ff, width: 5 - k * 0.3, alpha: 0.85, cap: 'round' });
      }
      g.circle(0, 0, S * 0.16).fill(0xffffff);
      g.star(0, 0, 4, S * 0.5, S * 0.06).fill({ color: 0xffffff, alpha: 0.9 });
      break;
    }
  }
  return g;
}

function drawParticles(): { g: Graphics; frames: Record<string, Rectangle> } {
  const g = new Graphics();
  const frames: Record<string, Rectangle> = {};
  const y0 = CELL * 3;

  // big soft glow + ring in symbol-sized cells
  const glowX = CELL * 1;
  g.circle(glowX + CELL / 2, CELL * 2 + CELL / 2, CELL / 2 - 2).fill(
    rad([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]),
  );
  frames.glow = new Rectangle(glowX, CELL * 2, CELL, CELL);
  const ringX = CELL * 2;
  g.circle(ringX + CELL / 2, CELL * 2 + CELL / 2, CELL / 2 - 10).stroke({ color: 0xffffff, width: 8 });
  frames.ring = new Rectangle(ringX, CELL * 2, CELL, CELL);

  const P = 96;
  const cell = (i: number) => new Rectangle(i * P, y0, P, P);
  const cx = (i: number) => i * P + P / 2;
  const cy = y0 + P / 2;

  g.circle(cx(0), cy, P / 2 - 2).fill(rad([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]));
  frames.spark = cell(0);

  g.poly([cx(1), cy - 40, cx(1) + 16, cy - 4, cx(1) + 4, cy + 40, cx(1) - 18, cy + 6]).fill(0xffffff);
  g.poly([cx(1), cy - 40, cx(1) + 16, cy - 4, cx(1), cy]).fill({ color: 0xdddddd });
  frames.shard = cell(1);

  g.circle(cx(2), cy, 42).fill(lin([[0, '#fff5b8'], [0.5, '#ffc93a'], [1, '#b56a00']])).stroke({ color: 0x8a4a00, width: 4 });
  g.circle(cx(2), cy, 30).stroke({ color: 0xfff0a0, width: 3, alpha: 0.8 });
  g.star(cx(2), cy, 5, 20, 9).fill({ color: 0xb56a00 });
  g.ellipse(cx(2) - 14, cy - 18, 10, 5).fill({ color: 0xffffff, alpha: 0.7 });
  frames.coin = cell(2);

  g.star(cx(3), cy, 4, 46, 7).fill(0xffffff);
  g.circle(cx(3), cy, 8).fill(0xffffff);
  frames.sparkle = cell(3);

  g.circle(cx(4), cy, 30).fill(rad([[0, 'rgba(200,220,255,0.9)'], [1, 'rgba(120,160,255,0)']]));
  g.circle(cx(4), cy, 11).fill(lin([[0, '#ffffff'], [1, '#9fb4ff']]));
  frames.peg = cell(4);

  g.circle(cx(5), cy, 30).fill(rad([[0, '#ffffff'], [0.3, '#ffb8f6'], [0.9, '#ff3fae'], [1, '#a0106a']], 0.38, 0.35));
  g.ellipse(cx(5) - 9, cy - 11, 8, 5).fill({ color: 0xffffff, alpha: 0.85 });
  frames.ball = cell(5);

  return { g, frames };
}

export function buildAtlas(renderer: Renderer): Atlas {
  const rt = RenderTexture.create({ width: SIZE, height: SIZE, resolution: 1, antialias: true });
  const root = new Container();
  const symbols: Rectangle[] = [];

  for (let id = 0; id < 9; id++) {
    const g = drawSymbol(id);
    const col = id % 4;
    const row = Math.floor(id / 4);
    g.position.set(col * CELL + CELL / 2, row * CELL + CELL / 2);
    root.addChild(g);
    symbols.push(new Rectangle(col * CELL, row * CELL, CELL, CELL));
  }
  const { g: pg, frames } = drawParticles();
  root.addChild(pg);

  renderer.render({ container: root, target: rt, clear: true });
  root.destroy({ children: true });

  const tex = (frame: Rectangle) => new Texture({ source: rt.source, frame });
  return {
    symbols: symbols.map(tex),
    glow: tex(frames.glow),
    ring: tex(frames.ring),
    spark: tex(frames.spark),
    shard: tex(frames.shard),
    coin: tex(frames.coin),
    sparkle: tex(frames.sparkle),
    peg: tex(frames.peg),
    ball: tex(frames.ball),
    source: rt,
  };
}
