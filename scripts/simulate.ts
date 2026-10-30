/**
 * Monte-Carlo RTP simulation for both games' math models.
 *   npm run sim            -> 2M base spins
 *   npm run sim -- 500000  -> custom spin count
 */
declare const process: { argv: string[]; exit(code: number): never };
import { playRound } from '../src/games/slot/math/engine';
import { BIG_WIN_TIERS } from '../src/games/slot/math/config';
import { plinkoRtp, RISKS } from '../src/games/plinko/math/engine';

const spins = Number(process.argv[2] ?? 2_000_000);
let seed = 0x1234abcd;
const nextSeed = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);

let wagered = 0;
let returned = 0;
let baseReturned = 0;
let fsReturned = 0;
let hits = 0;
let fsTriggers = 0;
let fsSpinsPlayed = 0;
let maxX = 0;
let longestChain = 0;
const tierHits: Record<string, number> = {};
const t0 = performance.now();

for (let i = 0; i < spins; i++) {
  wagered += 1;
  const base = playRound(nextSeed(), { mode: 'base', fsMultiplier: 1 });
  let roundX = base.totalX;
  baseReturned += base.totalX;
  if (base.totalX > 0) hits++;
  longestChain = Math.max(longestChain, base.steps.length);

  if (base.scatter.freeSpins > 0) {
    fsTriggers++;
    let remaining = base.scatter.freeSpins;
    let mult = 1;
    while (remaining > 0) {
      remaining--;
      fsSpinsPlayed++;
      const fs = playRound(nextSeed(), { mode: 'free', fsMultiplier: mult });
      mult = fs.fsMultiplierEnd;
      remaining += fs.scatter.freeSpins;
      roundX += fs.totalX;
      fsReturned += fs.totalX;
    }
  }
  roundX = Math.min(roundX, 5000);
  returned += roundX;
  maxX = Math.max(maxX, roundX);
  for (const t of BIG_WIN_TIERS) if (roundX >= t.x) tierHits[t.key] = (tierHits[t.key] ?? 0) + 1;
}

const pct = (x: number) => (x * 100).toFixed(2) + '%';
const oneIn = (n: number) => (n ? `1 in ${Math.round(spins / n).toLocaleString()}` : 'never');
console.log(`\nAstral Tumble — ${spins.toLocaleString()} base spins in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  RTP              ${pct(returned / wagered)}  (base ${pct(baseReturned / wagered)}, free spins ${pct(fsReturned / wagered)})`);
console.log(`  hit frequency    ${pct(hits / spins)}`);
console.log(`  free spins       ${oneIn(fsTriggers)}  avg ${(fsSpinsPlayed / Math.max(1, fsTriggers)).toFixed(1)} spins, avg win ${(fsReturned / Math.max(1, fsTriggers)).toFixed(1)}x`);
for (const t of BIG_WIN_TIERS) console.log(`  ${t.key.padEnd(5)} win (${t.x}x+)  ${oneIn(tierHits[t.key] ?? 0)}`);
console.log(`  max win          ${maxX.toFixed(1)}x, longest tumble chain ${longestChain}`);

console.log(`\nPlinko (exact, binomial)`);
for (const r of RISKS) console.log(`  ${r.padEnd(6)} RTP ${pct(plinkoRtp(r))}`);
