import { Emitter } from './Emitter';
import type { Api, ErrorCode, FromWorker, Method, NetFault, ToWorker } from '../shared/protocol';

const STORAGE_KEY = 'astral.rgs.v1';
const TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 4;

export class ServerError extends Error {
  constructor(
    readonly code: ErrorCode | 'TIMEOUT',
    message: string,
  ) {
    super(message);
  }
}

export type NetStatus = { kind: 'retrying'; attempt: number; method: Method } | { kind: 'recovered' } | { kind: 'failed' };

/**
 * Typed RPC client for the mock RGS. Network-class failures (simulated
 * errors, lost responses -> timeout) are retried with backoff using the same
 * requestId, so the server's idempotency cache guarantees a bet is only
 * ever taken once.
 */
export class ServerClient extends Emitter<{ net: [NetStatus] }> {
  private worker: Worker;
  private seq = 0;
  private inflight = new Map<number, { resolve: (v: unknown) => void; reject: (e: ServerError) => void }>();
  latency: [number, number] = [120, 320];

  constructor() {
    super();
    this.worker = new Worker(new URL('../server/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      /* storage unavailable or corrupt: start a fresh wallet */
    }
    this.send({ kind: 'boot', state: saved });
  }

  /** Configure simulated latency and arm a one-shot fault for the next request. */
  setNetwork(latency: [number, number], fault: NetFault = 'none') {
    this.latency = latency;
    this.send({ kind: 'net', latency, fault });
  }

  newRequestId(): string {
    return crypto.randomUUID();
  }

  async call<M extends Method>(method: M, params: Api[M]['params']): Promise<Api[M]['result']> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = (await this.once(method, params)) as Api[M]['result'];
        if (attempt > 1) this.emit('net', { kind: 'recovered' });
        return result;
      } catch (e) {
        const err = e as ServerError;
        const retryable = err.code === 'NETWORK' || err.code === 'TIMEOUT';
        if (!retryable) throw err;
        if (attempt >= MAX_ATTEMPTS) {
          this.emit('net', { kind: 'failed' });
          throw err;
        }
        this.emit('net', { kind: 'retrying', attempt, method });
        await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      }
    }
  }

  private once(method: Method, params: unknown): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(id);
        reject(new ServerError('TIMEOUT', `${method} timed out`));
      }, TIMEOUT_MS);
      this.inflight.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ kind: 'req', id, method, params });
    });
  }

  private receive(msg: FromWorker) {
    if (msg.kind === 'persist') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(msg.state));
      } catch {
        /* quota / private mode: the session just won't survive a reload */
      }
      return;
    }
    const p = this.inflight.get(msg.id);
    if (!p) return; // response for a request that already timed out
    this.inflight.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new ServerError(msg.error.code, msg.error.message));
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }
}
