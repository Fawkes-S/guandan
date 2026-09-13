import {
  BIG_JOKER_ORDER_VALUE,
  LEVEL_ORDER_VALUE,
  NORMAL_SUITS,
  RANK_A,
  RANK_BIG_JOKER,
  RANK_SMALL_JOKER,
  SMALL_JOKER_ORDER_VALUE,
  isJoker,
  isWild,
  type Card,
  type NormalSuit,
  type Suit,
} from './types';

/** 生成两副牌，共 108 张 */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let deck = 0; deck < 2; deck++) {
    const d = deck as 0 | 1;
    for (const suit of NORMAL_SUITS) {
      for (let rank = 2; rank <= RANK_A; rank++) {
        cards.push({ id: id++, suit, rank, deck: d });
      }
    }
    cards.push({ id: id++, suit: 'J', rank: RANK_SMALL_JOKER, deck: d });
    cards.push({ id: id++, suit: 'J', rank: RANK_BIG_JOKER, deck: d });
  }
  return cards;
}

/** 可复现随机数（mulberry32），便于测试与录像回放 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function rankText(rank: number): string {
  if (rank === RANK_SMALL_JOKER) return '小王';
  if (rank === RANK_BIG_JOKER) return '大王';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === RANK_A) return 'A';
  return String(rank);
}

/** 级数文本：11 → J，14 → A */
export function levelText(value: number): string {
  if (value === 11) return 'J';
  if (value === 12) return 'Q';
  if (value === 13) return 'K';
  if (value === 14) return 'A';
  return String(value);
}

/**
 * 比较用点数：大王 > 小王 > 级牌 > A > K > ... > 2
 */
export function orderValue(card: Card, level: number): number {
  if (card.rank === RANK_BIG_JOKER) return BIG_JOKER_ORDER_VALUE;
  if (card.rank === RANK_SMALL_JOKER) return SMALL_JOKER_ORDER_VALUE;
  if (card.rank === level) return LEVEL_ORDER_VALUE;
  return card.rank;
}

/** 由点数（非牌对象）换算比较用点数，用于三带二比较三同张等场景 */
export function rankOrderValue(rank: number, level: number): number {
  if (rank === RANK_BIG_JOKER) return BIG_JOKER_ORDER_VALUE;
  if (rank === RANK_SMALL_JOKER) return SMALL_JOKER_ORDER_VALUE;
  if (rank === level) return LEVEL_ORDER_VALUE;
  return rank;
}

/** 同点同花视为同一张牌（忽略副数），用于逢人配枚举去重 */
export function cardKey(card: Card): string {
  return `${card.suit}${card.rank}`;
}

export function sameFace(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** 手牌排序：按比较点数从大到小，同点按花色聚拢 */
export function sortCards(cards: readonly Card[], level: number): Card[] {
  const suitOrder: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3, J: 4 };
  return cards.slice().sort((a, b) => {
    const va = orderValue(a, level);
    const vb = orderValue(b, level);
    if (va !== vb) return vb - va;
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.id - b.id;
  });
}

/** 按自然点数从小到大（A 视为 14） */
export function sortByNaturalRank(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}

export function countWilds(cards: readonly Card[], level: number): number {
  return cards.filter((c) => isWild(c, level)).length;
}

/** 手中除逢人配外的最大牌（用于进贡） */
export function biggestNonWild(cards: readonly Card[], level: number): Card {
  const pool = cards.filter((c) => !isWild(c, level));
  const source = pool.length > 0 ? pool : cards;
  return source.reduce((best, c) => (orderValue(c, level) > orderValue(best, level) ? c : best));
}

export function makeCard(suit: Suit, rank: number, id = -1, deck: 0 | 1 = 0): Card {
  return { id, suit, rank, deck };
}

export function normalSuitOf(suit: Suit): NormalSuit {
  if (suit === 'J') throw new Error('王牌没有普通花色');
  return suit;
}

export function isSameCardSet(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a.map((c) => c.id));
  return b.every((c) => sa.has(c.id));
}

export { isJoker, isWild };
