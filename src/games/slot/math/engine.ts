import { createRng, cumulative, type Rng } from '../../../shared/rng';
import {
  BASE_LADDER,
  COLS,
  FS_AWARD,
  FS_MULT_STEP,
  FS_RETRIGGER,
  FS_RETRIGGER_AWARD,
  FS_TRIGGER,
  MAX_WIN_X,
  MIN_CLUSTER,
  ROWS,
  SCATTER,
  SCATTER_PAYS,
  SYMBOLS,
  WEIGHTS_BASE,
  WEIGHTS_FREE,
  payFor,
} from './config';

/** grid[col][row], row 0 is the top. */
export type Grid = number[][];
export type Cell = readonly [col: number, row: number];

export type SlotMode = 'base' | 'free';

export interface RoundContext {
  mode: SlotMode;
  /** Persistent free-spins multiplier going into this round (free mode only). */
  fsMultiplier: number;
}

export interface SymbolWin {
  symbol: number;
  count: number;
  positions: Cell[];
  payX: number;
}

export interface TumbleStep {
  wins: SymbolWin[];
  multiplier: number;
  /** Sum of symbol pays x multiplier, in multiples of bet. */
  winX: number;
  removed: Cell[];
  /** Per column, the new symbols that drop in from the top (top to bottom). */
  refill: number[][];
  gridAfter: Grid;
}

export interface ScatterResult {
  count: number;
  positions: Cell[];
  payX: number;
  freeSpins: number;
}

export interface SlotMathResult {
  seed: number;
  mode: SlotMode;
  fsMultiplierStart: number;
  fsMultiplierEnd: number;
  grid: Grid;
  steps: TumbleStep[];
  scatter: ScatterResult;
  totalX: number;
  capped: boolean;
}

const TABLE_BASE = cumulative(WEIGHTS_BASE);
const TABLE_FREE = cumulative(WEIGHTS_FREE);

export function evaluate(grid: Grid): SymbolWin[] {
  const buckets: Cell[][] = SYMBOLS.map(() => []);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) buckets[grid[c][r]].push([c, r]);
  }
  const wins: SymbolWin[] = [];
  for (let s = 0; s < buckets.length; s++) {
    if (s === SCATTER) continue;
    const positions = buckets[s];
    if (positions.length >= MIN_CLUSTER) {
      wins.push({ symbol: s, count: positions.length, positions, payX: payFor(s, positions.length) });
    }
  }
  return wins;
}

export function scatterPositions(grid: Grid): Cell[] {
  const out: Cell[] = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (grid[c][r] === SCATTER) out.push([c, r]);
  return out;
}

/**
 * Applies a tumble: removes cells, compacts each column downwards and drops
 * `refill` in on top. Shared by the engine and the client so the client can
 * verify that its visual state matches the server's.
 */
export function applyTumble(grid: Grid, removed: readonly Cell[], refill: readonly number[][]): Grid {
  const gone = new Set(removed.map(([c, r]) => c * ROWS + r));
  return grid.map((col, c) => {
    const kept = col.filter((_, r) => !gone.has(c * ROWS + r));
    return [...refill[c], ...kept];
  });
}

function drawGrid(rng: Rng, mode: SlotMode): Grid {
  const table = mode === 'free' ? TABLE_FREE : TABLE_BASE;
  const grid: Grid = [];
  for (let c = 0; c < COLS; c++) {
    const col: number[] = [];
    for (let r = 0; r < ROWS; r++) col.push(rng.pick(table));
    grid.push(col);
  }
  return grid;
}

export function playRound(seed: number, ctx: RoundContext): SlotMathResult {
  const rng = createRng(seed);
  const table = ctx.mode === 'free' ? TABLE_FREE : TABLE_BASE;
  const initial = drawGrid(rng, ctx.mode);

  let grid = initial;
  let totalX = 0;
  let capped = false;
  let fsMult = ctx.mode === 'free' ? ctx.fsMultiplier : 1;
  const steps: TumbleStep[] = [];

  for (let i = 0; i < 64; i++) {
    const wins = evaluate(grid);
    if (wins.length === 0) break;

    const multiplier = ctx.mode === 'free' ? fsMult : BASE_LADDER[Math.min(i, BASE_LADDER.length - 1)];
    const baseX = wins.reduce((a, w) => a + w.payX, 0);
    const removed = wins.flatMap((w) => w.positions);

    const gone = new Set(removed.map(([c, r]) => c * ROWS + r));
    const refill: number[][] = [];
    for (let c = 0; c < COLS; c++) {
      let n = 0;
      for (let r = 0; r < ROWS; r++) if (gone.has(c * ROWS + r)) n++;
      const fresh: number[] = [];
      for (let k = 0; k < n; k++) fresh.push(rng.pick(table));
      refill.push(fresh);
    }
    const gridAfter = applyTumble(grid, removed, refill);

    const winX = round2(baseX * multiplier);
    steps.push({ wins, multiplier, winX, removed, refill, gridAfter });
    totalX += winX;
    grid = gridAfter;
    if (ctx.mode === 'free') fsMult += FS_MULT_STEP;

    if (totalX >= MAX_WIN_X) {
      capped = true;
      break;
    }
  }

  const positions = scatterPositions(grid);
  const count = positions.length;
  const payX = SCATTER_PAYS[Math.min(count, 6)] ?? 0;
  const freeSpins =
    ctx.mode === 'base' ? (count >= FS_TRIGGER ? FS_AWARD : 0) : count >= FS_RETRIGGER ? FS_RETRIGGER_AWARD : 0;
  totalX += payX;

  if (totalX >= MAX_WIN_X) {
    totalX = MAX_WIN_X;
    capped = true;
  }

  return {
    seed,
    mode: ctx.mode,
    fsMultiplierStart: ctx.mode === 'free' ? ctx.fsMultiplier : 1,
    fsMultiplierEnd: fsMult,
    grid: initial,
    steps,
    scatter: { count, positions, payX, freeSpins },
    totalX: round2(totalX),
    capped,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
