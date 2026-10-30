/**
 * Wire protocol between the game client (main thread) and the mock RGS
 * (remote game server) running in a Web Worker. Everything that crosses the
 * boundary is plain JSON, exactly as it would be over HTTP.
 */
import type { SlotMathResult, SlotMode } from '../games/slot/math/engine';
import type { PlinkoMathResult, Risk } from '../games/plinko/math/engine';

/** Amounts are integer cents everywhere. */
export type Cents = number;

export type SlotForce = 'noWin' | 'win' | 'big' | 'mega' | 'epic' | 'freeSpins' | 'longCascade';
export type PlinkoForce = 'edge' | 'centre';

export interface FsState {
  remaining: number;
  total: number;
  multiplier: number;
  totalWin: Cents;
  bet: Cents;
}

export interface SlotRound extends SlotMathResult {
  roundId: string;
  bet: Cents;
  win: Cents;
  balanceBefore: Cents;
  balanceAfter: Cents;
  fsBefore: FsState | null;
  fsAfter: FsState | null;
  /** True on the last free spin of a feature. */
  fsEnded: boolean;
  replay?: boolean;
}

export interface PlinkoRound extends PlinkoMathResult {
  roundId: string;
  bet: Cents;
  win: Cents;
  balanceAfter: Cents;
}

export interface HistoryEntry {
  roundId: string;
  game: 'slot' | 'plinko';
  seed: number;
  mode: SlotMode | Risk;
  fsMultiplier: number;
  bet: Cents;
  win: Cents;
  time: number;
}

export interface SessionInfo {
  balance: Cents;
  currency: string;
  betLevels: Cents[];
  slot: { fs: FsState | null; pending: SlotRound | null };
  history: HistoryEntry[];
}

export interface Api {
  'session.init': { params: Record<string, never>; result: SessionInfo };
  'slot.spin': { params: { bet: Cents; requestId: string; force?: SlotForce }; result: SlotRound };
  'slot.ack': { params: { roundId: string }; result: { balance: Cents } };
  'slot.replay': { params: { roundId: string }; result: SlotRound };
  'plinko.drop': {
    params: { bet: Cents; risk: Risk; requestId: string; force?: PlinkoForce };
    result: PlinkoRound;
  };
  'wallet.set': { params: { balance: Cents }; result: { balance: Cents } };
  'wallet.reset': { params: Record<string, never>; result: SessionInfo };
}
export type Method = keyof Api;

export type NetFault = 'none' | 'error' | 'lost';

export type ToWorker =
  | { kind: 'boot'; state: unknown }
  | { kind: 'req'; id: number; method: Method; params: unknown }
  | { kind: 'net'; latency: [number, number]; fault: NetFault };

export type ErrorCode = 'INSUFFICIENT_FUNDS' | 'BAD_REQUEST' | 'NETWORK' | 'NOT_FOUND';

export type FromWorker =
  | { kind: 'res'; id: number; ok: true; result: unknown }
  | { kind: 'res'; id: number; ok: false; error: { code: ErrorCode; message: string } }
  | { kind: 'persist'; state: unknown };
