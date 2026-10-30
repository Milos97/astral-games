import { Graphics } from 'pixi.js';

/** Vector icons drawn centred on (0,0) at roughly `s` px. */
export const icons = {
  spin(s = 60, color = 0xffffff) {
    const g = new Graphics();
    const r = s * 0.36;
    for (const rot of [0, Math.PI]) {
      g.arc(0, 0, r, rot + 0.35, rot + Math.PI - 0.35).stroke({ color, width: s * 0.12, cap: 'round' });
      const a = rot + Math.PI - 0.35;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const k = s * 0.16;
      const tx = -Math.sin(a);
      const ty = Math.cos(a);
      g.poly([x + tx * k, y + ty * k, x + Math.cos(a) * k, y + Math.sin(a) * k, x - Math.cos(a) * k, y - Math.sin(a) * k]).fill(color);
    }
    return g;
  },
  stop(s = 60, color = 0xffffff) {
    return new Graphics().roundRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44, s * 0.06).fill(color);
  },
  turbo(s = 40, color = 0xffffff) {
    const k = s / 40;
    return new Graphics().poly([4, -18, -10, 3, -1, 3, -5, 18, 11, -4, 2, -4, 7, -18].map((v) => v * k)).fill(color);
  },
  auto(s = 40, color = 0xffffff) {
    const g = new Graphics();
    g.arc(0, 0, s * 0.32, -Math.PI * 0.2, Math.PI * 1.45).stroke({ color, width: s * 0.1, cap: 'round' });
    g.poly([s * 0.2, -s * 0.38, s * 0.42, -s * 0.18, s * 0.14, -s * 0.06]).fill(color);
    g.poly([-s * 0.07, -s * 0.13, s * 0.13, 0, -s * 0.07, s * 0.13]).fill(color);
    return g;
  },
  sound(s = 36, color = 0xffffff, on = true) {
    const k = s / 36;
    const g = new Graphics();
    g.poly([-14, -5, -7, -5, 2, -13, 2, 13, -7, 5, -14, 5].map((v) => v * k)).fill(color);
    if (on) {
      g.arc(3 * k, 0, 8 * k, -0.9, 0.9).stroke({ color, width: 2.6 * k, cap: 'round' });
      g.arc(3 * k, 0, 14 * k, -0.9, 0.9).stroke({ color, width: 2.6 * k, cap: 'round' });
    } else {
      g.moveTo(7 * k, -6 * k).lineTo(17 * k, 6 * k).stroke({ color, width: 3 * k, cap: 'round' });
      g.moveTo(17 * k, -6 * k).lineTo(7 * k, 6 * k).stroke({ color, width: 3 * k, cap: 'round' });
    }
    return g;
  },
  info(s = 36, color = 0xffffff) {
    const k = s / 36;
    const g = new Graphics();
    g.circle(0, -9 * k, 2.8 * k).fill(color);
    g.roundRect(-2.6 * k, -3 * k, 5.2 * k, 15 * k, 2 * k).fill(color);
    return g;
  },
  home(s = 36, color = 0xffffff) {
    const k = s / 36;
    const g = new Graphics();
    g.poly([0, -14, 15, 0, 10, 0, 10, 13, 3, 13, 3, 4, -3, 4, -3, 13, -10, 13, -10, 0, -15, 0].map((v) => v * k)).fill(color);
    return g;
  },
  minus(s = 30, color = 0xffffff) {
    return new Graphics().roundRect(-s * 0.32, -s * 0.07, s * 0.64, s * 0.14, s * 0.07).fill(color);
  },
  plus(s = 30, color = 0xffffff) {
    return new Graphics()
      .roundRect(-s * 0.32, -s * 0.07, s * 0.64, s * 0.14, s * 0.07)
      .fill(color)
      .roundRect(-s * 0.07, -s * 0.32, s * 0.14, s * 0.64, s * 0.07)
      .fill(color);
  },
  close(s = 30, color = 0xffffff) {
    const g = new Graphics();
    const r = s * 0.28;
    g.moveTo(-r, -r).lineTo(r, r).stroke({ color, width: s * 0.12, cap: 'round' });
    g.moveTo(r, -r).lineTo(-r, r).stroke({ color, width: s * 0.12, cap: 'round' });
    return g;
  },
};
