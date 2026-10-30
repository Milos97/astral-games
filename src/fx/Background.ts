import { Container, FillGradient, Graphics, Particle, ParticleContainer, Rectangle, Sprite, Texture } from 'pixi.js';
import { NebulaFilter } from './filters';

interface Star {
  p: Particle;
  depth: number;
  phase: number;
}

/**
 * Screen-space backdrop: a shader nebula (high quality) or a static
 * gradient (low quality), plus a parallax starfield in a ParticleContainer.
 */
export class Background {
  readonly view = new Container();
  private quad = new Sprite(Texture.WHITE);
  private flat = new Graphics();
  private nebula = new NebulaFilter();
  private stars: Star[] = [];
  private starLayer: ParticleContainer;
  private w = 1;
  private h = 1;
  private time = Math.random() * 100;
  /** 0 = base game palette, 1 = free spins palette. Tweened by games. */
  mood = 0;
  pulse = 0;

  constructor(spark: Texture) {
    this.nebula.resolution = 0.5;
    this.quad.filters = [this.nebula];
    this.starLayer = new ParticleContainer({ texture: spark, dynamicProperties: { position: true, color: true } });
    this.view.addChild(this.flat, this.quad, this.starLayer);
    for (let i = 0; i < 260; i++) {
      const depth = Math.random();
      const p = new Particle({ texture: spark, anchorX: 0.5, anchorY: 0.5 });
      p.scaleX = p.scaleY = 0.04 + depth * 0.12;
      p.tint = Math.random() < 0.2 ? 0xffc2ec : Math.random() < 0.3 ? 0xa8e8ff : 0xffffff;
      this.stars.push({ p, depth, phase: Math.random() * Math.PI * 2 });
      this.starLayer.addParticle(p);
    }
  }

  setQuality(q: 'high' | 'low') {
    this.quad.visible = q === 'high';
    this.flat.visible = q === 'low';
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.quad.width = w;
    this.quad.height = h;
    const a = this.nebula.u.uAspect;
    a[0] = w / Math.min(w, h);
    a[1] = h / Math.min(w, h);
    this.flat
      .clear()
      .rect(0, 0, w, h)
      .fill(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: '#140a33' },
            { offset: 1, color: '#05020f' },
          ],
          textureSpace: 'local',
        }),
      );
    this.starLayer.boundsArea = new Rectangle(0, 0, w, h);
    for (const s of this.stars) {
      s.p.x = Math.random() * w;
      s.p.y = Math.random() * h;
    }
  }

  update(dtMs: number) {
    this.time += dtMs / 1000;
    this.pulse = Math.max(0, this.pulse - dtMs / 600);
    const u = this.nebula.u;
    u.uTime = this.time;
    u.uMood = this.mood;
    u.uPulse = this.pulse;

    const speed = 6 + this.mood * 30;
    for (const s of this.stars) {
      const p = s.p;
      p.y += (speed * (0.2 + s.depth) * dtMs) / 1000;
      if (p.y > this.h + 4) {
        p.y = -4;
        p.x = Math.random() * this.w;
      }
      p.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * (1 + s.depth * 3) + s.phase));
    }
  }
}
