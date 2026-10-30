import { createRng } from '../../../shared/rng';

/**
 * Plinko math: 12 rows, each peg sends the ball left (0) or right (1) with
 * p = 0.5, so the landing bucket is the number of rights (binomial).
 * Bucket tables are symmetric; RTP is exact and checked by `npm run sim`.
 */
export const PLINKO_ROWS = 12;
export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

const half: Record<Risk, number[]> = {
  // bucket 0..6 (edge -> centre); mirrored for 7..12
  low: [11, 3, 1.6, 1.4, 1.1, 1, 0.4],
  medium: [24, 9, 3.3, 1.7, 1.2, 0.6, 0.4],
  high: [150, 22, 8, 2, 0.7, 0.2, 0.2],
};

export const BUCKETS: Readonly<Record<Risk, readonly number[]>> = Object.fromEntries(
  RISKS.map((r) => [r, [...half[r], ...half[r].slice(0, 6).reverse()]]),
) as Record<Risk, number[]>;

export interface PlinkoMathResult {
  seed: number;
  risk: Risk;
  /** One entry per row: 0 = left, 1 = right. */
  path: number[];
  bucket: number;
  multiplier: number;
}

export function dropBall(seed: number, risk: Risk): PlinkoMathResult {
  const rng = createRng(seed);
  const path: number[] = [];
  for (let i = 0; i < PLINKO_ROWS; i++) path.push(rng.next() < 0.5 ? 0 : 1);
  const bucket = path.reduce((a, b) => a + b, 0);
  return { seed, risk, path, bucket, multiplier: BUCKETS[risk][bucket] };
}

export function plinkoRtp(risk: Risk): number {
  const n = PLINKO_ROWS;
  let c = 1;
  let ev = 0;
  for (let k = 0; k <= n; k++) {
    ev += c * BUCKETS[risk][k];
    c = (c * (n - k)) / (k + 1);
  }
  return ev / 2 ** n;
}
