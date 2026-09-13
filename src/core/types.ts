/**
 * 掼蛋核心数据结构定义。
 * 该文件不依赖任何运行时环境，可被 UI / AI / 测试直接引用。
 */

/** 花色：S 黑桃 / H 红桃 / D 方块 / C 梅花 / J 王 */
export type Suit = 'S' | 'H' | 'D' | 'C' | 'J';

export const NORMAL_SUITS = ['S', 'H', 'D', 'C'] as const;
export type NormalSuit = (typeof NORMAL_SUITS)[number];

export const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
  J: '★',
};

export const SUIT_NAME: Record<Suit, string> = {
  S: '黑桃',
  H: '红桃',
  D: '方块',
  C: '梅花',
  J: '王',
};

/** 2..14(A)，15 = 小王，16 = 大王 */
export const RANK_A = 14;
export const RANK_SMALL_JOKER = 15;
export const RANK_BIG_JOKER = 16;

/** 级牌在比较时的等效点数（大于 A、小于小王） */
export const LEVEL_ORDER_VALUE = 15;
export const SMALL_JOKER_ORDER_VALUE = 16;
export const BIG_JOKER_ORDER_VALUE = 17;

export interface Card {
  /** 全局唯一 id，0..107 */
  id: number;
  suit: Suit;
  /** 2..14(A)，15 = 小王，16 = 大王 */
  rank: number;
  /** 第几副牌（0 / 1） */
  deck: 0 | 1;
}

export enum ComboType {
  Single = 'Single',
  Pair = 'Pair',
  Triple = 'Triple',
  FullHouse = 'FullHouse',
  Straight = 'Straight',
  /** 三连对（木板） */
  Tube = 'Tube',
  /** 三连同张（钢板） */
  Plate = 'Plate',
  Bomb = 'Bomb',
  /** 同花顺 */
  StraightFlush = 'StraightFlush',
  /** 四大天王 */
  JokerBomb = 'JokerBomb',
}

export const COMBO_LABEL: Record<ComboType, string> = {
  [ComboType.Single]: '单张',
  [ComboType.Pair]: '对子',
  [ComboType.Triple]: '三同张',
  [ComboType.FullHouse]: '三带二',
  [ComboType.Straight]: '顺子',
  [ComboType.Tube]: '三连对',
  [ComboType.Plate]: '钢板',
  [ComboType.Bomb]: '炸弹',
  [ComboType.StraightFlush]: '同花顺',
  [ComboType.JokerBomb]: '四大天王',
};

/** 逢人配（红桃级牌）在某次出牌中被当作哪张牌使用 */
export interface WildAs {
  id: number;
  suit: NormalSuit;
  rank: number;
}

export interface Combo {
  type: ComboType;
  /** 实际打出的牌（真实手牌，逢人配保留原样） */
  cards: Card[];
  /**
   * 主牌比较点数：
   * - 单张/对子/三同张/三带二/炸弹 => 采用级牌规则换算后的点数
   * - 顺子/三连对/钢板/同花顺 => 取最大牌的自然点数（A2345 记 5）
   */
  rank: number;
  /** 跨类型压制力，仅炸弹有意义 */
  power: number;
  isBomb: boolean;
  label: string;
  /** 逢人配的扮演信息，用于 UI 展示 */
  wildAs?: WildAs[];
}

export function isJoker(card: Card): boolean {
  return card.rank >= RANK_SMALL_JOKER;
}

/** 是否为逢人配（红桃级牌） */
export function isWild(card: Card, level: number): boolean {
  return card.suit === 'H' && card.rank === level && level >= 2 && level <= RANK_A;
}

export function isWildCard(card: Card, level: number): boolean {
  return isWild(card, level);
}
