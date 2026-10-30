import type { Locale } from './i18n';
import type { Risk } from '../games/plinko/math/engine';

export interface Prefs {
  betIndex: number;
  sound: boolean;
  turbo: boolean;
  locale: Locale;
  quality: 'high' | 'low';
  risk: Risk;
}

const KEY = 'astral.prefs.v1';
const defaults: Prefs = { betIndex: 2, sound: true, turbo: false, locale: 'en', quality: 'high', risk: 'medium' };

/** Per-player client preferences (never game state — that lives on the server). */
export const prefs: Prefs = (() => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
})();

export function savePrefs(patch: Partial<Prefs>) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
