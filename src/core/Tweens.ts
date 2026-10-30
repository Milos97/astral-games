/**
 * Promise-based tween engine driven by the Pixi ticker.
 *
 * Two features exist specifically for slot presentation:
 *  - `timeScale` speeds every tween and wait up (turbo mode).
 *  - `skipping` makes new tweens/waits complete instantly, and finishAll()
 *    jumps in-flight ones to their end state. Async presentation code keeps
 *    running, just in zero time, so a slam-stop always lands in exactly the
 *    same final state as a fully watched animation.
 */
export type EaseFn = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
  cubicIn: (t: number) => t * t * t,
  cubicOut: (t: number) => 1 - (1 - t) ** 3,
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  expoOut: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  backOut: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  backIn: (t: number) => 2.70158 * t * t * t - 1.70158 * t * t,
  elasticOut: (t: number) =>
    t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1,
  bounceOut: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} satisfies Record<string, EaseFn>;

export interface TweenOptions {
  /** Milliseconds at timeScale 1. */
  duration: number;
  delay?: number;
  ease?: EaseFn;
  onUpdate?: (t: number) => void;
}

type Props = Record<string, number>;
/** Only the numeric properties of T can be tweened. */
export type NumProps<T> = { [K in keyof T as T[K] extends number ? K : never]?: number };

class Tween {
  elapsed = 0;
  started = false;
  from: Props = {};

  constructor(
    readonly target: Record<string, unknown>,
    readonly to: Props,
    readonly duration: number,
    public delay: number,
    readonly ease: EaseFn,
    readonly onUpdate: ((t: number) => void) | undefined,
    readonly resolve: () => void,
  ) {}

  start() {
    this.started = true;
    for (const k in this.to) this.from[k] = this.target[k] as number;
  }

  apply(t: number) {
    const e = this.ease(t);
    for (const k in this.to) this.target[k] = this.from[k] + (this.to[k] - this.from[k]) * e;
    this.onUpdate?.(e);
  }
}

export class Tweens {
  timeScale = 1;
  skipping = false;
  private list: Tween[] = [];

  to<T extends object>(target: T, props: NumProps<T>, opts: TweenOptions): Promise<void> {
    return new Promise((resolve) => {
      const tw = new Tween(
        target as Record<string, unknown>,
        props as Props,
        opts.duration,
        opts.delay ?? 0,
        opts.ease ?? Ease.cubicOut,
        opts.onUpdate,
        resolve,
      );
      if (this.skipping || (opts.duration <= 0 && tw.delay <= 0)) {
        tw.start();
        tw.apply(1);
        resolve();
        return;
      }
      this.list.push(tw);
    });
  }

  /** Tween a 0..1 value and receive it (eased) in onUpdate. */
  value(opts: TweenOptions & { onUpdate: (t: number) => void }): Promise<void> {
    return this.to({ t: 0 }, { t: 1 }, opts);
  }

  wait(ms: number): Promise<void> {
    return this.to({}, {}, { duration: ms });
  }

  tick(dtMs: number) {
    if (this.list.length === 0) return;
    const dt = dtMs * this.timeScale;
    const done: Tween[] = [];
    // copy: callbacks may add tweens while we iterate
    for (const tw of this.list.slice()) {
      if (tw.delay > 0) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
      }
      if (!tw.started) tw.start();
      tw.elapsed += dt;
      const t = tw.duration <= 0 ? 1 : Math.min(1, tw.elapsed / tw.duration);
      tw.apply(t);
      if (t >= 1) done.push(tw);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      done.forEach((t) => t.resolve());
    }
  }

  /** Jump every running tween (optionally only those on `target`) to its end. */
  finishAll(target?: object) {
    const hit = target ? this.list.filter((t) => t.target === target) : this.list;
    if (hit.length === 0) return;
    this.list = target ? this.list.filter((t) => t.target !== target) : [];
    for (const tw of hit) {
      if (!tw.started) tw.start();
      tw.apply(1);
      tw.resolve();
    }
  }

  /** Stop tweens on `target` where they are; their promises still resolve. */
  kill(target: object) {
    const hit = this.list.filter((t) => t.target === target);
    this.list = this.list.filter((t) => t.target !== target);
    hit.forEach((t) => t.resolve());
  }

  get count() {
    return this.list.length;
  }
}
