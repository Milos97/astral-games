/**
 * Tests for the gamification engine. Run with `npm test`.
 * The engine is a pure fold over the event stream, so every property here
 * is checked by replaying synthetic events.
 */
declare const process: { exit(code: number): never };
import { applyEvent, CONFIG, grantXp, initialState, type GamiState, type RoundEvent } from '../src/gamification/engine';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('FAIL', msg);
  }
};

let seq = 0;
const ev = (o: Partial<RoundEvent> = {}): RoundEvent => ({
  type: 'round',
  seq: ++seq,
  roundId: `R${seq}`,
  game: 'slot',
  bet: 100,
  win: 0,
  mode: 'base',
  tumbles: 0,
  freeSpinsAwarded: 0,
  time: 0,
  ...o,
});

const fold = (events: RoundEvent[], s: GamiState = initialState()) =>
  events.reduce((acc, e) => applyEvent(acc, e).state, s);

// starts with the first missions in the pool
{
  const s = initialState();
  check(s.missions.map((m) => m.id).join() === CONFIG.pool.slice(0, CONFIG.activeMissions).map((d) => d.id).join(), 'initial missions');
  check(s.level === 1 && s.xp === 0 && s.stars === 0, 'initial level/xp/stars');
}

// XP per paid round, not per euro: a 100x bigger bet earns the same XP
{
  const a = applyEvent(initialState(), ev({ bet: 20 })).update!;
  const b = applyEvent(initialState(), ev({ bet: 2000 })).update!;
  check(a.xpGained === CONFIG.xpPerRound && b.xpGained === CONFIG.xpPerRound, 'xp independent of stake');
}

// free spins earn no XP and don't count as paid spins
{
  const r = applyEvent(initialState(), ev({ mode: 'free', win: 500 }));
  check(r.update!.xpGained === 0, 'free spin gives no xp');
  check(r.state.missions.find((m) => m.id === 'spins10')!.progress === 0, 'free spin not a paid spin');
}

// duplicates (same or older seq) are ignored: exactly-once even if delivered twice
{
  const e = ev();
  const once = applyEvent(initialState(), e).state;
  const twice = applyEvent(once, e);
  check(twice.update === null && twice.state === once, 'duplicate event ignored');
}

// input state is never mutated
{
  const s = initialState();
  const before = JSON.stringify(s);
  applyEvent(s, ev({ win: 5000 }));
  check(JSON.stringify(s) === before, 'applyEvent is pure');
}

// completing a mission pays its reward and draws the next one from the pool
{
  const events = Array.from({ length: 10 }, () => ev());
  let s = initialState();
  let completedUpdate = null;
  for (const e of events) {
    const r = applyEvent(s, e);
    s = r.state;
    if (r.update!.missions.some((m) => m.completed)) completedUpdate = r.update!;
  }
  check(completedUpdate !== null, 'spins10 completes after 10 spins');
  const change = completedUpdate!.missions.find((m) => m.completed)!;
  check(change.after.progress === 10 && change.next!.id === CONFIG.pool[CONFIG.activeMissions].id, 'next mission drawn in order');
  check(completedUpdate!.xpGained === CONFIG.xpPerRound + 60, 'mission xp reward included');
  check(s.completed === 1 && s.missions.length === CONFIG.activeMissions, 'slot refilled');
}

// "play both games" needs two distinct games
{
  const s = fold([ev({ game: 'slot' }), ev({ game: 'slot' })]);
  check(s.missions.find((m) => m.id === 'both')!.progress === 1, 'same game twice = 1');
  const s2 = fold([ev({ game: 'plinko', mode: 'low' })], s);
  check(!s2.missions.some((m) => m.id === 'both') && s2.completed === 1, 'both games completes');
}

// minX filter
{
  const s = fold([ev({ win: 900 })]);
  check(s.missions.find((m) => m.id === 'win10x')!.progress === 0, '9x does not count as 10x');
  const s2 = fold([ev({ win: 1000 })]);
  check(!s2.missions.some((m) => m.id === 'win10x'), '10x completes');
}

// level curve: total XP is conserved across level-ups
{
  const r = grantXp(initialState(), 1000);
  let need = 0;
  for (let l = 1; l < r.state.level; l++) need += CONFIG.xpToNext(l);
  check(need + r.state.xp === 1000, 'xp conserved across levels');
  check(r.state.xp < CONFIG.xpToNext(r.state.level), 'xp below next threshold');
  const expectedStars = r.update.levelUps.reduce((a, l) => a + CONFIG.levelReward(l), 0);
  check(r.state.stars === expectedStars, 'level-up stars');
}

// determinism over a long random stream
{
  const rnd = (i: number) => ((i * 2654435761) >>> 0) / 2 ** 32;
  const stream = Array.from({ length: 5000 }, (_, i) =>
    ev({
      game: rnd(i) < 0.5 ? 'slot' : 'plinko',
      mode: rnd(i + 1) < 0.1 ? 'free' : rnd(i + 2) < 0.3 ? 'high' : 'base',
      win: Math.floor(rnd(i + 3) * 3000),
      tumbles: Math.floor(rnd(i + 4) * 6),
      freeSpinsAwarded: rnd(i + 5) < 0.01 ? 10 : 0,
    }),
  );
  const a = fold(stream);
  const b = fold(stream);
  check(JSON.stringify(a) === JSON.stringify(b), 'deterministic');
  check(a.completed > 10 && a.level > 5, `long run progresses (level ${a.level}, ${a.completed} missions)`);
}

if (failures) {
  console.error(`${failures} gamification check(s) failed`);
  process.exit(1);
}
console.log('ok — gamification engine verified');
