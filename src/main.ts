import { App } from './core/App';
import { DebugPanel } from './debug/DebugPanel';
import { SlotScene } from './games/slot/client/SlotScene';
import { PlinkoScene } from './games/plinko/client/PlinkoScene';
import { Lobby } from './lobby/Lobby';
import { installFonts } from './ui/text';

const bootEl = document.getElementById('boot')!;
const fill = bootEl.querySelector<HTMLDivElement>('.fill')!;
const msg = bootEl.querySelector<HTMLDivElement>('.msg')!;
const progress = (k: number, label: string) => {
  fill.style.width = `${Math.round(k * 100)}%`;
  msg.textContent = label;
};

async function loadFonts() {
  // never block boot on the CDN: fall back to system fonts after 2.5s
  const timeout = new Promise((r) => setTimeout(r, 2500));
  await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('600 40px Fredoka')]), timeout]);
}

async function main() {
  progress(0.05, 'fonts');
  await loadFonts();
  installFonts();

  const app = new App();
  await app.boot(progress);
  app.register('lobby', () => new Lobby(app));
  app.register('slot', () => new SlotScene(app));
  app.register('plinko', () => new PlinkoScene(app));

  new DebugPanel(app);

  // an unfinished slot round or free-spins feature always reopens the slot
  const unfinished = app.session.slot.pending || app.session.slot.fs;
  const start = new URLSearchParams(location.search).get('game');
  app.goto(unfinished ? 'slot' : start === 'slot' || start === 'plinko' ? start : 'lobby');

  bootEl.style.opacity = '0';
  setTimeout(() => bootEl.remove(), 450);

  // handy in the console while developing
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
}

main().catch((e) => {
  console.error(e);
  msg.textContent = `Failed to start: ${(e as Error).message}`;
});
