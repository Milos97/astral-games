/**
 * Deterministic RNG used by every game's math engine.
 *
 * sfc32 seeded through splitmix32. A round is fully reproducible from its
 * 32-bit seed (plus the mode context it was played in), which is what makes
 * replay, QA "force outcome" and the RTP simulator possible.
 *
 * NOTE: a real RGS would use a certified CSPRNG on the server. The seed
 * itself is drawn from crypto.getRandomValues; this PRNG only expands it.
 */
export interface Rng {
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Index picked from a cumulative weight table (see cumulative()). */
  pick(table: CumulativeTable): number;
}

export interface CumulativeTable {
  readonly cum: Float64Array;
  readonly total: number;
}

export function cumulative(weights: readonly number[]): CumulativeTable {
  const cum = new Float64Array(weights.length);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    cum[i] = acc;
  }
  return { cum, total: acc };
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const splitmix = () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();

  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();

  return {
    seed: seed >>> 0,
    next,
    int: (n) => Math.floor(next() * n),
    pick: (table) => {
      const r = next() * table.total;
      const cum = table.cum;
      for (let i = 0; i < cum.length; i++) if (r < cum[i]) return i;
      return cum.length - 1;
    },
  };
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}
