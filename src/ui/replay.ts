import type { PlayRecord } from '../core/engine';
import type { Card, Combo } from '../core/types';

export interface ReplayStep {
  index: number;
  player: number;
  cards: Card[];
  combo: Combo | null;
  /** 该步结束后各家剩余手牌数 */
  counts: number[];
  /** 该步结束后我的手牌（完整牌面） */
  myHand: Card[];
  /** 是否为新一轮的首出 */
  isTrickStart: boolean;
}

/**
 * 本局复盘：从"出牌阶段开始时的四家手牌"出发，按出牌记录逐步回放。
 * 只做重建，不修改引擎状态，因此可以随时退出。
 */
export class Replay {
  readonly steps: ReplayStep[] = [];
  readonly initialCounts: number[];
  readonly initialHands: Card[][];
  /** 观战模式下没有"我的手牌" */
  private readonly humanIndex: number;

  constructor(
    initialHands: readonly Card[][],
    human: number,
    history: readonly PlayRecord[],
  ) {
    this.humanIndex = human >= 0 && human < initialHands.length ? human : -1;
    const hands = initialHands.map((h) => h.slice());
    this.initialHands = hands.map((h) => h.slice());
    this.initialCounts = hands.map((h) => h.length);

    let passCount = 0;
    let needed = 0;
    history.forEach((rec, i) => {
      const ids = new Set(rec.cards.map((c) => c.id));
      hands[rec.player] = hands[rec.player].filter((c) => !ids.has(c.id));
      const counts = hands.map((h) => h.length);
      let isTrickStart = false;
      if (rec.combo === null) {
        passCount += 1;
      } else {
        isTrickStart = i === 0 || passCount >= needed;
        passCount = 0;
        const activeCount = counts.filter((n) => n > 0).length;
        needed = activeCount - (counts[rec.player] > 0 ? 1 : 0);
      }
      this.steps.push({
        index: i,
        player: rec.player,
        cards: rec.cards.slice(),
        combo: rec.combo,
        counts,
        myHand: this.humanIndex >= 0 ? hands[this.humanIndex].slice() : [],
        isTrickStart,
      });
    });
  }

  get length(): number {
    return this.steps.length;
  }

  step(index: number): ReplayStep | null {
    if (this.steps.length === 0) return null;
    const clamped = Math.max(0, Math.min(this.steps.length - 1, index));
    return this.steps[clamped];
  }

  /** 把出牌记录按「一手」分组，用于牌谱列表 */
  tricks(): ReplayStep[][] {
    const groups: ReplayStep[][] = [];
    for (const step of this.steps) {
      if (step.isTrickStart || groups.length === 0) groups.push([]);
      groups[groups.length - 1].push(step);
    }
    return groups;
  }
}
