import { Container, Sprite } from 'pixi.js';
import { SYMBOL_COLORS, type Atlas } from '../../../core/Atlas';
import { SCATTER } from '../math/config';

/** One symbol on the grid. Pooled by the Grid; reset via `set()`. */
export class SymbolView extends Container {
  id = 0;
  readonly sprite: Sprite;
  readonly glow: Sprite;
  private highlighted = false;
  private time = Math.random() * 1000;
  private baseScale = 1;

  constructor(private readonly atlas: Atlas) {
    super();
    this.glow = new Sprite(atlas.glow);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.visible = false;
    this.sprite = new Sprite(atlas.symbols[0]);
    this.sprite.anchor.set(0.5);
    this.addChild(this.glow, this.sprite);
  }

  set(id: number, cell: number): this {
    this.id = id;
    this.sprite.texture = this.atlas.symbols[id];
    this.baseScale = (cell / 200) * 0.94;
    this.sprite.scale.set(this.baseScale);
    this.sprite.rotation = 0;
    this.sprite.filters = null;
    this.glow.tint = SYMBOL_COLORS[id];
    this.glow.scale.set((cell / 224) * 1.5);
    this.glow.visible = false;
    this.highlighted = false;
    this.alpha = 1;
    this.scale.set(1);
    this.visible = true;
    return this;
  }

  get color() {
    return SYMBOL_COLORS[this.id];
  }

  setHighlight(on: boolean) {
    this.highlighted = on;
    this.glow.visible = on;
    if (!on) this.sprite.scale.set(this.baseScale);
  }

  update(dtMs: number) {
    this.time += dtMs;
    if (this.id === SCATTER) this.sprite.rotation += dtMs * 0.0012;
    if (this.highlighted) {
      const k = 0.5 + 0.5 * Math.sin(this.time / 110);
      this.sprite.scale.set(this.baseScale * (1.04 + k * 0.08));
      this.glow.alpha = 0.45 + k * 0.45;
    }
  }
}
