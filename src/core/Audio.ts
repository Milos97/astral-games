/**
 * Procedural sound effects on WebAudio — no audio files to load, and every
 * cue is parameterised by game events (column index, cascade depth, win
 * size) so the soundtrack follows the presentation.
 *
 * The context is created on the first user gesture (autoplay policy).
 */
type Wave = OscillatorType;

interface ToneOpts {
  type?: Wave;
  gain?: number;
  attack?: number;
  delay?: number;
  slideTo?: number;
  detune?: number;
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const note = (root: number, step: number) => root * 2 ** (PENTA[Math.min(step, PENTA.length - 1)] / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastTick = 0;
  private _muted = false;

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get muted() {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  private ready(): AudioContext | null {
    if (this._muted || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}) {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.detune) osc.detune.value = o.detune;
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, o: { gain?: number; freq?: number; delay?: number; q?: number; sweepTo?: number } = {}) {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(o.freq ?? 1200, t0);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur);
    filter.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  click() {
    this.tone(1800, 0.05, { type: 'triangle', gain: 0.08 });
  }

  spin() {
    this.noise(0.35, { freq: 400, sweepTo: 2400, gain: 0.12 });
  }

  /** A column of symbols lands. */
  land(col: number) {
    this.tone(140 - col * 6, 0.12, { type: 'sine', gain: 0.25, slideTo: 60 });
    this.noise(0.06, { freq: 3000, gain: 0.05 });
  }

  scatterLand(n: number) {
    this.tone(note(523, n * 2), 0.5, { type: 'triangle', gain: 0.16 });
    this.tone(note(523, n * 2 + 2), 0.5, { type: 'sine', gain: 0.1, delay: 0.06 });
  }

  anticipation() {
    this.noise(1.2, { freq: 300, sweepTo: 3000, gain: 0.1, q: 4 });
    this.tone(220, 1.2, { type: 'sawtooth', gain: 0.03, slideTo: 440 });
  }

  /** Winning cluster highlight; pitch climbs with cascade depth. */
  win(depth: number) {
    for (let i = 0; i < 3; i++) this.tone(note(392, depth + i * 2), 0.35, { type: 'triangle', gain: 0.12, delay: i * 0.07 });
  }

  explode() {
    this.noise(0.4, { freq: 2200, sweepTo: 200, gain: 0.22 });
    this.tone(90, 0.25, { type: 'sine', gain: 0.2, slideTo: 40 });
  }

  tumble() {
    this.noise(0.15, { freq: 600, gain: 0.08 });
  }

  multiplier(level: number) {
    this.tone(note(660, level), 0.25, { type: 'square', gain: 0.05 });
    this.tone(note(660, level + 2), 0.3, { type: 'triangle', gain: 0.1, delay: 0.05 });
  }

  /** Count-up tick, rate limited. */
  tick() {
    const now = performance.now();
    if (now - this.lastTick < 55) return;
    this.lastTick = now;
    this.tone(2400 + Math.random() * 400, 0.03, { type: 'square', gain: 0.025 });
  }

  coin() {
    this.tone(1800 + Math.random() * 900, 0.12, { type: 'triangle', gain: 0.04 });
  }

  tierUp(i: number) {
    const root = 262 * 2 ** (i * 3 / 12);
    [0, 4, 7, 12].forEach((s, k) => this.tone(root * 2 ** (s / 12), 0.6, { type: 'sawtooth', gain: 0.06, delay: k * 0.05 }));
    this.noise(0.8, { freq: 5000, gain: 0.08 });
  }

  fanfare() {
    [0, 4, 7, 12, 16].forEach((s, k) => this.tone(392 * 2 ** (s / 12), 0.7, { type: 'triangle', gain: 0.13, delay: k * 0.09 }));
  }

  peg(row: number) {
    this.tone(note(880, Math.floor(row / 2)), 0.06, { type: 'sine', gain: 0.06 });
  }

  bucket(mult: number) {
    if (mult >= 1) this.win(Math.min(8, Math.round(Math.log2(mult + 1) * 2)));
    else this.tone(200, 0.15, { type: 'triangle', gain: 0.08, slideTo: 150 });
  }
}

export const sfx = new Sfx();
