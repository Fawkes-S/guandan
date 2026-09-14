/**
 * 音效引擎：全部用 Web Audio 实时合成，不依赖任何音频素材文件。
 * 浏览器要求首次用户交互后才能创建 AudioContext，因此采用惰性初始化。
 *
 * 提供两套音色包，可在侧栏「操作 → 音效」里切换与试听：
 *  - **classic（原版）**：短促清亮的提示音，三角/正弦为主，干脆利落。
 *  - **ink（水墨）**：刻意做"减法"——只用正弦与三角波，不加混响、不加噪声爆点，
 *    起音更柔、时值更短、整体更轻，留白多于信息；出牌是一声带泛音的清音，
 *    炸弹是低而闷的一记"咚"而不是锣。
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

export type SoundPack = 'classic' | 'ink';

export const SOUND_PACKS: Array<[SoundPack, string]> = [
  ['classic', '原版'],
  ['ink', '水墨'],
];

/** 供试听面板枚举 */
export const SFX_LABELS: Array<[SfxName, string]> = [
  ['click', '点击'],
  ['select', '选牌'],
  ['toggle', '开关'],
  ['place', '落定'],
  ['play', '出牌'],
  ['pass', '不要'],
  ['deal', '发牌'],
  ['tribute', '进贡'],
  ['bomb', '炸弹'],
  ['win', '胜'],
  ['lose', '负'],
  ['error', '误操作'],
];

type Ctor = typeof AudioContext;

function getAudioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 五声音阶（宫商角徵羽）—— 水墨包里的旋律都走它，随手触发都协和 */
const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  dur: number;
  gain?: number;
  delay?: number;
  attack?: number;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  delay?: number;
  from?: number;
  to?: number;
  q?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<SfxName, number>();

  enabled = true;
  /** 0~1 */
  volume = 0.55;
  /** 当前音色包 */
  pack: SoundPack = 'classic';
  /** 当前音色包的整体增益（水墨包刻意更轻，但不能轻到听不见） */
  private gainScale = 1;
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
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  setPack(value: SoundPack): void {
    this.pack = value;
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

  /**
   * 注入外部音频上下文（离线渲染验证用）。
   * OfflineAudioContext 的节点接口与 AudioContext 一致，因此同一套合成代码
   * 可以被渲染成 PCM，用来核对音量、时长与是否真的出声。
   */
  useContext(ctx: AudioContext): void {
    this.ready = true;
    this.enabled = true;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  private tone(opts: ToneOpts): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    }
    const peak = (opts.gain ?? 0.22) * this.gainScale;
    const attack = opts.attack ?? 0.006;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  private noise(opts: NoiseOpts): void {
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
    gain.gain.exponentialRampToValueAtTime((opts.gain ?? 0.16) * this.gainScale, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  /**
   * 水墨包的基本音：一声带泛音的"清音"。
   * 只有基音 + 八度泛音 + 一点三度泛音，起音柔、衰减干净 ——
   * 听着像拨了一根弦或轻击玉片，但不会变成"编钟"。
   */
  private clear(
    freq: number,
    opts: { dur?: number; gain?: number; delay?: number; type?: OscillatorType } = {},
  ): void {
    const dur = opts.dur ?? 0.22;
    const g = opts.gain ?? 0.06;
    const d = opts.delay ?? 0;
    this.tone({ freq, to: freq * 0.985, type: opts.type ?? 'sine', dur, gain: g, delay: d, attack: 0.005 });
    this.tone({ freq: freq * 2, dur: dur * 0.62, gain: g * 0.28, delay: d, attack: 0.004 });
    this.tone({ freq: freq * 3, dur: dur * 0.4, gain: g * 0.12, delay: d, attack: 0.004 });
  }

  /** 播放一个音效；同名牌带 30ms 去抖，避免连点刺耳 */
  play(name: SfxName): void {
    this.playInternal(name, false);
  }

  /** 试听面板用：不去抖，保证点一次响一次 */
  preview(name: SfxName): void {
    this.playInternal(name, true);
  }

  private playInternal(name: SfxName, bypassDebounce: boolean): void {
    if (!this.enabled && !bypassDebounce) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (!bypassDebounce) {
      const now = ctx.currentTime * 1000;
      const last = this.lastPlayed.get(name) ?? -1e9;
      if (now - last < 30) return;
      this.lastPlayed.set(name, now);
    }
    this.gainScale = this.pack === 'ink' ? 1.7 : 1;
    if (this.pack === 'ink') this.playInk(name);
    else this.playClassic(name);
  }

  // ------------------------------------------------------------ 原版音色包

  private playClassic(name: SfxName): void {
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
        notes.forEach((f, i) => {
          this.tone({ freq: f, type: 'triangle', dur: 0.36, gain: 0.16, delay: i * 0.11 });
        });
        break;
      }
      case 'lose': {
        const notes = [440, 392, 330, 262];
        notes.forEach((f, i) => {
          this.tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.14, delay: i * 0.12 });
        });
        break;
      }
      case 'error':
        this.tone({ freq: 200, to: 150, type: 'square', dur: 0.14, gain: 0.12 });
        break;
    }
  }

  // ------------------------------------------------------------ 水墨音色包

  private playInk(name: SfxName): void {
    switch (name) {
      case 'click':
        // 指甲轻扣纸面：短、闷、几乎不占注意力
        this.tone({ freq: 620, to: 520, type: 'triangle', dur: 0.042, gain: 0.05, attack: 0.003 });
        this.noise({ dur: 0.022, gain: 0.014, from: 2400, to: 1200, q: 1.6 });
        break;
      case 'select':
        this.clear(880, { dur: 0.1, gain: 0.045 });
        break;
      case 'toggle':
        this.tone({ freq: 720, to: 640, type: 'sine', dur: 0.07, gain: 0.05, attack: 0.005 });
        break;
      case 'deal':
        for (let i = 0; i < 3; i++) {
          this.noise({ dur: 0.04, gain: 0.07, delay: i * 0.05, from: 2600, to: 1300, q: 1.4 });
        }
        break;
      case 'play':
        // 一声清音，不加噪声爆点
        this.clear(PENTATONIC[5], { dur: 0.26, gain: 0.07 });
        break;
      case 'pass':
        this.tone({ freq: 294, to: 252, type: 'sine', dur: 0.13, gain: 0.05, attack: 0.006 });
        break;
      case 'bomb':
        // 低而闷的一记"咚"，尾巴收干净，不做锣
        this.tone({ freq: 132, to: 68, type: 'sine', dur: 0.55, gain: 0.15, attack: 0.004 });
        this.tone({ freq: 520, to: 300, type: 'sine', dur: 0.16, gain: 0.04, attack: 0.003 });
        this.noise({ dur: 0.13, gain: 0.05, from: 1400, to: 260, q: 0.7 });
        break;
      case 'tribute':
        this.clear(659.25, { dur: 0.2, gain: 0.06 });
        this.clear(880, { dur: 0.22, gain: 0.05, delay: 0.11 });
        break;
      case 'place':
        this.clear(392, { dur: 0.16, gain: 0.055 });
        this.clear(587.33, { dur: 0.12, gain: 0.03, delay: 0.02 });
        break;
      case 'win':
        [3, 4, 5, 6, 7].forEach((d, i) => {
          this.clear(PENTATONIC[d], { dur: 0.3, gain: 0.055, delay: i * 0.115 });
        });
        break;
      case 'lose':
        [7, 5, 4, 2, 0].forEach((d, i) => {
          this.clear(PENTATONIC[d], { dur: 0.34, gain: 0.05, delay: i * 0.135 });
        });
        break;
      case 'error':
        this.tone({ freq: 220, to: 190, type: 'sine', dur: 0.1, gain: 0.055, attack: 0.004 });
        this.tone({ freq: 185, to: 158, type: 'sine', dur: 0.12, gain: 0.045, delay: 0.085, attack: 0.004 });
        break;
    }
  }

  /**
   * 出牌音：按牌型挑音高 —— 大牌型落低音（有分量），小牌型落高音（轻快）。
   */
  playCombo(combo: { type: string; cards: unknown[]; isBomb: boolean; power: number }): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.gainScale = this.pack === 'ink' ? 1.7 : 1;

    if (combo.isBomb) {
      this.playInternal('bomb', true);
      return;
    }

    const degree: Record<string, number> = {
      Single: 5,
      Pair: 4,
      Triple: 3,
      FullHouse: 2,
      Straight: 6,
      Tube: 1,
      Plate: 0,
    };
    const d = degree[combo.type] ?? 4;
    const n = combo.cards.length;
    const shifted = Math.max(0, Math.min(PENTATONIC.length - 1, d - (n >= 5 ? 1 : 0)));
    const freq = PENTATONIC[shifted];

    if (this.pack === 'ink') {
      this.gainScale = 1.7;
      this.clear(freq, { dur: n >= 5 ? 0.3 : 0.24, gain: n >= 5 ? 0.075 : 0.065 });
      return;
    }
    this.noise({ dur: 0.13, gain: 0.12, from: 2600, to: 500, q: 0.8 });
    this.tone({ freq: freq * 0.61, to: freq * 0.34, type: 'sine', dur: 0.09, gain: 0.09 });
  }
}

export const sfx = new SoundEngine();
