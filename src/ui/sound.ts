/**
 * 音效引擎：全部用 Web Audio 实时合成，不依赖任何音频素材文件。
 * 浏览器要求首次用户交互后才能创建 AudioContext，因此采用惰性初始化。
 */

export type SfxName =
  | 'click'
  | 'select'
  | 'deal'
  | 'play'
  | 'pass'
  | 'bomb'
  | 'tribute'
  | 'place'
  | 'win'
  | 'lose'
  | 'error'
  | 'toggle';

type Ctor = typeof AudioContext;

function getAudioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<SfxName, number>();

  enabled = true;
  /** 0~1 */
  volume = 0.55;
  /** 是否已获得用户手势授权（未授权前不创建 AudioContext，避免控制台告警） */
  private ready = false;

  /** 在首次用户交互时调用，解锁音频上下文 */
  unlock(): void {
    this.ready = true;
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.stopAll();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ready) return null;
    if (this.ctx) return this.ctx;
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    } catch {
      this.ctx = null;
      this.master = null;
    }
    return this.ctx;
  }

  private stopAll(): void {
    /* 合成音都很短，无需显式停止 */
  }

  private tone(opts: {
    freq: number;
    to?: number;
    type?: OscillatorType;
    dur: number;
    gain?: number;
    delay?: number;
    attack?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    const peak = opts.gain ?? 0.22;
    const attack = opts.attack ?? 0.006;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  private noise(opts: {
    dur: number;
    gain?: number;
    delay?: number;
    from?: number;
    to?: number;
    q?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = opts.q ?? 0.9;
    filter.frequency.setValueAtTime(opts.from ?? 1200, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.to ?? 400), t0 + opts.dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.16, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  /** 播放一个音效；带 30ms 去抖，避免连点刺耳 */
  play(name: SfxName): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime * 1000;
    const last = this.lastPlayed.get(name) ?? -1e9;
    if (now - last < 30) return;
    this.lastPlayed.set(name, now);

    switch (name) {
      case 'click':
        this.tone({ freq: 880, to: 660, type: 'triangle', dur: 0.05, gain: 0.1 });
        break;
      case 'select':
        this.tone({ freq: 1180, to: 1420, type: 'triangle', dur: 0.045, gain: 0.09 });
        break;
      case 'toggle':
        this.tone({ freq: 520, to: 700, type: 'sine', dur: 0.06, gain: 0.1 });
        break;
      case 'deal':
        for (let i = 0; i < 6; i++) {
          this.noise({ dur: 0.05, gain: 0.07, delay: i * 0.045, from: 2200, to: 900, q: 1.4 });
        }
        break;
      case 'play':
        this.noise({ dur: 0.13, gain: 0.13, from: 2600, to: 500, q: 0.8 });
        this.tone({ freq: 320, to: 180, type: 'sine', dur: 0.09, gain: 0.09 });
        break;
      case 'pass':
        this.tone({ freq: 420, to: 300, type: 'sine', dur: 0.12, gain: 0.11 });
        this.tone({ freq: 300, to: 210, type: 'sine', dur: 0.14, gain: 0.08, delay: 0.05 });
        break;
      case 'bomb':
        this.tone({ freq: 160, to: 42, type: 'sawtooth', dur: 0.5, gain: 0.3 });
        this.tone({ freq: 90, to: 30, type: 'square', dur: 0.42, gain: 0.18 });
        this.noise({ dur: 0.45, gain: 0.24, from: 900, to: 90, q: 0.6 });
        break;
      case 'tribute':
        this.tone({ freq: 784, type: 'sine', dur: 0.22, gain: 0.14 });
        this.tone({ freq: 1046, type: 'sine', dur: 0.28, gain: 0.1, delay: 0.09 });
        break;
      case 'place':
        this.tone({ freq: 659, type: 'sine', dur: 0.2, gain: 0.13 });
        this.tone({ freq: 988, type: 'sine', dur: 0.3, gain: 0.11, delay: 0.1 });
        break;
      case 'win': {
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.36, gain: 0.16, delay: i * 0.11 }),
        );
        break;
      }
      case 'lose': {
        const notes = [440, 392, 330, 262];
        notes.forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.14, delay: i * 0.12 }),
        );
        break;
      }
      case 'error':
        this.tone({ freq: 200, to: 150, type: 'square', dur: 0.14, gain: 0.12 });
        break;
    }
  }
}

export const sfx = new SoundEngine();
