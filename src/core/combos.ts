import {
  COMBO_LABEL,
  ComboType,
  RANK_A,
  RANK_BIG_JOKER,
  RANK_SMALL_JOKER,
  isJoker,
  isWild,
  type Card,
  type Combo,
  type NormalSuit,
  type WildAs,
} from './types';
import { orderValue, rankOrderValue } from './cards';
import { DEFAULT_RULES, type RuleConfig } from './rules';

/** 炸弹压制力：4 张 = 104 ... 10 张 = 110 */
export function bombPower(size: number): number {
  return 100 + size;
}

/** 同花顺 = 5.5 张炸弹 */
export const POWER_STRAIGHT_FLUSH = 105.5;
export const POWER_JOKER_BOMB = 1000;

export interface ClassifyOptions {
  rules?: RuleConfig;
}

function make(
  type: ComboType,
  cards: Card[],
  rank: number,
  power = 0,
): Combo {
  const isBomb =
    type === ComboType.Bomb || type === ComboType.StraightFlush || type === ComboType.JokerBomb;
  return { type, cards, rank, power, isBomb, label: COMBO_LABEL[type] };
}

function groupByRank(cards: readonly Card[]): Map<number, Card[]> {
  const map = new Map<number, Card[]>();
  for (const c of cards) {
    const list = map.get(c.rank);
    if (list) list.push(c);
    else map.set(c.rank, [c]);
  }
  return map;
}

/**
 * 判断一组互不相同的自然点数是否连续，返回"最大点数"。
 * A 可作 1 时，A2345 返回 5；10JQKA 走常规分支返回 14。
 */
export function consecutiveTop(ranks: readonly number[], allowAceLow: boolean): number | null {
  const uniq = Array.from(new Set(ranks)).sort((a, b) => a - b);
  if (uniq.length !== ranks.length || uniq.length === 0) return null;
  if (uniq[uniq.length - 1] - uniq[0] === uniq.length - 1) return uniq[uniq.length - 1];
  if (allowAceLow && uniq[uniq.length - 1] === RANK_A) {
    const low = uniq.map((r) => (r === RANK_A ? 1 : r)).sort((a, b) => a - b);
    if (low[low.length - 1] - low[0] === low.length - 1) return low[low.length - 1];
  }
  return null;
}

/**
 * 识别一手"已解析"的牌（逢人配已被替换成具体牌）属于哪种牌型。
 * 返回 null 表示不是合法牌型。
 */
export function classify(cards: readonly Card[], level: number, opts: ClassifyOptions = {}): Combo | null {
  const rules = opts.rules ?? DEFAULT_RULES;
  const list = cards.slice();
  const n = list.length;
  if (n === 0) return null;

  const jokers = list.filter(isJoker);
  if (jokers.length > 0) {
    if (n === 1) {
      return make(ComboType.Single, list, orderValue(list[0], level));
    }
    // 王牌不能与普通牌混合成牌型
    if (jokers.length !== n) return null;
    const sameRank = jokers.every((c) => c.rank === jokers[0].rank);
    if (n === 2 && sameRank) return make(ComboType.Pair, list, orderValue(jokers[0], level));
    if (n === 4) {
      const small = jokers.filter((c) => c.rank === RANK_SMALL_JOKER).length;
      const big = jokers.filter((c) => c.rank === RANK_BIG_JOKER).length;
      if (small === 2 && big === 2) {
        return make(ComboType.JokerBomb, list, RANK_BIG_JOKER, POWER_JOKER_BOMB);
      }
    }
    return null;
  }

  const groups = groupByRank(list);
  const ranks = Array.from(groups.keys()).sort((a, b) => a - b);
  const counts = ranks.map((r) => groups.get(r)!.length).sort((a, b) => b - a);

  // 同点：单张 / 对子 / 三同张 / 炸弹
  if (ranks.length === 1) {
    const r = ranks[0];
    const value = rankOrderValue(r, level);
    if (n === 1) return make(ComboType.Single, list, value);
    if (n === 2) return make(ComboType.Pair, list, value);
    if (n === 3) return make(ComboType.Triple, list, value);
    if (n >= 4 && n <= rules.bombMaxSize) {
      return make(ComboType.Bomb, list, value, bombPower(n));
    }
    return null;
  }

  if (n === 5) {
    // 三带二
    if (counts.length === 2 && counts[0] === 3 && counts[1] === 2) {
      const tripleRank = ranks.find((r) => groups.get(r)!.length === 3)!;
      return make(ComboType.FullHouse, list, rankOrderValue(tripleRank, level));
    }
    // 顺子 / 同花顺
    if (ranks.length === 5) {
      const top = consecutiveTop(ranks, rules.allowAceLowInStraight);
      if (top !== null) {
        const flush = list.every((c) => c.suit === list[0].suit);
        if (flush) {
          const power = rules.straightFlushBetween5And6 ? POWER_STRAIGHT_FLUSH : bombPower(5);
          return make(ComboType.StraightFlush, list, top, power);
        }
        return make(ComboType.Straight, list, top);
      }
    }
    return null;
  }

  if (n === 6) {
    // 钢板：两个连续三同张
    if (ranks.length === 2 && counts[0] === 3 && counts[1] === 3) {
      const top = consecutiveTop(ranks, rules.allowAceLowInTubePlate);
      if (top !== null) return make(ComboType.Plate, list, top);
      return null;
    }
    // 三连对（木板）
    if (ranks.length === 3 && counts.every((c) => c === 2)) {
      const top = consecutiveTop(ranks, rules.allowAceLowInTubePlate);
      if (top !== null) return make(ComboType.Tube, list, top);
      return null;
    }
    return null;
  }

  return null;
}

/** 牌型去重键：同型、同张数、同主牌点视为同一解释 */
export function comboKey(combo: Combo): string {
  return `${combo.type}|${combo.cards.length}|${combo.rank}|${combo.power}`;
}

export function comboText(combo: Combo): string {
  return combo.label;
}

const detectCache = new Map<string, Combo[]>();
const DETECT_CACHE_MAX = 20000;

function cacheKey(cards: readonly Card[], level: number): string {
  const ids = cards
    .map((c) => c.id)
    .sort((a, b) => a - b)
    .join(',');
  return `${level}:${ids}`;
}

/**
 * 识别任意一手选中牌的所有合法解释（考虑逢人配）。
 *
 * 结果按（压制力, 主牌点数）升序排列；无逢人配时通常只有一个解释。
 */
export function detectCombos(
  cards: readonly Card[],
  level: number,
  opts: ClassifyOptions = {},
): Combo[] {
  const key = cacheKey(cards, level);
  const cached = detectCache.get(key);
  if (cached) return cached;

  const found = new Map<string, Combo>();
  const push = (combo: Combo | null, wildAs?: WildAs[]) => {
    if (!combo) return;
    if (wildAs && wildAs.length > 0) combo.wildAs = wildAs;
    const k = comboKey(combo);
    if (!found.has(k)) found.set(k, combo);
  };

  push(classify(cards, level, opts));

  const wilds = cards.filter((c) => isWild(c, level));
  if (wilds.length > 0) {
    const others = cards.filter((c) => !isWild(c, level));
    const suitSet = new Set<NormalSuit>();
    for (const c of others) if (c.suit !== 'J') suitSet.add(c.suit);
    suitSet.add('S');
    suitSet.add('H');
    const suits = Array.from(suitSet);
    const ranks: number[] = [];
    for (let r = 2; r <= RANK_A; r++) ranks.push(r);

    const assign = (index: number, acc: WildAs[]) => {
      if (index === wilds.length) {
        const resolved: Card[] = [];
        let wi = 0;
        for (const c of cards) {
          if (isWild(c, level)) {
            const a = acc[wi++];
            resolved.push({ id: c.id, suit: a.suit, rank: a.rank, deck: c.deck });
          } else {
            resolved.push(c);
          }
        }
        const combo = classify(resolved, level, opts);
        if (combo) push(combo, acc.slice());
        return;
      }
      for (const r of ranks) {
        for (const s of suits) {
          acc.push({ id: wilds[index].id, suit: s, rank: r });
          assign(index + 1, acc);
          acc.pop();
        }
      }
    };
    assign(0, []);
  }

  const result = Array.from(found.values()).sort((a, b) => a.power - b.power || a.rank - b.rank);
  if (detectCache.size > DETECT_CACHE_MAX) detectCache.clear();
  detectCache.set(key, result);
  return result;
}

/** 清理识别缓存（换局时调用） */
export function clearDetectCache(): void {
  detectCache.clear();
}
