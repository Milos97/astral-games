import { Application, Container, UPDATE_PRIORITY, type WebGLRenderer } from 'pixi.js';
import { buildAtlas, type Atlas } from './Atlas';
import { sfx } from './Audio';
import { i18n, t } from './i18n';
import { ServerClient, ServerError } from './ServerClient';
import { prefs, savePrefs } from './Settings';
import type { StateMachine } from './StateMachine';
import { Tweens } from './Tweens';
import { Background } from '../fx/Background';
import { Toasts, type ToastKind } from '../ui/Toasts';
import type { SessionInfo } from '../shared/protocol';

export type Orientation = 'landscape' | 'portrait';

export interface Layout {
  orientation: Orientation;
  /** Design-space size the scene lays out in. */
  width: number;
  height: number;
  screenW: number;
  screenH: number;
  scale: number;
}

const DESIGN: Record<Orientation, [number, number]> = { landscape: [1920, 1080], portrait: [1080, 1920] };

/** Hooks a game exposes to the QA/debug panel. */
export interface DebugHooks {
  fsm: StateMachine<string>;
  forces: readonly string[];
  setForce(force: string | null): void;
  replay?(roundId: string): void;
}

export interface Scene {
  readonly root: Container;
  layout(l: Layout): void;
  update(dtMs: number): void;
  destroy(): void;
  onKey?(e: KeyboardEvent): void;
  debug?: DebugHooks;
  /** Scene is mid-round; the shell should not allow leaving. */
  busy?(): boolean;
}

export type SceneId = 'lobby' | 'slot' | 'plinko';

/**
 * Game shell shared by every game: renderer, design-resolution layout
 * (separate landscape and portrait designs), the RGS client, tween clock,
 * shared texture atlas, toasts and screen shake. Games are Scenes.
 */
export class App {
  readonly pixi = new Application();
  readonly tweens = new Tweens();
  readonly server = new ServerClient();
  readonly world = new Container();
  readonly toasts = new Toasts();
  atlas!: Atlas;
  session!: SessionInfo;
  background!: Background;
  layout!: Layout;
  scene: Scene | null = null;
  sceneId: SceneId | null = null;
  readonly stats = { fps: 0, drawCalls: 0, frameMs: 0 };
  private factories = new Map<SceneId, () => Scene>();
  private scene_layer = new Container();
  private shakeAmp = 0;
  private drawCounter = 0;

  async boot(onProgress: (k: number, label: string) => void) {
    onProgress(0.1, 'renderer');
    await this.pixi.init({
      resizeTo: window,
      background: 0x05020f,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, prefs.quality === 'high' ? 2 : 1),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    document.getElementById('app')!.appendChild(this.pixi.canvas);
    this.instrumentDrawCalls();

    onProgress(0.4, 'textures');
    await nextFrame();
    this.atlas = buildAtlas(this.pixi.renderer);
    this.background = new Background(this.atlas.spark);
    this.background.setQuality(prefs.quality);

    this.pixi.stage.addChild(this.background.view, this.world);
    this.world.addChild(this.scene_layer, this.toasts);

    onProgress(0.7, 'server');
    i18n.set(prefs.locale);
    sfx.muted = !prefs.sound;
    this.session = await this.server.call('session.init', {});
    i18n.currency = this.session.currency;

    this.server.on('net', (s) => {
      if (s.kind === 'retrying') this.toast(t('reconnecting', { n: s.attempt }), 'warn', 1400);
      else if (s.kind === 'recovered') this.toast(t('reconnected'), 'ok', 1400);
      else this.toast(t('connectionLost'), 'error', 3500);
    });

    this.pixi.ticker.add((tk) => this.tick(tk.deltaMS));
    this.pixi.ticker.add(() => (this.drawCounter = 0), undefined, UPDATE_PRIORITY.INTERACTION);
    window.addEventListener('resize', () => this.relayout());
    window.addEventListener('keydown', (e) => this.scene?.onKey?.(e));
    this.relayout();
    onProgress(1, 'ready');
  }

  register(id: SceneId, factory: () => Scene) {
    this.factories.set(id, factory);
  }

  goto(id: SceneId) {
    if (this.scene?.busy?.()) return;
    this.scene?.destroy();
    this.scene_layer.removeChildren();
    this.tweens.skipping = false;
    this.scene = this.factories.get(id)!();
    this.sceneId = id;
    this.scene_layer.addChild(this.scene.root);
    this.scene.layout(this.layout);
    this.emitSceneChange?.(id);
  }

  emitSceneChange?: (id: SceneId) => void;

  toast(message: string, kind: ToastKind = 'info', ms?: number) {
    this.toasts.show(message, kind, ms);
  }

  errorToast(e: unknown) {
    if (e instanceof ServerError && e.code === 'INSUFFICIENT_FUNDS') this.toast(t('insufficientFunds'), 'warn');
    else if (e instanceof ServerError && (e.code === 'NETWORK' || e.code === 'TIMEOUT')) return; // already reported
    else this.toast(String((e as Error).message ?? e), 'error');
  }

  shake(amp: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  setQuality(q: 'high' | 'low') {
    savePrefs({ quality: q });
    this.background.setQuality(q);
    this.pixi.renderer.resolution = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1);
    this.relayout();
  }

  private relayout() {
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const orientation: Orientation = sw >= sh * 0.95 ? 'landscape' : 'portrait';
    const [dw, dh] = DESIGN[orientation];
    const scale = Math.min(sw / dw, sh / dh);
    this.layout = { orientation, width: dw, height: dh, screenW: sw, screenH: sh, scale };
    this.world.scale.set(scale);
    this.world.position.set((sw - dw * scale) / 2, (sh - dh * scale) / 2);
    this.background.resize(sw, sh);
    this.toasts.position.set(dw / 2, 120);
    this.scene?.layout(this.layout);
  }

  private tick(dtMs: number) {
    const dt = Math.min(dtMs, 100); // a background tab must not teleport animations
    this.stats.fps = this.pixi.ticker.FPS;
    this.stats.frameMs = dtMs;
    this.tweens.tick(dt);
    this.background.update(dt);
    this.scene?.update(dt);

    const l = this.layout;
    const baseX = (l.screenW - l.width * l.scale) / 2;
    const baseY = (l.screenH - l.height * l.scale) / 2;
    if (this.shakeAmp > 0.2) {
      this.shakeAmp *= Math.pow(0.0025, dt / 1000);
      this.world.position.set(
        baseX + (Math.random() - 0.5) * this.shakeAmp * l.scale,
        baseY + (Math.random() - 0.5) * this.shakeAmp * l.scale,
      );
    } else if (this.shakeAmp > 0) {
      this.shakeAmp = 0;
      this.world.position.set(baseX, baseY);
    }
  }

  /** Count real GL draw calls per frame for the debug overlay. */
  private instrumentDrawCalls() {
    const gl = (this.pixi.renderer as WebGLRenderer).gl as WebGL2RenderingContext | undefined;
    if (!gl) return;
    const wrap = <K extends 'drawElements' | 'drawArrays' | 'drawElementsInstanced' | 'drawArraysInstanced'>(k: K) => {
      const orig = gl[k].bind(gl) as (...a: unknown[]) => void;
      (gl as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
        this.drawCounter++;
        orig(...a);
      };
    };
    wrap('drawElements');
    wrap('drawArrays');
    wrap('drawElementsInstanced');
    wrap('drawArraysInstanced');
    this.pixi.renderer.runners.postrender.add({ postrender: () => (this.stats.drawCalls = this.drawCounter) });
  }
}

/** Yield so the loader can paint. Not rAF: that never fires in a background tab. */
export const nextFrame = () => new Promise<void>((r) => setTimeout(r, 16));
