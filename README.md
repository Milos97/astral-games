# Astral Games — a PixiJS v8 iGaming showcase

[![CI](https://github.com/Milos97/astral-games/actions/workflows/ci.yml/badge.svg)](https://github.com/Milos97/astral-games/actions/workflows/ci.yml)

Two games on one client framework, with a mock remote game server (RGS):

- **Astral Tumble**: a 6×5 "pay anywhere" cascading slot. Tumble multipliers, scatter anticipation, free spins with a persistent multiplier, and escalating big-win sequences.
- **Plinko**: concurrent balls with three risk tables. It reuses the same HUD, server client, atlas, particles, big-win overlay and state machine.
- **Gamification layer**: levels, XP, missions and loyalty stars that sit *on top of* both games, driven by an event stream from the game server. It never touches the odds.

There are no image or audio assets. Every texture is drawn procedurally into a single atlas at boot, and every sound is synthesised with WebAudio.

```bash
npm install
npm run dev        # http://localhost:5173  (?game=slot or ?game=plinko to skip the lobby)
npm test           # math invariants (50k slot rounds + 10k plinko drops) + gamification engine
npm run sim        # Monte-Carlo RTP report (2M spins, ~5s)
npm run build      # typecheck + production bundle (~123 KB gzip main chunk)
```

Press **`** or the **QA** button to open the dev panel. **Space** spins, slam-stops, or skips a celebration.

---

## Architecture

```
src/
  shared/        rng.ts (seeded sfc32), protocol.ts (typed RPC contract)
  server/        worker.ts: mock RGS in a Web Worker (wallet, RNG, sessions)
  games/*/math/  pure math engines, shared by the server worker, tests and simulator
  core/          App shell, Tweens, StateMachine, ServerClient, Atlas, Audio, i18n
  fx/            Particles (ParticleContainer), shaders, Background
  ui/            Hud, Button, Overlay, BigWin, Toasts, text/BitmapFont helpers
  games/*/client presentation only: SlotScene, Grid, PlinkoScene, ...
  gamification/  engine.ts (pure XP / level / mission rules), client/ (Gami controller, PixiJS widget)
  debug/         QA panel (DOM)
```

### The server decides, the client presents

The client never generates an outcome. `slot.spin` returns a complete round: the initial grid, then every tumble step, which lists the wins, the multiplier, the removed cells, the refill symbols and the grid that results. The client only animates it. In dev builds the client re-applies each tumble and checks that the symbols on screen match the server's grid (`Grid.verify`). The test suite checks the same invariants against the engine.

The RGS runs in a Web Worker, so it really is a separate thread with a message boundary, and the deploy stays static. It behaves like a real server in the ways a client has to handle:

| Behaviour | How it's handled |
|---|---|
| Latency | 120–320 ms by default. The old grid drops away *while* the request is in flight, which hides it. |
| Network error | `ServerClient` retries with exponential backoff and shows a toast. |
| Lost response (the bet was processed but the reply never arrived) | The client times out and retries with the **same `requestId`**. The server's idempotency cache returns the stored result, so the bet is never debited twice. |
| Reload mid-round | The round stays `pending` until the client sends `slot.ack`. On the next load the game reopens the slot and replays the round. |
| Reload mid-feature | Free-spin state lives on the server, so the feature resumes where it left off. |

### State machine

The slot has an explicit transition table (`SlotScene.ts`). An illegal transition throws in dev:

```
boot ─┬─> idle ──> requesting ──> spinning ──> cascading* ──> settling ─┬─> idle
      │                ^                                                  ├─> bigWin ──> idle / fsIntro / fsOutro
      ├─> spinning  (resume pending round)                                ├─> fsIntro ──> requesting (free spins loop)
      └─> fsIntro   (resume free spins)                                   └─> fsOutro ──> idle
idle ──> spinning   (visual replay: no request, no money)
```

### Slam-stop and turbo

All presentation goes through one promise-based tween clock (`core/Tweens.ts`):

- **Turbo** sets `timeScale` to 2.2.
- **Slam-stop** sets `skipping` and calls `finishAll()`. Tweens already running jump to their end values, and new ones complete instantly. The async presentation code keeps running, in zero time, so a slam always lands in exactly the same final state as watching the full animation.
- Each phase (the drop-in, then each tumble) is its own slam scope.

### Rendering

- **One atlas:** symbols, particles, coins, pegs and the ball are all drawn with `Graphics` into one `RenderTexture` at boot. The grid's symbols batch together, and every particle type shares a single `ParticleContainer`.
- **Particles:** a pooled system on the v8 `ParticleContainer`. It uses swap-remove and makes no allocations once warmed up. It powers the shards, sparkles, shockwave rings, coin fountains and ball trails.
- **Shaders:**
  - a domain-warped fbm nebula background at half resolution, with a free-spins "mood" blend and a flash pulse;
  - a noise-threshold dissolve with a hot edge when symbols explode, written to respect premultiplied alpha.
- **BitmapText for numbers:** balances and count-ups use it, so they re-layout glyph quads every frame instead of re-rasterising a canvas texture.
- **Layout:** separate landscape (1920×1080) and portrait (1080×1920) designs. The background covers the full screen and the game area scales to fit.
- **Debug instrumentation:** the dev panel shows real GL draw calls, counted by wrapping `drawElements`/`drawArrays`.

Measured in desktop Chrome at 2× resolution: 60 fps, about 32 draw calls at idle, and about 36 at the peak of an epic win with the coin fountain running.

### Math

| | |
|---|---|
| Slot RTP | **97.1%** from a 2M-spin simulation: base game 68.3%, free spins 28.8% |
| Hit frequency | 30% |
| Free spins | about 1 in 230 spins |
| Big / mega / epic win | about 1 in 100 / 280 / 960 spins |
| Max win | capped at 5,000× |
| Plinko RTP | exact via the binomial distribution: 96.8% / 96.6% / 96.7% for low / medium / high |

The math is **illustrative**: tuned with the simulator, not certified. The paytable is generated from the config, so it always matches the model.

### QA panel

- **Live stats:** fps, draw calls, frame time, active tweens.
- **State machine:** the current state and its transition history.
- **Force next outcome:** the server searches seeds until the *real* engine produces the requested outcome (big / mega / epic win, free spins, long cascade, no win, Plinko edge). Forced rounds are therefore genuine math outcomes, not mocked data.
- **Round history** with visual replay. Replay re-runs a round from its stored seed.
- **Network faults:** latency presets, fail-next-request, lose-next-response.
- **Session tools:** spin-then-reload mid-round, set or reset the wallet.
- **Display:** quality (high/low), locale (EN/ES).

### Product details

- Autoplay (10/25/50/100); it stops on insufficient funds or a press of the spin button.
- Turbo mode, sound toggle, a session timer and clock in the top bar.
- Localised text and currency through `Intl` (EN/ES).
- Low-quality mode: no nebula shader, no dissolve shader, fewer particles, 1× resolution.

## Gamification layer

A small engagement service, modelled on how a B2B gamification product plugs into an existing casino. The games don't know it exists: they only tell it when a round has *finished animating*.

```
RGS (settles round) ──publish(RoundEvent)──> gamification engine ──push(GamiUpdate)──> client
                                                                                         │ held until the game
game scene ──────────────── gami.reveal(roundId) after its presentation ───────────────>─┘ calls reveal()
```

- **Event-driven:** the RGS publishes a `RoundEvent` for every settled paid round (game, bet, win, mode, tumbles, free spins). The engine is a pure fold over that stream (`applyEvent(state, event) → { state, update }`), so it is deterministic and easy to test. In production the bus would be a queue such as Kafka; here it's one function inside the worker.
- **Exactly-once:** events carry a sequence number and the engine ignores duplicates. Because the event is published inside the idempotent request handler, a retried spin (the lost-response test in the QA panel) never awards XP twice.
- **No spoilers:** the server pushes progress as soon as a round settles, which is before the reels have even landed. The client holds each update until the game calls `reveal(roundId)` at the end of its presentation. Older updates are flushed first, so concurrent Plinko balls can't make the view jump backwards.
- **Never touches RTP:** the engine never reads or writes the wallet, RNG or math. XP is earned per paid round, not per euro staked, so a bigger bet never levels you up faster, and no mission requires a minimum bet.
- **Data-driven missions:** missions are config (`metric`, `target`, `filter`, `reward`), the way an operator would set them up: "play 10 spins", "play both games", "land a 10× win", "trigger free spins", "win €50 in total" and so on. Completed missions are replaced from the pool.
- **PixiJS widget:** a level / XP ring / stars pill, a missions panel, progress "peeks" while you play (on completion or at the halfway mark, so autoplay isn't noisy), stars that fly into the counter, and a level-up banner. It runs on its **own tween clock**, so a game's slam-stop or turbo never skips its animations. When autoplay outpaces the animations, routine updates are applied instantly and only completions and level-ups play in full.
- **QA:** the dev panel shows the live event bus, can grant XP to demo a level-up, and can reset progress.

## Known limitations

- **WebGL is forced** (`preference: 'webgl'`). The custom filters only ship GLSL; WebGPU would need WGSL versions.
- **Background tabs pause animation.** The game loop runs on `requestAnimationFrame`, as Pixi's does, so a background tab pauses presentation. Boot no longer depends on rAF.
- **Mock server only.** Persistence is `localStorage`. The cheats, replay and wallet endpoints would not exist in a production build.
- **Fonts:** Fredoka loads from Google Fonts, with a 2.5 s fallback to system fonts.
