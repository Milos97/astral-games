/**
 * Gamification engine: XP, levels, missions and loyalty stars.
 *
 * It sits *on top of* the games. It only consumes settled-round events from
 * the event bus and never reads or changes the wallet, the RNG or the game
 * math, so it cannot affect RTP or odds. Pure and deterministic: the same
 * event stream always produces the same state, which is what the tests check.
 *
 * Responsible-design choices:
 *  - XP is per paid round, not per euro staked, so raising the bet never
 *    levels you up faster.
 *  - No mission requires a minimum bet.
 */

export type GameId = 'slot' | 'plinko';

/** One settled paid round, as published by the RGS. */
export interface RoundEvent {
  type: 'round';
  /** Monotonic per player; lets consumers detect gaps and duplicates. */
  seq: number;
  roundId: string;
  game: GameId;
  bet: number;
  win: number;
  /** 'base' | 'free' for the slot, the risk level for Plinko. */
  mode: string;
  tumbles: number;
  freeSpinsAwarded: number;
  time: number;
}

export type Metric = 'rounds' | 'winCents' | 'games';

export interface MissionDef {
  id: string;
  /** i18n key; `{n}` is replaced with `target` (shown in euros for winCents). */
  text: string;
  metric: Metric;
  target: number;
  filter: {
    game?: GameId;
    /** Only paid rounds (excludes free spins). */
    paid?: boolean;
    mode?: string;
    minX?: number;
    minTumbles?: number;
    freeSpins?: boolean;
  };
  reward: { xp: number; stars: number };
}

export interface GamiConfig {
  xpPerRound: number;
  activeMissions: number;
  /** XP needed to go from `level` to `level + 1`. */
  xpToNext(level: number): number;
  levelReward(level: number): number;
  pool: MissionDef[];
}

export const CONFIG: GamiConfig = {
  xpPerRound: 10,
  activeMissions: 3,
  xpToNext: (level) => 100 + 60 * (level - 1),
  levelReward: (level) => 10 * level,
  pool: [
    { id: 'spins10', text: 'mSpins', metric: 'rounds', target: 10, filter: { game: 'slot', paid: true }, reward: { xp: 60, stars: 10 } },
    { id: 'both', text: 'mBoth', metric: 'games', target: 2, filter: {}, reward: { xp: 80, stars: 15 } },
    { id: 'win10x', text: 'mWinX', metric: 'rounds', target: 1, filter: { minX: 10 }, reward: { xp: 200, stars: 40 } },
    { id: 'plinko30', text: 'mDrops', metric: 'rounds', target: 30, filter: { game: 'plinko' }, reward: { xp: 120, stars: 20 } },
    { id: 'cascade4', text: 'mTumbles', metric: 'rounds', target: 3, filter: { game: 'slot', minTumbles: 4 }, reward: { xp: 180, stars: 30 } },
    { id: 'fs', text: 'mFreeSpins', metric: 'rounds', target: 1, filter: { game: 'slot', freeSpins: true, paid: true }, reward: { xp: 400, stars: 60 } },
    { id: 'win50', text: 'mWinSum', metric: 'winCents', target: 5000, filter: {}, reward: { xp: 200, stars: 30 } },
    { id: 'plinkoHigh', text: 'mPlinkoHigh', metric: 'rounds', target: 2, filter: { game: 'plinko', mode: 'high', minX: 5 }, reward: { xp: 250, stars: 40 } },
    { id: 'spins50', text: 'mSpins', metric: 'rounds', target: 50, filter: { game: 'slot', paid: true }, reward: { xp: 250, stars: 40 } },
  ],
};

export interface MissionState {
  id: string;
  progress: number;
  /** Distinct games seen, for the 'games' metric. */
  seen: GameId[];
}

export interface GamiState {
  level: number;
  /** XP into the current level. */
  xp: number;
  totalXp: number;
  stars: number;
  missions: MissionState[];
  /** Next pool index to draw from. */
  cursor: number;
  completed: number;
  lastSeq: number;
}

/** What the client renders. Self-contained: no config lookup needed. */
export interface MissionView {
  id: string;
  text: string;
  metric: Metric;
  target: number;
  progress: number;
  reward: { xp: number; stars: number };
}

export interface GamiView {
  level: number;
  xp: number;
  xpToNext: number;
  stars: number;
  completed: number;
  missions: MissionView[];
}

export interface MissionChange {
  slot: number;
  before: MissionView;
  after: MissionView;
  completed: boolean;
  /** The mission that replaced a completed one in the same slot. */
  next?: MissionView;
}

export interface GamiUpdate {
  roundId: string;
  seq: number;
  xpGained: number;
  starsGained: number;
  levelUps: number[];
  missions: MissionChange[];
  view: GamiView;
}

export function initialState(config = CONFIG): GamiState {
  const s: GamiState = { level: 1, xp: 0, totalXp: 0, stars: 0, missions: [], cursor: 0, completed: 0, lastSeq: 0 };
  while (s.missions.length < config.activeMissions) s.missions.push(draw(s, config));
  return s;
}

function draw(s: GamiState, config: GamiConfig): MissionState {
  const def = config.pool[s.cursor % config.pool.length];
  s.cursor++;
  return { id: def.id, progress: 0, seen: [] };
}

const defOf = (id: string, config: GamiConfig) => config.pool.find((d) => d.id === id)!;

export function missionView(m: MissionState, config = CONFIG): MissionView {
  const d = defOf(m.id, config);
  return { id: d.id, text: d.text, metric: d.metric, target: d.target, progress: m.progress, reward: d.reward };
}

export function view(s: GamiState, config = CONFIG): GamiView {
  return {
    level: s.level,
    xp: s.xp,
    xpToNext: config.xpToNext(s.level),
    stars: s.stars,
    completed: s.completed,
    missions: s.missions.map((m) => missionView(m, config)),
  };
}

function matches(d: MissionDef, e: RoundEvent): boolean {
  const f = d.filter;
  const x = e.bet > 0 ? e.win / e.bet : 0;
  if (f.game && f.game !== e.game) return false;
  if (f.paid && e.mode === 'free') return false;
  if (f.mode && f.mode !== e.mode) return false;
  if (f.minX && x < f.minX) return false;
  if (f.minTumbles && e.tumbles < f.minTumbles) return false;
  if (f.freeSpins && e.freeSpinsAwarded === 0) return false;
  return true;
}

function addXp(s: GamiState, xp: number, config: GamiConfig, levelUps: number[]): number {
  let stars = 0;
  s.xp += xp;
  s.totalXp += xp;
  while (s.xp >= config.xpToNext(s.level)) {
    s.xp -= config.xpToNext(s.level);
    s.level++;
    levelUps.push(s.level);
    stars += config.levelReward(s.level);
  }
  return stars;
}

/**
 * Apply one event. Returns the new state (the input is not mutated) and an
 * update describing what changed, for the client to animate. Events at or
 * below `lastSeq` are duplicates and change nothing.
 */
export function applyEvent(prev: GamiState, e: RoundEvent, config = CONFIG): { state: GamiState; update: GamiUpdate | null } {
  if (e.seq <= prev.lastSeq) return { state: prev, update: null };
  const s: GamiState = structuredClone(prev);
  s.lastSeq = e.seq;
  const levelUps: number[] = [];
  let xp = e.mode === 'free' ? 0 : config.xpPerRound;
  let stars = 0;
  const changes: MissionChange[] = [];

  s.missions.forEach((m, slot) => {
    const d = defOf(m.id, config);
    if (!matches(d, e)) return;
    const before = missionView(m, config);
    if (d.metric === 'rounds') m.progress++;
    else if (d.metric === 'winCents') m.progress += e.win;
    else if (!m.seen.includes(e.game)) {
      m.seen.push(e.game);
      m.progress = m.seen.length;
    }
    if (m.progress === before.progress) return;
    m.progress = Math.min(m.progress, d.target);
    const completed = m.progress >= d.target;
    const change: MissionChange = { slot, before, after: missionView(m, config), completed };
    if (completed) {
      xp += d.reward.xp;
      stars += d.reward.stars;
      s.completed++;
      s.missions[slot] = draw(s, config);
      change.next = missionView(s.missions[slot], config);
    }
    changes.push(change);
  });

  stars += addXp(s, xp, config, levelUps);
  s.stars += stars;
  return {
    state: s,
    update: { roundId: e.roundId, seq: e.seq, xpGained: xp, starsGained: stars, levelUps, missions: changes, view: view(s, config) },
  };
}

/** QA helper: grant XP directly (used by the dev panel to demo level-ups). */
export function grantXp(prev: GamiState, xp: number, config = CONFIG): { state: GamiState; update: GamiUpdate } {
  const s: GamiState = structuredClone(prev);
  const levelUps: number[] = [];
  const stars = addXp(s, xp, config, levelUps);
  s.stars += stars;
  return { state: s, update: { roundId: '', seq: s.lastSeq, xpGained: xp, starsGained: stars, levelUps, missions: [], view: view(s, config) } };
}
