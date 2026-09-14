/**
 * 音效引擎：全部用 Web Audio 实时合成，不依赖任何音频素材文件。
 *
 * 和"哔哔声"的区别在于这里按真实乐器的物理特性建模：
 *  - **拨弦（古琴/筝）**：多个分音叠加，且高次分音衰减得更快 —— 这是"弦在被拨动"
 *    而不是"振荡器在响"的关键；再叠一点非谐性和拨片噪声瞬态。
 *  - **钟磬（编钟/玉磬）**：用金属体的非谐分音比（1 : 2.76 : 5.40 : 8.93 …），
 *    所以听起来是"金属"而不是"音符"。
 *  - **木鱼/梆子**：极短的音高下坠 + 带通噪声，冲击感来自瞬态而不是音量。
 *  - **锣**：低音非谐分音 + 长衰减 + 起振噪声。
 *  - **混响**：程序生成脉冲响应（指数衰减噪声）喂给 ConvolverNode，
 *    让声音"在一个空间里"而不是干贴在耳朵上。同样不需要素材文件。
 *
 * 旋律音一律走**五声音阶（宫商角徵羽）**，所以随手触发也不会难听，也更贴合水墨调性。
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

/** 供试听面板枚举 */
export const SFX_LABELS: Array<[SfxName, string]> = [
  ['click', '点击 · 木鱼'],
  ['select', '选牌 · 玉磬'],
  ['toggle', '开关 · 小磬'],
  ['place', '落定 · 落子'],
  ['play', '出牌 · 古琴'],
  ['pass', '不要 · 闷木'],
  ['deal', '发牌 · 纸声'],
  ['tribute', '进贡 · 编钟'],
  ['bomb', '炸弹 · 锣'],
  ['win', '胜 · 筝上行'],
  ['lose', '负 · 筝下行'],
  ['error', '误 · 双木鱼'],
];

type Ctor = typeof AudioContext;

function getAudioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 五声音阶（宫商角徵羽）—— 跨两个八度，随手组合都协和 */
const PENTATONIC = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5,
];

/** 金属体的非谐分音比（编钟/钟琴的典型模态） */
const BELL_RATIOS = [0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.0, 3.76, 4.07];

/**
 * 响度对齐系数（相对合成器原始输出）。
 * 合成器各音色的天然音量差很多（锣有 8 个分音叠加，木鱼只有一个短促冲击），
 * 不校正的话日常音会轻到听不见、炸弹又会吓人一跳。这组值是**离线渲染实测峰值**反推的。
 */
const TRIM: Record<SfxName, number> = {
  click: 8.5,
  select: 4.4,
  toggle: 5,
  place: 5.5,
  play: 4.2,
  pass: 7.4,
  deal: 8,
  tribute: 2.1,
  bomb: 1.45,
  win: 2.2,
  lose: 3.5,
  error: 3.2,
};

interface VoiceOpts {
  gain?: number;
  dur?: number;
  pan?: number;
  /** 亮度：分音整体强度，越大越"亮" */
  bright?: number;
  delay?: number;
  /** 走多少混响 */
  wet?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private busDry: GainNode | null = null;
  private busWet: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<SfxName, number>();
  /** 当前这次触发使用的响度系数 */
  private trim = 1;

  enabled = true;
  /** 0~1 */
  volume = 0.6;
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
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? this.volume : 0, this.ctx.currentTime, 0.02);
    }
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ready) return null;
    if (this.ctx) return this.ctx;
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    try {
      this.buildBuses(new Ctor());
    } catch {
      this.ctx = null;
      this.master = null;
      this.busDry = null;
      this.busWet = null;
    }
    return this.ctx;
  }

  /** 建立总线：干声 + 程序生成混响 + 限幅器 */
  private buildBuses(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.enabled ? this.volume : 0;

    // 限幅器兜底：多分音叠加时防止削顶
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.connect(limiter).connect(ctx.destination);

    // 干/湿双总线，混响用程序生成的脉冲响应
    const dry = ctx.createGain();
    dry.gain.value = 0.82;
    dry.connect(master);

    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 1.9, 2.8);
    wet.connect(convolver).connect(master);

    this.ctx = ctx;
    this.master = master;
    this.busDry = dry;
    this.busWet = wet;

    const len = Math.floor(ctx.sampleRate * 0.7);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /**
   * 注入一个外部音频上下文（离线渲染验证用）。
   * OfflineAudioContext 与 AudioContext 的节点接口一致，因此同一套合成代码
   * 可以直接被渲染成 PCM 用来核对音量、时长与是否真的出声。
   */
  useContext(ctx: AudioContext): void {
    this.ready = true;
    this.enabled = true;
    this.buildBuses(ctx);
  }

  /** 程序生成混响脉冲响应：指数衰减噪声 + 轻微早期反射，不占任何素材体积 */
  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 前 8ms 压暗，模拟直达声后的扩散
        const rise = Math.min(1, i / (sr * 0.008));
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * rise;
      }
      // 一点点早期反射，让空间感不只是"糊"
      for (const [ms, amp] of [
        [17, 0.5],
        [29, 0.36],
        [43, 0.26],
      ] as const) {
        const idx = Math.floor(sr * (ms / 1000));
        if (idx < len) data[idx] += amp * (ch === 0 ? 1 : -1);
      }
    }
    return buf;
  }

  private send(node: AudioNode, wet: number): void {
    if (!this.busDry || !this.busWet) return;
    node.connect(this.busDry);
    if (wet > 0) {
      const sendGain = this.ctx!.createGain();
      sendGain.gain.value = wet;
      node.connect(sendGain).connect(this.busWet);
    }
  }

  /** 噪声瞬态：纸牌、拨片、锣的起振都靠它 */
  private noiseHit(
    t0: number,
    opts: { dur: number; gain: number; from: number; to: number; q?: number; pan?: number; wet?: number },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = opts.q ?? 0.8;
    filter.frequency.setValueAtTime(Math.max(40, opts.from), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + opts.dur);
    const gain = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain * this.trim);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? 0;
    src.connect(filter).connect(gain).connect(panner);
    this.send(panner, opts.wet ?? 0.25);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  /**
   * 拨弦（古琴/筝）：加法合成。
   * 关键在两点 —— 每个分音有**独立**的衰减时间（高次分音衰减快得多），
   * 以及一点非谐性；只这两条就能把"振荡器"变成"弦"。
   */
  private pluck(freq: number, t0: number, opts: VoiceOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dur = opts.dur ?? 1.1;
    const bright = opts.bright ?? 1;
    const partials = Math.max(1, Math.min(10, Math.floor(11000 / Math.max(60, freq))));
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? (Math.random() * 0.5 - 0.25);
    const out = ctx.createGain();
    // 等响补偿：同样的能量，低音听起来明显更轻，所以按频率补一点增益
    const loudness = Math.min(2.4, Math.pow(440 / Math.max(80, freq), 0.8));
    out.gain.value = (opts.gain ?? 0.16) * this.trim * loudness;
    out.connect(panner);
    this.send(panner, opts.wet ?? 0.42);

    // 弦的阻尼：高次分音衰减指数更陡
    for (let n = 1; n <= partials; n++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * n * (1 + 0.00035 * n * n); // 轻微非谐性
      const g = ctx.createGain();
      const amp = (Math.pow(n, -1.45) * bright) / (1 + 0.6 * (n - 1) * 0.12);
      const dec = dur / (1 + (n - 1) * 0.42);
      const atk = 0.0035 + n * 0.0006;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + dec + 0.02);
    }
    // 拨片触弦的瞬态 —— 少了它就"软"
    this.noiseHit(t0, {
      dur: 0.05,
      gain: 0.05 * bright,
      from: Math.min(8000, freq * 9),
      to: Math.max(300, freq * 2.2),
      q: 1.1,
      pan: (opts.pan ?? 0) * 0.6,
      wet: 0.12,
    });
  }

  /** 钟磬：金属非谐分音，衰减很长 */
  private bell(freq: number, t0: number, opts: VoiceOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dur = opts.dur ?? 2.2;
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? 0;
    const out = ctx.createGain();
    out.gain.value = (opts.gain ?? 0.1) * this.trim;
    out.connect(panner);
    this.send(panner, opts.wet ?? 0.62);

    BELL_RATIOS.forEach((r, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * r * 2;
      const g = ctx.createGain();
      const amp = Math.pow(0.72, i) * (opts.bright ?? 1);
      const dec = dur * Math.pow(0.62, i * 0.7);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + 0.004 + i * 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + dec + 0.03);
    });
    this.noiseHit(t0, { dur: 0.06, gain: 0.04, from: 5200, to: 2200, q: 1.6, pan: opts.pan ?? 0, wet: 0.2 });
  }

  /** 木鱼/梆子：极短、带音高下坠的敲击 + 木质带通噪声 */
  private wood(freq: number, t0: number, opts: VoiceOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dur = opts.dur ?? 0.13;
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? 0;
    const out = ctx.createGain();
    out.gain.value = (opts.gain ?? 0.2) * this.trim;
    out.connect(panner);
    this.send(panner, opts.wet ?? 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.9, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.78), t0 + dur * 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);

    this.noiseHit(t0, {
      dur: dur * 0.6,
      gain: 0.09,
      from: 3400,
      to: 900,
      q: 1.8,
      pan: opts.pan ?? 0,
      wet: 0.1,
    });
  }

  /** 锣：低音非谐体 + 长衰减 + 起振噪声 */
  private gong(freq: number, t0: number, opts: VoiceOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dur = opts.dur ?? 3.2;
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? 0;
    const out = ctx.createGain();
    out.gain.value = (opts.gain ?? 0.26) * this.trim;
    out.connect(panner);
    this.send(panner, opts.wet ?? 0.7);

    const ratios = [1, 1.42, 1.79, 2.31, 2.87, 3.44, 4.11, 5.02];
    ratios.forEach((r, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      // 起振瞬间略高再落回，模拟锣面张力释放
      osc.frequency.setValueAtTime(freq * r * 1.06, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * r, t0 + 0.28);
      const g = ctx.createGain();
      const amp = Math.pow(0.74, i);
      const dec = dur * Math.pow(0.78, i * 0.6);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t0 + 0.006 + i * 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + dec + 0.03);
    });
    this.noiseHit(t0, { dur: 0.5, gain: 0.14, from: 2600, to: 220, q: 0.55, pan: 0, wet: 0.4 });
  }

  /** 旋律：五声音阶上的一段 */
  private melody(degrees: number[], t0: number, step: number, opts: VoiceOpts = {}): void {
    degrees.forEach((d, i) => {
      const f = PENTATONIC[Math.max(0, Math.min(PENTATONIC.length - 1, d))];
      this.pluck(f, t0 + i * step, { ...opts, dur: opts.dur ?? 0.9, wet: opts.wet ?? 0.5 });
    });
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
    // OfflineAudioContext 没有实时恢复的概念，由 startRendering 驱动
    if (ctx.state === 'suspended' && !('startRendering' in (ctx as unknown as object))) {
      void ctx.resume();
    }

    if (!bypassDebounce) {
      const now = ctx.currentTime * 1000;
      const last = this.lastPlayed.get(name) ?? -1e9;
      if (now - last < 30) return;
      this.lastPlayed.set(name, now);
    }

    this.trim = TRIM[name] ?? 1;
    // 人性化：每次触发有极小的随机偏移，避免机械重复
    const t0 = ctx.currentTime + 0.005;
    const jitter = () => 1 + (Math.random() * 0.006 - 0.003);

    switch (name) {
      case 'click':
        this.wood(210 * jitter(), t0, { dur: 0.1, gain: 0.16, wet: 0.14 });
        break;
      case 'select':
        this.bell(392 * jitter(), t0, { dur: 1.1, gain: 0.07, wet: 0.5 });
        break;
      case 'toggle':
        this.bell(523.25 * jitter(), t0, { dur: 0.9, gain: 0.06, wet: 0.45 });
        break;
      case 'place':
        this.wood(150 * jitter(), t0, { dur: 0.16, gain: 0.2, wet: 0.2 });
        this.pluck(196, t0 + 0.005, { dur: 0.5, gain: 0.09, wet: 0.35 });
        break;
      case 'deal':
        for (let i = 0; i < 7; i++) {
          this.noiseHit(t0 + i * 0.042 + Math.random() * 0.01, {
            dur: 0.055,
            gain: 0.075,
            from: 1800 + Math.random() * 2200,
            to: 700,
            q: 1.5,
            pan: Math.random() * 0.8 - 0.4,
            wet: 0.2,
          });
        }
        break;
      case 'play':
        this.pluck(PENTATONIC[5], t0, { dur: 1.0, gain: 0.15, bright: 1.05 });
        break;
      case 'pass':
        this.wood(120, t0, { dur: 0.17, gain: 0.15, wet: 0.18 });
        this.noiseHit(t0 + 0.01, { dur: 0.16, gain: 0.05, from: 900, to: 260, q: 0.7, wet: 0.2 });
        break;
      case 'tribute':
        this.bell(440, t0, { dur: 1.7, gain: 0.09, wet: 0.6 });
        this.bell(659.25, t0 + 0.13, { dur: 1.7, gain: 0.075, wet: 0.6 });
        break;
      case 'bomb':
        this.gong(96, t0, { dur: 3.4, gain: 0.3 });
        this.gong(143, t0 + 0.012, { dur: 2.6, gain: 0.16, pan: 0.18 });
        this.noiseHit(t0, { dur: 0.42, gain: 0.2, from: 3600, to: 160, q: 0.5, wet: 0.45 });
        break;
      case 'win':
        this.melody([3, 4, 5, 7, 9], t0, 0.115, { gain: 0.13, bright: 1.1 });
        break;
      case 'lose':
        this.melody([7, 5, 4, 3, 1], t0, 0.135, { gain: 0.12, bright: 0.85 });
        break;
      case 'error':
        this.wood(132, t0, { dur: 0.12, gain: 0.16, wet: 0.12 });
        this.wood(110, t0 + 0.1, { dur: 0.16, gain: 0.13, wet: 0.12 });
        break;
    }
  }

  /**
   * 出牌音：按牌型挑音色与音高 —— 越大越"沉"，
   * 大牌型落低音（有分量），小牌型落高音（轻快）。
   */
  playCombo(combo: { type: string; cards: unknown[]; isBomb: boolean; power: number }): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.trim = 1;
    const t0 = ctx.currentTime + 0.005;

    if (combo.isBomb) {
      const isJoker = combo.type === 'JokerBomb';
      const isFlush = combo.type === 'StraightFlush';
      this.gong(isJoker ? 78 : isFlush ? 110 : 92, t0, { dur: isJoker ? 4 : 3.2, gain: 0.3 });
      if (isFlush) this.bell(587.33, t0 + 0.02, { dur: 2.4, gain: 0.1, wet: 0.65 });
      if (isJoker) this.bell(880, t0 + 0.03, { dur: 2.8, gain: 0.12, wet: 0.7 });
      this.noiseHit(t0, { dur: 0.45, gain: 0.2, from: 4200, to: 180, q: 0.5, wet: 0.45 });
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
    // 张数越多越低沉一点，听感上"分量"更足
    const shifted = Math.max(0, Math.min(PENTATONIC.length - 1, d - (n >= 5 ? 1 : 0)));
    // 增益按实测峰值反推：5 张牌型天然更响（音更低、分音更多），所以反而要给小一点，
    // 这样"单张 / 三带二 / 钢板"听感接近，而炸弹仍然明显最大。
    this.pluck(PENTATONIC[shifted] * (1 + (Math.random() * 0.006 - 0.003)), t0, {
      dur: n >= 5 ? 1.25 : 0.95,
      gain: n >= 5 ? 0.34 : 0.42,
      bright: n >= 5 ? 1.1 : 1,
    });
  }
}

export const sfx = new SoundEngine();
