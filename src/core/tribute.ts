import { biggestNonWild, orderValue } from './cards';
import type { Card } from './types';
import type { RuleConfig } from './rules';

/**
 * 进贡 / 还贡 / 抗贡 的规则计算。
 * 具体的状态迁移由 engine 负责，这里只提供"该谁进贡、进给谁、先出牌的是谁"。
 */

export interface TributePlan {
  /** none = 本局无进贡；single = 单人进贡；double = 双下两人进贡 */
  kind: 'none' | 'single' | 'double';
  /** 头游 */
  head: number;
  /** 输方玩家（按名次） */
  losers: number[];
  /** 单贡时的进贡者 */
  payer: number | null;
  /** 抗贡者（若抗贡则为输方玩家，否则为空数组） */
  antiTribute: number[];
  /** 抗贡或双贡时，由谁先出牌（双贡需比较贡牌后再定） */
  firstPlayer: number;
}

/** 依据上一局名次计算进贡方案（不含抗贡判定所需的牌面信息） */
export function planTribute(finishOrder: readonly number[], head: number): TributePlan {
  const headTeam = head % 2;
  const losers = finishOrder.filter((p) => p % 2 !== headTeam);
  const partnerPos = finishOrder.indexOf((head + 2) % 4);
  const isDouble = partnerPos === 1;
  if (isDouble) {
    return {
      kind: 'double',
      head,
      losers,
      payer: null,
      antiTribute: [],
      firstPlayer: head,
    };
  }
  const payer = losers.reduce((a, b) =>
    finishOrder.indexOf(a) > finishOrder.indexOf(b) ? a : b,
  );
  return {
    kind: 'single',
    head,
    losers,
    payer,
    antiTribute: [],
    firstPlayer: payer,
  };
}

/** 进贡牌：手中除红桃级牌（逢人配）外的最大牌，无选择余地 */
export function tributeCard(hand: readonly Card[], level: number): Card {
  return biggestNonWild(hand, level);
}

/**
 * 抗贡判定：需要进贡的一方手中有两张大王即可抗贡。
 * 单贡看进贡者本人，双贡看两名输方合计。
 */
export function canAntiTribute(
  hands: ReadonlyArray<readonly Card[]>,
  players: readonly number[],
): boolean {
  let count = 0;
  for (const p of players) {
    count += hands[p].filter((c) => c.rank === 16).length;
  }
  return count >= 2;
}

/** 还贡候选：自然点数不大于上限的牌；若一张都没有则可用任意牌 */
export function returnCandidates(
  hand: readonly Card[],
  rules: RuleConfig,
): Card[] {
  const ok = hand.filter((c) => c.rank <= rules.tributeReturnMaxRank && c.rank < 15);
  if (ok.length > 0) return ok;
  return hand.slice();
}

/** 比较两张贡牌，返回较大者所属的进贡者下标（0 或 1） */
export function biggerTributeIndex(cards: readonly Card[], level: number): number {
  return orderValue(cards[0], level) >= orderValue(cards[1], level) ? 0 : 1;
}
