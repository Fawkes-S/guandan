import { rankText } from './cards';
import { enumeratePlays } from './candidates';
import { detectCombos } from './combos';
import { DEFAULT_RULES, type RuleConfig } from './rules';
import { ComboType, isWild, type Card, type Combo } from './types';

/** 手牌分组：用于「按牌型」理牌视图 */
export interface HandGroup {
  kind: ComboType | 'wild' | 'single';
  label: string;
  cards: Card[];
}

/** 牌型优先级：数字越大越先被拆出来 */
const TYPE_BONUS: Partial<Record<ComboType, number>> = {
  [ComboType.JokerBomb]: 60,
  [ComboType.Bomb]: 40,
  [ComboType.StraightFlush]: 40,
  [ComboType.Plate]: 12,
  [ComboType.Tube]: 10,
  [ComboType.Straight]: 6,
  [ComboType.FullHouse]: 4,
  [ComboType.Triple]: 0,
  [ComboType.Pair]: 0,
};

function rankOfTriple(cards: readonly Card[]): number {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  let best = cards[0].rank;
  let bestN = 0;
  for (const [r, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = r;
    }
  }
  return best;
}

function rankOfPair(cards: readonly Card[]): number {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  for (const [r, n] of counts) if (n === 2) return r;
  return cards[cards.length - 1].rank;
}

/** 连续牌型（顺子 / 三连对 / 钢板）的起止点数文本 */
function runRange(combo: Combo, distinct: number): string {
  const bottom = combo.rank - (distinct - 1);
  const low = bottom === 1 ? 'A' : rankText(bottom);
  return `${low}–${rankText(combo.rank)}`;
}

export function labelForCombo(combo: Combo): string {
  const n = combo.cards.length;
  switch (combo.type) {
    case ComboType.JokerBomb:
      return '四大天王';
    case ComboType.Bomb:
      return `炸弹 ${rankText(rankOfTriple(combo.cards))}×${n}`;
    case ComboType.StraightFlush:
      return `同花顺 ${runRange(combo, 5)}`;
    case ComboType.Straight:
      return `顺子 ${runRange(combo, 5)}`;
    case ComboType.Tube:
      return `三连对 ${runRange(combo, 3)}`;
    case ComboType.Plate:
      return `钢板 ${runRange(combo, 2)}`;
    case ComboType.FullHouse:
      return `三带二 ${rankText(rankOfTriple(combo.cards))}带${rankText(rankOfPair(combo.cards))}`;
    case ComboType.Triple:
      return `三张 ${rankText(combo.cards[0].rank)}`;
    case ComboType.Pair:
      return `对子 ${rankText(combo.cards[0].rank)}`;
    case ComboType.Single:
      return `单张 ${rankText(combo.cards[0].rank)}`;
    default:
      return combo.label;
  }
}

/**
 * 把一手牌拆成「看得懂的几块」。
 *
 * 做法：先枚举一次全部合法出牌，再在这份候选表上做贪心集合覆盖
 * （炸弹整体保留、优先长牌型、尽量少消耗逢人配），最后把剩余的
 * 牌归成 三张 / 对子 / 散张 / 逢人配。
 *
 * 只调用一次 `enumeratePlays`，27 张手牌大约几毫秒，可以随出牌实时重算。
 */
export function splitHand(
  hand: readonly Card[],
  level: number,
  rules: RuleConfig = DEFAULT_RULES,
): HandGroup[] {
  if (hand.length === 0) return [];
  const options = enumeratePlays(hand, level, null, rules);

  const used = new Set<number>();
  type Candidate = { combo: Combo; score: number };
  const picked: Candidate[] = [];

  // 候选打分：张数为主，炸弹额外加权（保持完整），逢人配扣分（留给关键牌型）
  const scored: Candidate[] = [];
  for (const o of options) {
    const n = o.cards.length;
    if (n < 2) continue;
    let score = n * 100;
    score += TYPE_BONUS[o.combo.type] ?? 0;
    if (o.combo.isBomb) score += 400;
    if (n >= 5) score += 20;
    const wilds = o.cards.filter((c) => isWild(c, level)).length;
    score -= wilds * 45;
    scored.push({ combo: o.combo, score });
  }
  scored.sort((a, b) => b.score - a.score);

  for (const cand of scored) {
    if (cand.combo.cards.some((c) => used.has(c.id))) continue;
    if (cand.score <= 0) break;
    picked.push(cand);
    for (const c of cand.combo.cards) used.add(c.id);
  }

  const groups: HandGroup[] = picked.map((p) => ({
    kind: p.combo.type,
    label: labelForCombo(p.combo),
    cards: p.combo.cards.slice(),
  }));

  // 剩余的牌：逢人配单列，其余按张数归组
  const rest = hand.filter((c) => !used.has(c.id));
  const wilds = rest.filter((c) => isWild(c, level));
  const others = rest.filter((c) => !isWild(c, level));

  const byRank = new Map<number, Card[]>();
  for (const c of others) {
    const list = byRank.get(c.rank);
    if (list) list.push(c);
    else byRank.set(c.rank, [c]);
  }
  const triples: Card[][] = [];
  const pairs: Card[][] = [];
  const singles: Card[] = [];
  for (const [, cards] of byRank) {
    let i = 0;
    while (i + 3 <= cards.length) {
      triples.push(cards.slice(i, i + 3));
      i += 3;
    }
    if (i + 2 <= cards.length) {
      pairs.push(cards.slice(i, i + 2));
      i += 2;
    }
    for (; i < cards.length; i++) singles.push(cards[i]);
  }

  for (const t of triples) {
    groups.push({ kind: ComboType.Triple, label: `三张 ${rankText(t[0].rank)}`, cards: t });
  }
  for (const p of pairs) {
    groups.push({ kind: ComboType.Pair, label: `对子 ${rankText(p[0].rank)}`, cards: p });
  }
  if (singles.length > 0) {
    groups.push({ kind: 'single', label: `散张 ${singles.length}`, cards: singles });
  }
  if (wilds.length > 0) {
    groups.push({ kind: 'wild', label: '逢人配', cards: wilds });
  }
  return groups;
}

/**
 * 按一组牌的实际内容推导标签。
 * 玩家手工拖动 / 成组之后，标签会跟着内容重算，不会再出现"名字和牌对不上"的情况。
 */
export function labelForCards(
  cards: readonly Card[],
  level: number,
  rules: RuleConfig = DEFAULT_RULES,
): string {
  if (cards.length === 0) return '';
  if (cards.length === 1) return `单张 ${rankText(cards[0].rank)}`;
  const combos = detectCombos(cards, level, { rules });
  if (combos.length === 0) return `${cards.length} 张`;
  const best = combos.slice().sort((a, b) => {
    const ta = TYPE_BONUS[a.type] ?? 0;
    const tb = TYPE_BONUS[b.type] ?? 0;
    if (ta !== tb) return tb - ta;
    return b.cards.length - a.cards.length;
  })[0];
  return labelForCombo(best);
}
