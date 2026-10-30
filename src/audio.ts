import type { GameEvent } from './game/game';

const PENTATONIC = [0, 2, 4, 7, 9];
const BASE_HZ = 392; // G4
const VOLUME = 0.5;

const hz = (semitones: number) => BASE_HZ * 2 ** (semitones / 12);

/** Each food in a combo plays the next note up a pentatonic scale, so a long combo is a rising melody. */
function comboSemitones(combo: number): number {
  const n = Math.min(Math.max(combo - 1, 0), 14);
  return 12 * Math.floor(n / 5) + PENTATONIC[n % 5];
}

interface Voice {
  freq: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  at?: number;
  attack?: number;
  glideTo?: number;
  filter?: number;
  filterTo?: number;
  echo?: boolean;
}

/** Every sound is synthesised on the fly with Web Audio; there are no sound files. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: GainNode | null = null;

  constructor(private _muted: boolean) {}

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : VOLUME, this.ctx.currentTime, 0.02);
  }

  /** Browsers only allow audio to start from a user gesture, so call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;
      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : VOLUME;
      master.connect(compressor).connect(ctx.destination);

      // A soft echo gives the plucks some space.
      const echo = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.19;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.3;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2800;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      echo.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(wet);
      wet.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.echo = echo;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(event: GameEvent): void {
    if (!this.ready()) return;
    switch (event.type) {
      case 'eat':
        if (event.golden) this.goldenChord(event.combo);
        else this.pluck(hz(comboSemitones(event.combo)), event.multiplier);
        break;
      case 'goldenSpawn':
        this.voice({ freq: hz(24), duration: 0.25, gain: 0.08, type: 'sine' });
        this.voice({ freq: hz(31), duration: 0.35, gain: 0.07, type: 'sine', at: 0.07 });
        break;
      case 'goldenExpire':
        this.voice({ freq: hz(12), glideTo: hz(0), duration: 0.35, gain: 0.08, type: 'triangle', filter: 1400 });
        break;
      case 'comboBreak':
        if (event.combo < 2) break;
        this.voice({ freq: hz(4), duration: 0.14, gain: 0.1, type: 'triangle', filter: 1200 });
        this.voice({ freq: hz(-1), duration: 0.22, gain: 0.1, type: 'triangle', filter: 900, at: 0.09 });
        break;
      case 'death':
        this.voice({ freq: 360, glideTo: 45, duration: 1.0, gain: 0.22, type: 'sawtooth', filter: 2600, filterTo: 160 });
        this.voice({ freq: 150, glideTo: 38, duration: 0.4, gain: 0.55, type: 'sine', echo: false });
        this.noise(0.4, 0.22, 3200, 250);
        break;
      case 'perfect':
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
          this.voice({ freq: hz(s), duration: 0.5, gain: 0.16, type: 'triangle', at: i * 0.07 }),
        );
        [12, 16, 19, 24].forEach((s) => this.voice({ freq: hz(s), duration: 1.8, gain: 0.08, type: 'sine', at: 0.5, attack: 0.05 }));
        break;
      case 'foodSpawn':
        break;
    }
  }

  start(): void {
    if (!this.ready()) return;
    this.voice({ freq: hz(0), glideTo: hz(12), duration: 0.14, gain: 0.12, type: 'sine' });
  }

  highScore(): void {
    if (!this.ready()) return;
    [0, 4, 7, 12, 16].forEach((s, i) =>
      this.voice({ freq: hz(s + 5), duration: i === 4 ? 0.9 : 0.25, gain: 0.14, type: 'triangle', at: i * 0.09 }),
    );
  }

  private ready(): boolean {
    return this.ctx !== null && !this._muted;
  }

  private pluck(freq: number, multiplier: number): void {
    this.voice({ freq, duration: 0.3, gain: 0.32, type: 'triangle' });
    this.voice({ freq: freq * 2, duration: 0.18, gain: 0.1, type: 'sine' });
    this.voice({ freq, duration: 0.12, gain: 0.05, type: 'square', filter: 1800, echo: false });
    if (multiplier >= 4) this.voice({ freq: freq * 4, duration: 0.25, gain: 0.03 + multiplier * 0.004, type: 'sine' });
  }

  private goldenChord(combo: number): void {
    const root = comboSemitones(combo) - 12;
    [0, 4, 7, 12, 16, 19].forEach((s, i) =>
      this.voice({ freq: hz(root + s), duration: 0.65, gain: 0.14, type: 'triangle', at: i * 0.035 }),
    );
    this.voice({ freq: hz(root + 36), duration: 1.1, gain: 0.05, type: 'sine', at: 0.2 });
  }

  private voice(v: Voice): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (v.at ?? 0);
    const end = t0 + v.duration;
    const osc = ctx.createOscillator();
    osc.type = v.type ?? 'triangle';
    osc.frequency.setValueAtTime(v.freq, t0);
    if (v.glideTo) osc.frequency.exponentialRampToValueAtTime(v.glideTo, end);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(v.gain, t0 + (v.attack ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    let source: AudioNode = osc;
    if (v.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(v.filter, t0);
      if (v.filterTo) filter.frequency.exponentialRampToValueAtTime(v.filterTo, end);
      osc.connect(filter);
      source = filter;
    }
    source.connect(env);
    env.connect(this.master!);
    if (v.echo !== false) env.connect(this.echo!);
    osc.start(t0);
    osc.stop(end + 0.05);
  }

  private noise(duration: number, gain: number, filterFrom: number, filterTo: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(filterTo, t0 + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(t0);
  }
}
