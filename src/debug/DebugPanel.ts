import type { App } from '../core/App';
import { i18n, LOCALES, type Locale } from '../core/i18n';
import { prefs, savePrefs } from '../core/Settings';
import type { HistoryEntry, NetFault } from '../shared/protocol';

const LATENCY: Record<string, [number, number]> = {
  fast: [20, 60],
  normal: [120, 320],
  slow: [900, 1600],
};

const CSS = `
#qa-toggle { position: fixed; left: 10px; bottom: 10px; z-index: 20; font: 600 12px/1 ui-monospace, Menlo, monospace;
  background: #1a0f3acc; color: #ffd84a; border: 1px solid #5a3fa8; border-radius: 8px; padding: 7px 9px; cursor: pointer; }
#qa { position: fixed; top: 10px; right: 10px; bottom: 10px; width: min(330px, calc(100vw - 50px)); z-index: 20; overflow: auto; display: none;
  font: 12px/1.45 ui-monospace, Menlo, monospace; color: #eae6ff; background: #0c0624ee; border: 1px solid #5a3fa8;
  border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 40px #000a; }
#qa.open { display: block; }
#qa h3 { margin: 14px 0 6px; font-size: 11px; letter-spacing: 1.5px; color: #9c94c9; text-transform: uppercase; }
#qa h3:first-child { margin-top: 0; }
#qa .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 10px; }
#qa .stats b { color: #3fd8ff; font-weight: 600; }
#qa .state { color: #ffd84a; font-weight: 700; }
#qa .hist { color: #9c94c9; max-height: 110px; overflow: auto; white-space: pre; }
#qa button, #qa select, #qa input { font: inherit; color: #eae6ff; background: #24164f; border: 1px solid #5a3fa8;
  border-radius: 6px; padding: 4px 8px; margin: 2px 4px 2px 0; cursor: pointer; }
#qa input { width: 90px; cursor: text; }
#qa button:hover { background: #3a2a7a; }
#qa button.armed { background: #b0127a; border-color: #ffc2ec; }
#qa .rounds div { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 2px 0;
  border-bottom: 1px solid #ffffff10; }
#qa .rounds .win { color: #46f08a; }
#qa .muted { color: #9c94c9; }
`;

/**
 * QA / dev tools overlay (toggle with the QA button or the ` key):
 * live perf stats, the active state machine, forced outcomes, round
 * history with visual replay, network fault injection, wallet controls.
 * In a real product this ships only in non-production builds.
 */
export class DebugPanel {
  private el: HTMLDivElement;
  private statsEl!: HTMLDivElement;
  private stateEl!: HTMLDivElement;
  private histEl!: HTMLDivElement;
  private forceEl!: HTMLDivElement;
  private roundsEl!: HTMLDivElement;
  private eventsEl!: HTMLDivElement;
  private armed: string | null = null;
  private latency = 'normal';

  constructor(private readonly app: App) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'qa-toggle';
    toggle.textContent = 'QA';
    toggle.onclick = () => this.toggle();
    document.body.appendChild(toggle);

    this.el = document.createElement('div');
    this.el.id = 'qa';
    document.body.appendChild(this.el);
    this.build();

    window.addEventListener('keydown', (e) => {
      if (e.key === '`') this.toggle();
    });
    app.emitSceneChange = () => {
      this.armed = null;
      this.renderForces();
      void this.refreshRounds();
    };
    setInterval(() => this.tick(), 250);
  }

  private toggle() {
    this.el.classList.toggle('open');
    if (this.el.classList.contains('open')) void this.refreshRounds();
  }

  private build() {
    this.el.innerHTML = `
      <h3>Performance</h3><div class="stats"></div>
      <h3>State machine</h3><div class="state"></div><div class="hist"></div>
      <h3>Force next outcome</h3><div class="force"></div>
      <h3>Rounds <button data-act="refresh">refresh</button></h3><div class="rounds"></div>
      <h3>Gamification</h3>
      <div><button data-act="xp">+150 XP</button><button data-act="gami-reset">reset progress</button></div>
      <div class="muted">event bus (RGS → gamification service), newest first:</div>
      <div class="events hist"></div>
      <h3>Network</h3>
      <div>
        <select data-act="latency">${Object.keys(LATENCY).map((k) => `<option ${k === this.latency ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <button data-act="fault" data-fault="error">fail next</button>
        <button data-act="fault" data-fault="lost">lose next response</button>
      </div>
      <div class="muted">"lose" processes the bet then drops the reply: the client times out, retries with the same requestId, and the server's idempotency cache prevents a double debit.</div>
      <h3>Session</h3>
      <div><button data-act="reload-mid">spin + reload mid-round</button></div>
      <div>
        <input data-act="balance" type="number" placeholder="balance €" />
        <button data-act="set-balance">set</button>
        <button data-act="reset">reset wallet</button>
      </div>
      <h3>Display</h3>
      <div>
        quality <select data-act="quality">${['high', 'low'].map((q) => `<option ${q === prefs.quality ? 'selected' : ''}>${q}</option>`).join('')}</select>
        locale <select data-act="locale">${LOCALES.map((l) => `<option ${l === i18n.locale ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>`;
    this.statsEl = this.el.querySelector('.stats')!;
    this.stateEl = this.el.querySelector('.state')!;
    this.histEl = this.el.querySelector('.hist')!;
    this.forceEl = this.el.querySelector('.force')!;
    this.roundsEl = this.el.querySelector('.rounds')!;
    this.eventsEl = this.el.querySelector('.events')!;
    this.app.gami.on('log', () => this.renderEvents());
    this.renderEvents();

    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT') return;
      void this.act(btn);
    });
    this.el.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.dataset.act === 'latency') {
        this.latency = sel.value;
        this.app.server.setNetwork(LATENCY[sel.value]);
      } else if (sel.dataset.act === 'quality') {
        this.app.setQuality(sel.value as 'high' | 'low');
      } else if (sel.dataset.act === 'locale') {
        savePrefs({ locale: sel.value as Locale });
        i18n.set(sel.value as Locale);
      }
    });
    this.renderForces();
  }

  private async act(btn: HTMLElement) {
    const app = this.app;
    switch (btn.dataset.act) {
      case 'force': {
        const f = btn.dataset.force!;
        this.armed = this.armed === f ? null : f;
        app.scene?.debug?.setForce(this.armed);
        this.renderForces();
        break;
      }
      case 'refresh':
        await this.refreshRounds();
        break;
      case 'replay':
        app.scene?.debug?.replay?.(btn.dataset.id!);
        break;
      case 'fault':
        app.server.setNetwork(LATENCY[this.latency], btn.dataset.fault as NetFault);
        app.toast(`next request: ${btn.dataset.fault}`, 'warn', 1500);
        break;
      case 'reload-mid':
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
        setTimeout(() => location.replace(`?game=${app.sceneId ?? 'lobby'}`), 900);
        break;
      case 'set-balance': {
        const v = Number(this.el.querySelector<HTMLInputElement>('[data-act=balance]')!.value);
        if (Number.isFinite(v)) {
          await app.server.call('wallet.set', { balance: Math.round(v * 100) });
          location.reload();
        }
        break;
      }
      case 'xp':
        await app.server.call('gami.grant', { xp: 150 });
        break;
      case 'gami-reset':
        await app.server.call('gami.reset', {});
        location.reload();
        break;
      case 'reset':
        await app.server.call('wallet.reset', {});
        location.reload();
        break;
    }
  }

  private renderEvents() {
    const rows = this.app.gami.log.slice(0, 12).map(({ event: e, xp, completed }) => {
      const x = e.bet ? (e.win / e.bet).toFixed(1) : '0';
      return `#${String(e.seq).padStart(3)} ${e.game.padEnd(6)} ${e.mode.padEnd(6)} ${x.padStart(6)}x  +${xp}xp${completed ? `  ✓${completed}` : ''}`;
    });
    this.eventsEl.textContent = rows.join('\n') || 'no events yet';
  }

  private renderForces() {
    const forces = this.app.scene?.debug?.forces ?? [];
    this.forceEl.innerHTML = forces.length
      ? forces.map((f) => `<button data-act="force" data-force="${f}" class="${this.armed === f ? 'armed' : ''}">${f}</button>`).join('')
      : '<span class="muted">open a game</span>';
  }

  private async refreshRounds() {
    if (!this.el.classList.contains('open')) return;
    const s = await this.app.server.call('session.init', {});
    const rows = s.history.slice(0, 12).map((h: HistoryEntry) => {
      const canReplay = h.game === 'slot' && this.app.sceneId === 'slot';
      return `<div><span>${h.game === 'slot' ? '🎰' : '🔻'} ${h.roundId.slice(-6)} <span class="muted">${h.mode}</span></span>
        <span class="${h.win > 0 ? 'win' : 'muted'}">${i18n.fmt(h.win)}</span>
        ${canReplay ? `<button data-act="replay" data-id="${h.roundId}">replay</button>` : ''}</div>`;
    });
    this.roundsEl.innerHTML = rows.join('') || '<span class="muted">no rounds yet</span>';
  }

  private tick() {
    if (!this.el.classList.contains('open')) return;
    const s = this.app.stats;
    const r = this.app.pixi.renderer;
    this.statsEl.innerHTML = `
      <span>fps <b>${s.fps.toFixed(0)}</b></span><span>draw calls <b>${s.drawCalls}</b></span>
      <span>frame <b>${s.frameMs.toFixed(1)}ms</b></span><span>tweens <b>${this.app.tweens.count}</b></span>
      <span>renderer <b>${r.name}</b></span><span>res <b>${r.resolution}x</b></span>`;
    const fsm = this.app.scene?.debug?.fsm;
    if (fsm) {
      this.stateEl.textContent = `${fsm.name}: ${fsm.state}`;
      this.histEl.textContent = fsm.history
        .slice(-10)
        .reverse()
        .map((h) => `${(h.at / 1000).toFixed(2).padStart(8)}s  ${h.from} → ${h.to}`)
        .join('\n');
    } else {
      this.stateEl.textContent = this.app.sceneId ?? '';
      this.histEl.textContent = '';
    }
    // forced outcome is consumed by the next round
    if (this.armed && fsm && fsm.state !== 'idle' && fsm.state !== 'boot') {
      this.armed = null;
      this.renderForces();
    }
  }
}
