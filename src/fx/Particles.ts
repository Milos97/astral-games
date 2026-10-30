import { Particle, ParticleContainer, Rectangle, type Texture } from 'pixi.js';

const rand = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);

export interface EmitOptions {
  texture: Texture;
  x: number;
  y: number;
  count: number;
  /** px per second */
  speed: readonly [number, number];
  /** radians; default full circle */
  angle?: readonly [number, number];
  /** px/s² */
  gravity?: number;
  /** velocity kept per second (0..1) */
  drag?: number;
  /** ms */
  life: readonly [number, number];
  scale: readonly [number, number];
  /** scale multiplier reached at end of life */
  scaleEnd?: number;
  tint?: number | readonly number[];
  /** radians per second */
  spin?: readonly [number, number];
  /** spawn jitter radius */
  spread?: number;
  /** coin-style flip around the vertical axis */
  flip?: boolean;
  fadeIn?: number;
}

interface Live {
  p: Particle;
  vx: number;
  vy: number;
  age: number;
  life: number;
  spin: number;
  s0: number;
  s1: number;
  gravity: number;
  drag: number;
  flip: number;
  fadeIn: number;
}

/**
 * Pooled particle system on a v8 ParticleContainer. Every texture comes
 * from the shared atlas, so explosions, sparkles and coin showers of any
 * mix render in one draw call. Thousands of particles stay cheap: no
 * per-particle display objects, no allocations after warm-up.
 */
export class Particles {
  readonly view: ParticleContainer;
  private live: Live[] = [];
  private pool: Live[] = [];
  /** Global cap, lowered on "low" quality. */
  max = 4000;

  constructor(sharedTexture: Texture, bounds: Rectangle = new Rectangle(-4000, -4000, 8000, 8000)) {
    this.view = new ParticleContainer({
      texture: sharedTexture,
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true, uvs: true },
    });
    this.view.boundsArea = bounds;
  }

  get count() {
    return this.live.length;
  }

  emit(o: EmitOptions) {
    const n = Math.min(o.count, this.max - this.live.length);
    const tints = typeof o.tint === 'number' ? [o.tint] : (o.tint ?? [0xffffff]);
    for (let i = 0; i < n; i++) {
      const l = this.pool.pop() ?? this.make(o.texture);
      const p = l.p;
      p.texture = o.texture;
      const a = o.angle ? rand(o.angle) : Math.random() * Math.PI * 2;
      const sp = rand(o.speed);
      const jitter = o.spread ? Math.random() * o.spread : 0;
      const ja = Math.random() * Math.PI * 2;
      p.x = o.x + Math.cos(ja) * jitter;
      p.y = o.y + Math.sin(ja) * jitter;
      p.rotation = Math.random() * Math.PI * 2;
      p.tint = tints[(Math.random() * tints.length) | 0];
      p.alpha = o.fadeIn ? 0 : 1;
      l.vx = Math.cos(a) * sp;
      l.vy = Math.sin(a) * sp;
      l.age = 0;
      l.life = rand(o.life);
      l.spin = o.spin ? rand(o.spin) : 0;
      l.s0 = rand(o.scale);
      l.s1 = l.s0 * (o.scaleEnd ?? 1);
      l.gravity = o.gravity ?? 0;
      l.drag = o.drag ?? 1;
      l.flip = o.flip ? Math.random() * 10 : -1;
      l.fadeIn = o.fadeIn ?? 0;
      p.scaleX = p.scaleY = l.s0;
      this.live.push(l);
      this.view.particleChildren.push(p);
    }
    if (n > 0) this.view.update();
  }

  update(dtMs: number) {
    if (this.live.length === 0) return;
    const dt = dtMs / 1000;
    const live = this.live;
    const kids = this.view.particleChildren;
    let removed = false;

    for (let i = live.length - 1; i >= 0; i--) {
      const l = live[i];
      l.age += dtMs;
      const t = l.age / l.life;
      if (t >= 1) {
        // swap-remove from both arrays (same order is kept in both)
        const last = live.length - 1;
        live[i] = live[last];
        live.pop();
        kids[i] = kids[last];
        kids.pop();
        this.pool.push(l);
        removed = true;
        continue;
      }
      const p = l.p;
      if (l.drag !== 1) {
        const k = Math.pow(l.drag, dt);
        l.vx *= k;
        l.vy *= k;
      }
      l.vy += l.gravity * dt;
      p.x += l.vx * dt;
      p.y += l.vy * dt;
      p.rotation += l.spin * dt;
      const s = l.s0 + (l.s1 - l.s0) * t;
      if (l.flip >= 0) {
        l.flip += dt * 9;
        p.scaleX = s * Math.cos(l.flip);
        p.scaleY = s;
      } else {
        p.scaleX = p.scaleY = s;
      }
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      p.alpha = l.fadeIn > 0 && l.age < l.fadeIn ? (l.age / l.fadeIn) * fade : fade;
    }
    if (removed) this.view.update();
  }

  clear() {
    this.pool.push(...this.live);
    this.live.length = 0;
    this.view.particleChildren.length = 0;
    this.view.update();
  }

  private make(texture: Texture): Live {
    const p = new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
    return { p, vx: 0, vy: 0, age: 0, life: 1, spin: 0, s0: 1, s1: 1, gravity: 0, drag: 1, flip: -1, fadeIn: 0 };
  }
}
