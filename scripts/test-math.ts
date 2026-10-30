/**
 * Invariant tests for the math engines. Run with `npm test`.
 * Every check here is something the client relies on when it animates a
 * round, so a failure means the presentation could desync from the result.
 */
declare const process: { argv: string[]; exit(code: number): never };
import { applyTumble, evaluate, playRound, scatterPositions } from '../src/games/slot/math/engine';
import { COLS, MAX_WIN_X, ROWS } from '../src/games/slot/math/config';
import { BUCKETS, dropBall, PLINKO_ROWS, plinkoRtp, RISKS } from '../src/games/plinko/math/engine';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    if (failures < 20) console.error('FAIL', msg);
  }
};

const N = 50_000;
for (let i = 0; i < N; i++) {
  const seed = (i * 2654435761) >>> 0;
  const mode = i % 4 === 0 ? 'free' : 'base';
  const ctx = { mode, fsMultiplier: 1 + (i % 7) } as const;
  const a = playRound(seed, ctx);
  const b = playRound(seed, ctx);
  check(JSON.stringify(a) === JSON.stringify(b), `determinism seed=${seed}`);

  check(a.grid.length === COLS && a.grid.every((c) => c.length === ROWS), 'grid shape');
  let grid = a.grid;
  let sum = 0;
  for (const step of a.steps) {
    check(JSON.stringify(evaluate(grid)) === JSON.stringify(step.wins), `step wins match evaluate seed=${seed}`);
    const removedPerCol = Array.from({ length: COLS }, () => 0);
    for (const [c] of step.removed) removedPerCol[c]++;
    check(step.refill.every((col, c) => col.length === removedPerCol[c]), 'refill count = removed count');
    const after = applyTumble(grid, step.removed, step.refill);
    check(JSON.stringify(after) === JSON.stringify(step.gridAfter), `applyTumble matches gridAfter seed=${seed}`);
    grid = step.gridAfter;
    sum += step.winX;
  }
  if (!a.capped) {
    check(evaluate(grid).length === 0, 'final grid has no remaining wins');
    check(Math.abs(sum + a.scatter.payX - a.totalX) < 0.011, `total = steps + scatter seed=${seed}`);
  }
  check(a.totalX <= MAX_WIN_X, 'max win cap');
  check(scatterPositions(grid).length === a.scatter.count, 'scatter count on final grid');
  if (mode === 'free') check(a.fsMultiplierEnd === ctx.fsMultiplier + a.steps.length, 'fs multiplier progression');
}

for (let i = 0; i < 10_000; i++) {
  const r = dropBall(i, RISKS[i % 3]);
  check(r.path.length === PLINKO_ROWS, 'plinko path length');
  check(r.bucket === r.path.filter((x) => x === 1).length, 'plinko bucket = rights');
  check(r.multiplier === BUCKETS[r.risk][r.bucket], 'plinko multiplier lookup');
}
for (const r of RISKS) {
  const b = BUCKETS[r];
  check(b.length === PLINKO_ROWS + 1 && b.every((x, k) => x === b[PLINKO_ROWS - k]), `plinko ${r} symmetric`);
  check(plinkoRtp(r) > 0.95 && plinkoRtp(r) < 0.98, `plinko ${r} rtp in range`);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`ok — ${N} slot rounds and 10000 plinko drops verified`);
