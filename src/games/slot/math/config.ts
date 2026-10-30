/**
 * Astral Tumble math model.
 *
 * 6x5 "pay anywhere" grid: 8+ of the same symbol anywhere on the grid pays.
 * Winning symbols are removed, the rest fall down and new symbols drop in
 * (tumble). Each tumble in a spin raises the multiplier. 4+ scatters award
 * free spins, where the multiplier persists for the whole feature.
 *
 * Illustrative math only: tuned with `npm run sim`, not certified.
 */
export const COLS = 6;
export const ROWS = 5;

export interface SymbolDef {
  id: number;
  key: string;
  /** Pays as multiples of the total bet for counts [8-9, 10-11, 12+]. */
  pays: readonly [number, number, number];
  scatter?: boolean;
}

export const SYMBOLS: readonly SymbolDef[] = [
  { id: 0, key: 'aqua', pays: [0.25, 0.75, 2] },
  { id: 1, key: 'verde', pays: [0.4, 0.9, 4] },
  { id: 2, key: 'violet', pays: [0.5, 1, 5] },
  { id: 3, key: 'ember', pays: [0.8, 1.2, 8] },
  { id: 4, key: 'planet', pays: [1, 1.5, 10] },
  { id: 5, key: 'comet', pays: [1.5, 2, 12] },
  { id: 6, key: 'star', pays: [2, 5, 15] },
  { id: 7, key: 'crown', pays: [10, 25, 50] },
  { id: 8, key: 'portal', pays: [0, 0, 0], scatter: true },
];

export const SCATTER = 8;
export const MIN_CLUSTER = 8;
export const PAY_TIERS = [8, 10, 12] as const;

/** Scatter pays (multiples of bet), counted once on the final grid. */
export const SCATTER_PAYS: Readonly<Record<number, number>> = { 4: 3, 5: 5, 6: 100 };
export const FS_TRIGGER = 4;
export const FS_AWARD = 10;
export const FS_RETRIGGER = 3;
export const FS_RETRIGGER_AWARD = 5;

/** Base game: multiplier per tumble index within a single spin. */
export const BASE_LADDER = [1, 2, 3, 5, 8, 10] as const;
/** Free spins: multiplier grows by this per winning tumble and never resets. */
export const FS_MULT_STEP = 1;

export const WEIGHTS_BASE = [16, 15.5, 15, 14.5, 13, 11.5, 9.5, 6, 2] as const;
export const WEIGHTS_FREE = [24, 20, 17, 15, 12, 9.5, 7.5, 3.8, 1.2] as const;

export const MAX_WIN_X = 5000;

export const BIG_WIN_TIERS = [
  { key: 'big', x: 15 },
  { key: 'mega', x: 40 },
  { key: 'epic', x: 100 },
] as const;
export type BigWinTier = (typeof BIG_WIN_TIERS)[number]['key'];

export function bigWinTier(winX: number): BigWinTier | null {
  let tier: BigWinTier | null = null;
  for (const t of BIG_WIN_TIERS) if (winX >= t.x) tier = t.key;
  return tier;
}

export function payFor(symbol: number, count: number): number {
  const def = SYMBOLS[symbol];
  if (count >= PAY_TIERS[2]) return def.pays[2];
  if (count >= PAY_TIERS[1]) return def.pays[1];
  if (count >= PAY_TIERS[0]) return def.pays[0];
  return 0;
}

/** Result of `npm run sim` (2M spins) for the weights above. Shown in the paytable. */
export const SIMULATED_RTP = 0.9714;
