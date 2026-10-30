/**
 * Mock RGS. Owns the wallet, the RNG and all game state. The client only
 * ever receives finished results and presents them.
 *
 * Behaves like a real server in the ways that matter to a client:
 *  - latency, injectable network faults (error / lost response)
 *  - idempotent requests: a retried requestId returns the cached result
 *    instead of debiting twice
 *  - unacknowledged rounds and free-spin sessions survive a reload
 *
 * Persistence is faked: state snapshots are posted to the main thread,
 * which keeps them in localStorage.
 */
import { playRound, type SlotMathResult } from '../games/slot/math/engine';
import { BIG_WIN_TIERS } from '../games/slot/math/config';
import { dropBall, RISKS, type PlinkoMathResult } from '../games/plinko/math/engine';
import { randomSeed } from '../shared/rng';
import type {
  Api,
  ErrorCode,
  FromWorker,
  FsState,
  HistoryEntry,
  Method,
  NetFault,
  PlinkoForce,
  SessionInfo,
  SlotForce,
  SlotRound,
  ToWorker,
} from '../shared/protocol';

const START_BALANCE = 100_000;
const BET_LEVELS = [20, 40, 100, 200, 500, 1000, 2000, 5000, 10000];

interface State {
  balance: number;
  nonce: number;
  fs: FsState | null;
  pending: SlotRound | null;
  history: HistoryEntry[];
  responses: { requestId: string; result: unknown }[];
}

const fresh = (): State => ({ balance: START_BALANCE, nonce: 0, fs: null, pending: null, history: [], responses: [] });

let state: State = fresh();
let latency: [number, number] = [120, 320];
let fault: NetFault = 'none';

class RgsError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);
const persist = () => post({ kind: 'persist', state });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextRoundId = () => `R${Date.now().toString(36)}-${(++state.nonce).toString(36)}`.toUpperCase();

function remember(requestId: string, result: unknown) {
  state.responses.push({ requestId, result });
  if (state.responses.length > 20) state.responses.shift();
}
const recall = (requestId: string) => state.responses.find((r) => r.requestId === requestId)?.result;

function record(entry: HistoryEntry) {
  state.history.unshift(entry);
  if (state.history.length > 50) state.history.pop();
}

/** QA tool: search seeds until the math engine itself produces the asked-for outcome. */
function searchSeed<T>(play: (seed: number) => T, accept: (r: T) => boolean, score: (r: T) => number): T {
  const deadline = performance.now() + 2500;
  let best: T | null = null;
  let bestScore = -Infinity;
  for (let i = 0; performance.now() < deadline || i < 1000; i++) {
    const r = play(randomSeed());
    if (accept(r)) return r;
    const s = score(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best!;
}

const tierRange = (key: string): [number, number] => {
  const i = BIG_WIN_TIERS.findIndex((t) => t.key === key);
  return [BIG_WIN_TIERS[i].x, BIG_WIN_TIERS[i + 1]?.x ?? Infinity];
};

function slotPredicate(force: SlotForce): (r: SlotMathResult) => boolean {
  switch (force) {
    case 'noWin':
      return (r) => r.totalX === 0 && r.scatter.freeSpins === 0;
    case 'win':
      return (r) => r.totalX > 0 && r.totalX < BIG_WIN_TIERS[0].x && r.scatter.freeSpins === 0;
    case 'freeSpins':
      return (r) => r.scatter.freeSpins > 0;
    case 'longCascade':
      return (r) => r.steps.length >= 5;
    default: {
      const [lo, hi] = tierRange(force);
      return (r) => r.totalX >= lo && r.totalX < hi;
    }
  }
}

function slotSpin(p: Api['slot.spin']['params']): SlotRound {
  const fsBefore = state.fs ? { ...state.fs } : null;
  const mode = fsBefore ? 'free' : 'base';
  const bet = fsBefore ? fsBefore.bet : p.bet;

  if (!fsBefore) {
    if (!BET_LEVELS.includes(bet)) throw new RgsError('BAD_REQUEST', `Invalid bet ${bet}`);
    if (state.balance < bet) throw new RgsError('INSUFFICIENT_FUNDS', 'Insufficient funds');
  }

  const ctx = { mode, fsMultiplier: fsBefore?.multiplier ?? 1 } as const;
  const play = (seed: number) => playRound(seed, ctx);
  const math = p.force
    ? searchSeed(play, slotPredicate(p.force), (r) => r.totalX + r.scatter.freeSpins * 10 + r.steps.length)
    : play(randomSeed());

  const win = Math.round(math.totalX * bet);
  const balanceBefore = state.balance;
  if (!fsBefore) state.balance -= bet;
  state.balance += win;

  let fsAfter: FsState | null = null;
  let fsEnded = false;
  if (fsBefore) {
    fsAfter = {
      ...fsBefore,
      remaining: fsBefore.remaining - 1 + math.scatter.freeSpins,
      total: fsBefore.total + math.scatter.freeSpins,
      multiplier: math.fsMultiplierEnd,
      totalWin: fsBefore.totalWin + win,
    };
    fsEnded = fsAfter.remaining <= 0;
  } else if (math.scatter.freeSpins > 0) {
    fsAfter = { remaining: math.scatter.freeSpins, total: math.scatter.freeSpins, multiplier: 1, totalWin: 0, bet };
  }
  state.fs = fsEnded ? null : fsAfter;

  const round: SlotRound = {
    ...math,
    roundId: nextRoundId(),
    bet,
    win,
    balanceBefore,
    balanceAfter: state.balance,
    fsBefore,
    fsAfter,
    fsEnded,
  };
  state.pending = round;
  record({
    roundId: round.roundId,
    game: 'slot',
    seed: math.seed,
    mode,
    fsMultiplier: ctx.fsMultiplier,
    bet,
    win,
    time: Date.now(),
  });
  return round;
}

function slotReplay(roundId: string): SlotRound {
  const h = state.history.find((e) => e.roundId === roundId && e.game === 'slot');
  if (!h) throw new RgsError('NOT_FOUND', `Round ${roundId} not in history`);
  const mode = h.mode === 'free' ? 'free' : 'base';
  const math = playRound(h.seed, { mode, fsMultiplier: h.fsMultiplier });
  return {
    ...math,
    roundId: h.roundId,
    bet: h.bet,
    win: h.win,
    balanceBefore: state.balance,
    balanceAfter: state.balance,
    fsBefore: null,
    fsAfter: null,
    fsEnded: false,
    replay: true,
  };
}

function plinkoDrop(p: Api['plinko.drop']['params']) {
  if (!BET_LEVELS.includes(p.bet)) throw new RgsError('BAD_REQUEST', `Invalid bet ${p.bet}`);
  if (!RISKS.includes(p.risk)) throw new RgsError('BAD_REQUEST', `Invalid risk ${p.risk}`);
  if (state.balance < p.bet) throw new RgsError('INSUFFICIENT_FUNDS', 'Insufficient funds');

  const play = (seed: number) => dropBall(seed, p.risk);
  const accept: Record<PlinkoForce, (r: PlinkoMathResult) => boolean> = {
    edge: (r) => r.bucket === 0 || r.bucket === 12,
    centre: (r) => r.bucket === 6,
  };
  const math = p.force ? searchSeed(play, accept[p.force], (r) => r.multiplier) : play(randomSeed());
  const win = Math.round(math.multiplier * p.bet);
  state.balance += win - p.bet;
  const round = { ...math, roundId: nextRoundId(), bet: p.bet, win, balanceAfter: state.balance };
  record({
    roundId: round.roundId,
    game: 'plinko',
    seed: math.seed,
    mode: p.risk,
    fsMultiplier: 1,
    bet: p.bet,
    win,
    time: Date.now(),
  });
  return round;
}

function sessionInfo(): SessionInfo {
  return {
    balance: state.balance,
    currency: 'EUR',
    betLevels: BET_LEVELS,
    slot: { fs: state.fs, pending: state.pending },
    history: state.history,
  };
}

type Handler<M extends Method> = (params: Api[M]['params']) => Api[M]['result'];
const handlers: { [M in Method]: Handler<M> } = {
  'session.init': () => sessionInfo(),
  'slot.spin': (p) => slotSpin(p),
  'slot.ack': (p) => {
    if (state.pending?.roundId === p.roundId) state.pending = null;
    return { balance: state.balance };
  },
  'slot.replay': (p) => slotReplay(p.roundId),
  'plinko.drop': (p) => plinkoDrop(p),
  'wallet.set': (p) => {
    state.balance = Math.max(0, Math.round(p.balance));
    return { balance: state.balance };
  },
  'wallet.reset': () => {
    state = fresh();
    return sessionInfo();
  },
};

async function handle(id: number, method: Method, params: unknown) {
  await sleep(latency[0] + Math.random() * (latency[1] - latency[0]));
  const f = fault;
  fault = 'none';
  if (f === 'error') {
    post({ kind: 'res', id, ok: false, error: { code: 'NETWORK', message: 'Simulated network error' } });
    return;
  }

  const requestId = (params as { requestId?: string }).requestId;
  try {
    let result = requestId ? recall(requestId) : undefined;
    if (result === undefined) {
      result = (handlers[method] as Handler<Method>)(params as never);
      if (requestId) remember(requestId, result);
      persist();
    }
    if (f === 'lost') return; // processed (and debited!) but the response never arrives
    post({ kind: 'res', id, ok: true, result });
  } catch (e) {
    const err = e instanceof RgsError ? e : new RgsError('BAD_REQUEST', String(e));
    post({ kind: 'res', id, ok: false, error: { code: err.code, message: err.message } });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.kind === 'boot') {
    if (msg.state && typeof msg.state === 'object') state = { ...fresh(), ...(msg.state as Partial<State>) };
  } else if (msg.kind === 'net') {
    latency = msg.latency;
    fault = msg.fault;
  } else {
    void handle(msg.id, msg.method, msg.params);
  }
};
