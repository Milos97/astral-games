import type { Container } from 'pixi.js';
import { Emitter } from './Emitter';

const en = {
  balance: 'BALANCE',
  bet: 'BET',
  win: 'WIN',
  totalWin: 'TOTAL WIN',
  spin: 'SPIN',
  turbo: 'TURBO',
  auto: 'AUTO',
  autoplay: 'AUTOPLAY',
  autoplayStop: 'STOP',
  sound: 'SOUND',
  info: 'INFO',
  lobby: 'LOBBY',
  play: 'PLAY',
  close: 'CLOSE',
  replay: 'REPLAY',
  replayOf: 'REPLAY · {id}',
  multiplier: 'MULTIPLIER',
  freeSpins: 'FREE SPINS',
  fsCounter: '{n} OF {total}',
  fsAwarded: '{n} FREE SPINS',
  fsRetrigger: '+{n} FREE SPINS',
  fsSubtitle: 'The multiplier never resets during the feature',
  fsComplete: 'FEATURE COMPLETE',
  tapToContinue: 'Tap to continue',
  big: 'BIG WIN',
  mega: 'MEGA WIN',
  epic: 'EPIC WIN',
  maxWin: 'MAX WIN',
  tagline: '8+ ANYWHERE PAYS',
  taglineSub: 'Every tumble raises the multiplier',
  insufficientFunds: 'Insufficient funds',
  reconnecting: 'Connection problem, retrying ({n})…',
  reconnected: 'Connection restored',
  connectionLost: 'Could not reach the server. Please try again.',
  resumed: 'Resuming your interrupted round',
  resumedFs: 'Resuming free spins',
  session: 'SESSION',
  paytable: 'PAYTABLE',
  rulesTitle: 'HOW TO PLAY',
  rules1: 'Land 8 or more of the same symbol anywhere on the grid to win.',
  rules2: 'Winning symbols explode and new ones tumble in. Each tumble in a spin raises the multiplier: x1, x2, x3, x5, x8, x10.',
  rules3: '4+ portals award 10 free spins. In free spins the multiplier grows by +1 per tumble and never resets. 3+ portals retrigger +5.',
  rules4: 'Maximum win 5,000x bet. Malfunction voids all pays and plays.',
  rtpNote: 'Illustrative math model. Simulated RTP {rtp}.',
  scatterPays: '4 = 3x · 5 = 5x · 6 = 100x  + FREE SPINS',
  plinkoTitle: 'PLINKO',
  slotTitle: 'ASTRAL TUMBLE',
  slotDesc: 'Cascading 6×5 pay-anywhere slot with growing multipliers and free spins.',
  plinkoDesc: 'Drop as many balls as you like. Same framework, different game.',
  risk: 'RISK',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  drop: 'DROP',
  loading: 'Loading {name}…',
} as const;

export type TKey = keyof typeof en;

const es: Record<TKey, string> = {
  balance: 'SALDO',
  bet: 'APUESTA',
  win: 'GANANCIA',
  totalWin: 'GANANCIA TOTAL',
  spin: 'GIRAR',
  turbo: 'TURBO',
  auto: 'AUTO',
  autoplay: 'AUTOJUEGO',
  autoplayStop: 'PARAR',
  sound: 'SONIDO',
  info: 'INFO',
  lobby: 'LOBBY',
  play: 'JUGAR',
  close: 'CERRAR',
  replay: 'REPETICIÓN',
  replayOf: 'REPETICIÓN · {id}',
  multiplier: 'MULTIPLICADOR',
  freeSpins: 'GIROS GRATIS',
  fsCounter: '{n} DE {total}',
  fsAwarded: '{n} GIROS GRATIS',
  fsRetrigger: '+{n} GIROS GRATIS',
  fsSubtitle: 'El multiplicador nunca se reinicia durante la función',
  fsComplete: 'FUNCIÓN COMPLETADA',
  tapToContinue: 'Toca para continuar',
  big: 'GRAN PREMIO',
  mega: 'MEGA PREMIO',
  epic: 'PREMIO ÉPICO',
  maxWin: 'PREMIO MÁXIMO',
  tagline: '8+ PAGAN EN CUALQUIER LUGAR',
  taglineSub: 'Cada cascada sube el multiplicador',
  insufficientFunds: 'Saldo insuficiente',
  reconnecting: 'Problema de conexión, reintentando ({n})…',
  reconnected: 'Conexión restablecida',
  connectionLost: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
  resumed: 'Reanudando tu ronda interrumpida',
  resumedFs: 'Reanudando giros gratis',
  session: 'SESIÓN',
  paytable: 'TABLA DE PAGOS',
  rulesTitle: 'CÓMO JUGAR',
  rules1: 'Consigue 8 o más del mismo símbolo en cualquier lugar para ganar.',
  rules2: 'Los símbolos ganadores explotan y caen otros nuevos. Cada cascada sube el multiplicador: x1, x2, x3, x5, x8, x10.',
  rules3: '4+ portales otorgan 10 giros gratis. En giros gratis el multiplicador sube +1 por cascada y nunca se reinicia. 3+ portales dan +5.',
  rules4: 'Premio máximo 5.000x la apuesta. Un mal funcionamiento anula todos los pagos.',
  rtpNote: 'Modelo matemático ilustrativo. RTP simulado {rtp}.',
  scatterPays: '4 = 3x · 5 = 5x · 6 = 100x  + GIROS GRATIS',
  plinkoTitle: 'PLINKO',
  slotTitle: 'ASTRAL TUMBLE',
  slotDesc: 'Tragaperras 6×5 en cascada con multiplicadores y giros gratis.',
  plinkoDesc: 'Lanza tantas bolas como quieras. Mismo framework, otro juego.',
  risk: 'RIESGO',
  low: 'BAJO',
  medium: 'MEDIO',
  high: 'ALTO',
  drop: 'LANZAR',
  loading: 'Cargando {name}…',
};

const dicts = { en, es } as const;
export type Locale = keyof typeof dicts;
export const LOCALES = Object.keys(dicts) as Locale[];

class I18n extends Emitter<{ change: [Locale] }> {
  locale: Locale = 'en';
  currency = 'EUR';
  private money = this.makeMoney();

  set(locale: Locale) {
    if (locale === this.locale) return;
    this.locale = locale;
    this.money = this.makeMoney();
    this.emit('change', locale);
  }

  t(key: TKey, vars?: Record<string, string | number>): string {
    let s: string = dicts[this.locale][key] ?? en[key];
    if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]));
    return s;
  }

  /** Integer cents -> localised currency string. */
  fmt(cents: number): string {
    return this.money.format(cents / 100);
  }

  private makeMoney() {
    return new Intl.NumberFormat(this.locale === 'es' ? 'es-ES' : 'en-IE', {
      style: 'currency',
      currency: this.currency,
    });
  }
}

export const i18n = new I18n();
export const t = (key: TKey, vars?: Record<string, string | number>) => i18n.t(key, vars);

/** Re-run `fn` on locale change for as long as `owner` is alive. */
export function onLocale(owner: Container, fn: () => void) {
  const off = i18n.on('change', fn);
  owner.once('destroyed', off);
}
