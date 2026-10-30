import { BitmapFont, BitmapText, FillGradient, Text, type TextStyleOptions } from 'pixi.js';

export const FONT = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';

const gold = () =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: '#fffbe0' },
      { offset: 0.45, color: '#ffd84a' },
      { offset: 1, color: '#ff8a1f' },
    ],
    textureSpace: 'local',
  });

export const COLORS = {
  text: 0xeae6ff,
  dim: 0x9c94c9,
  accent: 0xff4fb8,
  cyan: 0x3fd8ff,
  gold: 0xffd84a,
  panel: 0x1a0f3a,
  panelEdge: 0x5a3fa8,
};

export function label(text: string, size = 22, color = COLORS.dim, extra: TextStyleOptions = {}): Text {
  const t = new Text({
    text,
    style: { fontFamily: FONT, fontSize: size, fontWeight: '600', fill: color, letterSpacing: 1.5, ...extra },
  });
  t.anchor.set(0.5);
  return t;
}

export function title(text: string, size = 72, extra: TextStyleOptions = {}): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: '700',
      fill: gold(),
      stroke: { color: 0x4a0f5a, width: Math.max(4, size * 0.09), join: 'round' },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: size * 0.06, angle: Math.PI / 2 },
      letterSpacing: 2,
      align: 'center',
      ...extra,
    },
  });
  t.anchor.set(0.5);
  return t;
}

const NUM_CHARS = [['0', '9'], '.,€$£x+-:/ %·', '  '] as (string | string[])[];

/**
 * Numbers that change every frame (count-ups, balances) use BitmapText:
 * updating a canvas Text re-rasterises and re-uploads a texture each frame;
 * a bitmap font just re-lays out quads from a pre-built glyph atlas.
 */
export function installFonts() {
  BitmapFont.install({
    name: 'num',
    style: { fontFamily: FONT, fontSize: 64, fontWeight: '700', fill: 0xffffff },
    chars: NUM_CHARS,
    resolution: 2,
  });
  BitmapFont.install({
    name: 'numGold',
    style: {
      fontFamily: FONT,
      fontSize: 96,
      fontWeight: '700',
      fill: gold(),
      stroke: { color: 0x4a0f5a, width: 9, join: 'round' },
      dropShadow: { color: 0x000000, alpha: 0.5, blur: 6, distance: 6, angle: Math.PI / 2 },
    },
    chars: NUM_CHARS,
    resolution: 1.5,
    padding: 12,
  });
}

export function num(text: string, size: number, font: 'num' | 'numGold' = 'num', tint = 0xffffff): BitmapText {
  const t = new BitmapText({ text, style: { fontFamily: font, fontSize: size } });
  t.anchor.set(0.5);
  t.tint = tint;
  return t;
}
