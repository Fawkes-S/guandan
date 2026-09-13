import { ComboType, isWild, type Card, type Combo } from './types';
import { rankOrderValue } from './cards';
import { detectCombos } from './combos';
import { beats, byStrength, pickStrongest } from './compare';
import { DEFAULT_RULES, type RuleConfig } from './rules';

/** 一手牌的结构化视图 */
export interface HandModel {
  level: number;
  /** 非逢人配、非王的普通牌，按自然点数分组 */
  byRank: Map<number, Card[]>;
  /** 逢人配（红桃级牌） */
  wilds: Card[];
  smallJokers: Card[];
  bigJokers: Card[];
}

export interface PlayOption {
  cards: Card[];
  combo: Combo;
}

export function buildModel(hand: readonly Card[], level: number): HandModel {
  const byRank = new Map<number, Card[]>();
  const wilds: Card[] = [];
  const smallJokers: Card[] = [];
  const bigJokers: Card[] = [];
  for (const c of hand) {
    if (isWild(c, level)) {
      wilds.push(c);
      continue;
    }
    if (c.rank === 15) {
      smallJokers.push(c);
      continue;
    }
    if (c.rank === 16) {
      bigJokers.push(c);
      continue;
    }
    const list = byRank.get(c.rank);
    if (list) list.push(c);
    else byRank.set(c.rank, [c]);
  }
  return { level, byRank, wilds, smallJokers, bigJokers };
}

/**
 * 某点数最多能凑出的张数（自然牌 + 可作替代的逢人配）。
 * 这是上界，实际能否凑齐由 allocRanks 精确校验。
 */
export function rankCount(model: HandModel, rank: number): number {
  const n = model.byRank.get(rank)?.length ?? 0;
  return n + model.wilds.length;
}

interface Expect {
  type?: ComboType;
  rank?: number;
}

/** 生成连续点数窗口；A 作 1 时以 14 表示，top 为窗口最大点数 */
export function rankWindows(
  len: number,
  allowAceLow: boolean,
): Array<{ ranks: number[]; top: number }> {
  const out: Array<{ ranks: number[]; top: number }> = [];
  for (let start = 1; start + len - 1 <= 14; start++) {
    if (start === 1 && !allowAceLow) continue;
    const ranks: number[] = [];
    for (let k = 0; k < len; k++) {
      const v = start + k;
      ranks.push(v === 1 ? 14 : v);
    }
    out.push({ ranks, top: start + len - 1 });
  }
  return out;
}

/** 从手中取出满足各点数需求的牌，缺口用逢人配补；失败返回 null */
function allocRanks(model: HandModel, needs: Array<[number, number]>): Card[] | null {
  const used = new Set<number>();
  const out: Card[] = [];
  let shortage = 0;
  for (const [rank, need] of needs) {
    const pool: Card[] = [];
    for (const c of model.byRank.get(rank) ?? []) if (!used.has(c.id)) pool.push(c);
    if (rank === model.level) {
      for (const w of model.wilds) if (!used.has(w.id)) pool.push(w);
    }
    let taken = 0;
    for (const c of pool) {
      if (taken >= need) break;
      used.add(c.id);
      out.push(c);
      taken++;
    }
    shortage += need - taken;
  }
  const free = model.wilds.filter((w) => !used.has(w.id));
  if (shortage > free.length) return null;
  for (let i = 0; i < shortage; i++) {
    used.add(free[i].id);
    out.push(free[i]);
  }
  return out;
}

/** 同花顺专用：按花色取牌，缺口用逢人配补 */
function allocFlush(model: HandModel, suit: Card['suit'], ranks: number[]): Card[] | null {
  const used = new Set<number>();
  const out: Card[] = [];
  let shortage = 0;
  for (const rank of ranks) {
    const found = (model.byRank.get(rank) ?? []).find((c) => c.suit === suit && !used.has(c.id));
    if (found) {
      used.add(found.id);
      out.push(found);
    } else {
      shortage++;
    }
  }
  const free = model.wilds.filter((w) => !used.has(w.id));
  if (shortage > free.length) return null;
  for (let i = 0; i < shortage; i++) {
    used.add(free[i].id);
    out.push(free[i]);
  }
  return out;
}

function withinBombLimit(size: number, rules: RuleConfig): boolean {
  return size >= 4 && size <= rules.bombMaxSize;
}

function idsKey(cards: readonly Card[]): string {
  return cards
    .map((c) => c.id)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * 枚举一手牌所有合法出牌。
 * - `target` 为 null 表示首出，枚举尽量全面的候选
 * - `target` 非 null 表示跟牌，只枚举能压过它的候选（含炸弹）
 *
 * AI 决策与「提示」功能共用此函数。
 */
export function enumeratePlays(
  hand: readonly Card[],
  level: number,
  target: Combo | null = null,
  rules: RuleConfig = DEFAULT_RULES,
): PlayOption[] {
  if (target && target.type === ComboType.JokerBomb) return [];
  const model = buildModel(hand, level);
  const raws: Array<{ cards: Card[]; expect: Expect }> = [];
  const push = (cards: Card[] | null, expect: Expect) => {
    if (cards && cards.length > 0) raws.push({ cards, expect });
  };

  const following = target !== null;
  const normalType = target && !target.isBomb ? target.type : null;
  const normalSize = target ? target.cards.length : 0;
  const normalRank = target ? target.rank : -1;

  const wants = (type: ComboType, size: number): boolean => {
    if (!following) return true;
    if (!normalType) return false; // 目标是炸弹时只找炸弹
    return normalType === type && normalSize === size;
  };

  const allRanks: number[] = [];
  for (let r = 2; r <= 14; r++) allRanks.push(r);

  // ---------- 单张 ----------
  if (wants(ComboType.Single, 1)) {
    for (const rank of allRanks) {
      const pool = model.byRank.get(rank);
      if (!pool || pool.length === 0) continue;
      if (following && rankOrderValue(rank, level) <= normalRank) continue;
      push([pool[0]], { type: ComboType.Single, rank: rankOrderValue(rank, level) });
    }
    for (const w of model.wilds) {
      const v = rankOrderValue(level, level);
      if (following && v <= normalRank) continue;
      push([w], { type: ComboType.Single, rank: v });
    }
    for (const c of [...model.smallJokers, ...model.bigJokers]) {
      push([c], { type: ComboType.Single, rank: rankOrderValue(c.rank, level) });
    }
  }

  // ---------- 对子 / 三同张 / 炸弹 ----------
  for (const size of [2, 3]) {
    if (!wants(size === 2 ? ComboType.Pair : ComboType.Triple, size)) continue;
    for (const rank of allRanks) {
      if (rankCount(model, rank) < size) continue;
      const v = rankOrderValue(rank, level);
      if (following && v <= normalRank) continue;
      push(allocRanks(model, [[rank, size]]), {
        type: size === 2 ? ComboType.Pair : ComboType.Triple,
        rank: v,
      });
    }
  }
  // 王牌对子
  if (wants(ComboType.Pair, 2)) {
    for (const group of [model.smallJokers, model.bigJokers]) {
      if (group.length < 2) continue;
      const v = rankOrderValue(group[0].rank, level);
      if (following && v <= normalRank) continue;
      push([group[0], group[1]], { type: ComboType.Pair, rank: v });
    }
  }

  // 炸弹
  for (const rank of allRanks) {
    const maxSize = Math.min(rankCount(model, rank), rules.bombMaxSize);
    for (let size = 4; size <= maxSize; size++) {
      if (!withinBombLimit(size, rules)) continue;
      push(allocRanks(model, [[rank, size]]), {
        type: ComboType.Bomb,
        rank: rankOrderValue(rank, level),
      });
    }
  }
  if (model.smallJokers.length >= 2 && model.bigJokers.length >= 2) {
    push([...model.smallJokers.slice(0, 2), ...model.bigJokers.slice(0, 2)], {
      type: ComboType.JokerBomb,
    });
  }

  // ---------- 三带二 ----------
  if (wants(ComboType.FullHouse, 5)) {
    for (const tripleRank of allRanks) {
      if (rankCount(model, tripleRank) < 3) continue;
      const tv = rankOrderValue(tripleRank, level);
      if (following && tv <= normalRank) continue;
      for (const pairRank of allRanks) {
        if (pairRank === tripleRank) continue;
        if (rankCount(model, pairRank) < 2) continue;
        push(allocRanks(model, [[tripleRank, 3], [pairRank, 2]]), {
          type: ComboType.FullHouse,
          rank: tv,
        });
      }
    }
  }

  // ---------- 顺子 / 同花顺 ----------
  if (wants(ComboType.Straight, 5)) {
    for (const w of rankWindows(5, rules.allowAceLowInStraight)) {
      if (following && normalType === ComboType.Straight && w.top <= normalRank) continue;
      const needs = w.ranks.map((r) => [r, 1] as [number, number]);
      push(allocRanks(model, needs), { type: ComboType.Straight, rank: w.top });
    }
  }
  {
    const suits: Array<Card['suit']> = [];
    for (const c of model.byRank.values()) {
      for (const card of c) if (!suits.includes(card.suit)) suits.push(card.suit);
    }
    for (const suit of suits) {
      for (const w of rankWindows(5, rules.allowAceLowInStraight)) {
        if (following && normalType === ComboType.StraightFlush && w.top <= normalRank) continue;
        push(allocFlush(model, suit, w.ranks), { type: ComboType.StraightFlush, rank: w.top });
      }
    }
  }

  // ---------- 三连对（木板） ----------
  if (wants(ComboType.Tube, 6)) {
    for (const w of rankWindows(3, rules.allowAceLowInTubePlate)) {
      if (following && w.top <= normalRank) continue;
      const needs = w.ranks.map((r) => [r, 2] as [number, number]);
      push(allocRanks(model, needs), { type: ComboType.Tube, rank: w.top });
    }
  }

  // ---------- 钢板 ----------
  if (wants(ComboType.Plate, 6)) {
    for (const w of rankWindows(2, rules.allowAceLowInTubePlate)) {
      if (following && w.top <= normalRank) continue;
      const needs = w.ranks.map((r) => [r, 3] as [number, number]);
      push(allocRanks(model, needs), { type: ComboType.Plate, rank: w.top });
    }
  }

  // ---------- 统一解释并过滤 ----------
  const options: PlayOption[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const combos = detectCombos(raw.cards, level, { rules });
    let pool = raw.expect.type ? combos.filter((c) => c.type === raw.expect.type) : combos;
    if (pool.length === 0) pool = combos;
    if (pool.length === 0) continue;

    // 手牌固定时，最强的解释永远不劣于最弱的 —— 与 validatePlay 保持一致
    let chosen: Combo | null;
    if (target) {
      chosen = pickStrongest(pool.filter((c) => beats(c, target)));
      if (!chosen) continue;
    } else {
      const exact = pool.filter((c) => c.rank === raw.expect.rank);
      chosen = pickStrongest(exact.length > 0 ? exact : pool);
      if (!chosen) continue;
    }

    const key = `${idsKey(chosen.cards)}#${chosen.type}|${chosen.rank}|${chosen.power}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ cards: chosen.cards, combo: chosen });
  }

  // 同一个牌型可能从不同生成路径得到多个解释（例如顺子 / 同花顺），
  // 只保留最强的那个，与 validatePlay 保持一致。
  const byCards = new Map<string, PlayOption>();
  for (const opt of options) {
    const key = idsKey(opt.cards);
    const prev = byCards.get(key);
    if (
      !prev ||
      opt.combo.power > prev.combo.power ||
      (opt.combo.power === prev.combo.power && opt.combo.rank > prev.combo.rank)
    ) {
      byCards.set(key, opt);
    }
  }
  const unique = Array.from(byCards.values());
  unique.sort((a, b) => byStrength(a.combo, b.combo) || a.cards.length - b.cards.length);
  return unique;
}

/** 校验一手牌是否为合法出牌（供 UI 使用） */
export function validatePlay(
  hand: readonly Card[],
  cards: readonly Card[],
  level: number,
  target: Combo | null,
  rules: RuleConfig = DEFAULT_RULES,
): { ok: true; combo: Combo } | { ok: false; reason: string } {
  if (cards.length === 0) return { ok: false, reason: '请先选牌' };
  const handIds = new Set(hand.map((c) => c.id));
  const seen = new Set<number>();
  for (const c of cards) {
    if (!handIds.has(c.id)) return { ok: false, reason: '所选牌不在手牌中' };
    if (seen.has(c.id)) return { ok: false, reason: '重复选择了同一张牌' };
    seen.add(c.id);
  }
  const combos = detectCombos(cards, level, { rules });
  if (combos.length === 0) return { ok: false, reason: '不是合法牌型' };
  if (!target) {
    const best = pickStrongest(combos);
    if (!best) return { ok: false, reason: '不是合法牌型' };
    return { ok: true, combo: best };
  }
  const beating = pickStrongest(combos.filter((c) => beats(c, target)));
  if (!beating) {
    return { ok: false, reason: `压不过上家的${target.label}` };
  }
  return { ok: true, combo: beating };
}

/** 猜一手牌的所有解释（UI 歧义选择器用） */
export function explainCards(
  cards: readonly Card[],
  level: number,
  target: Combo | null,
  rules: RuleConfig = DEFAULT_RULES,
): Combo[] {
  const combos = detectCombos(cards, level, { rules });
  const valid = target ? combos.filter((c) => beats(c, target)) : combos;
  return valid.sort(byStrength);
}

export { rankOrderValue };
