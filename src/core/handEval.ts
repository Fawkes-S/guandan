import { orderValue, rankOrderValue } from './cards';
import { DEFAULT_RULES, type RuleConfig } from './rules';
import { ComboType, isWild, type Card } from './types';

/**
 * 手牌估值：估算"还需要多少手才能出完"，以及控制力。
 * 用于 AI 比较不同出牌方案后的手牌质量。
 *
 * 结构：
 *  - 贪心拆分（greedyDecompose）给出一个稳定上界，同时用于大牌（> 14 张）的快速估值；
 *  - 牌数 ≤ 14 时用带记忆化 + 节点预算的精确搜索（solveExact）求最小手数；
 *  - 逢人配（红桃级牌）会参与顺子 / 炸弹 / 对子等各种组合，不再只做简单的"补对子"。
 */
export interface HandValue {
  /** 估计最少手数（越小越好） */
  hands: number;
  /** 拆分后剩下的单张数量（负担） */
  singles: number;
  /** 控制力：王、级牌、A、炸弹等大概率能拿回出牌权的牌 */
  control: number;
  /** 炸弹数量（含逢人配补成） */
  bombs: number;
  /** 手中逢人配数量 */
  wilds: number;
  /** 综合评分：越小手牌越"好出" */
  score: number;
  /** 是否使用了精确搜索（牌数 ≤ EXACT_LIMIT） */
  exact: boolean;
  /** 精确搜索访问的状态数（调试 / 基准用） */
  nodes: number;
}

const RANKS = 13; // 自然点数 2..14(A)
const SMALL_JOKER = 15;
const BIG_JOKER = 16;

/** 牌数不超过该值时启用精确搜索 */
export const EXACT_LIMIT = 14;
/** 单次精确搜索的状态预算，超预算即回退贪心上界，保证不会爆掉 */
export const SEARCH_NODE_BUDGET = 20000;

interface CState {
  /** 自然点数计数，下标 = rank - 2 */
  c: number[];
  sj: number;
  bj: number;
  w: number;
}

function emptyState(): CState {
  return { c: new Array<number>(RANKS).fill(0), sj: 0, bj: 0, w: 0 };
}

function cloneState(s: CState): CState {
  return { c: s.c.slice(), sj: s.sj, bj: s.bj, w: s.w };
}

function totalCards(s: CState): number {
  let n = s.sj + s.bj + s.w;
  for (let i = 0; i < RANKS; i++) n += s.c[i];
  return n;
}

function stateSignature(s: CState): string {
  let out = '';
  for (let i = 0; i < RANKS; i++) out += String.fromCharCode(65 + s.c[i]);
  return out
    .concat(String.fromCharCode(65 + s.sj, 65 + s.bj, 65 + s.w));
}

function countsFromHand(hand: readonly Card[], level: number): CState {
  const s = emptyState();
  for (const card of hand) {
    if (isWild(card, level)) {
      s.w += 1;
      continue;
    }
    if (card.rank === SMALL_JOKER) {
      s.sj += 1;
      continue;
    }
    if (card.rank === BIG_JOKER) {
      s.bj += 1;
      continue;
    }
    s.c[card.rank - 2] += 1;
  }
  return s;
}

function isBombType(type: ComboType): boolean {
  return (
    type === ComboType.Bomb ||
    type === ComboType.StraightFlush ||
    type === ComboType.JokerBomb
  );
}

const windowCache = new Map<string, number[][]>();

/** 连续点数窗口；A 作 1 时以 14 表示（与 candidates.rankWindows 一致） */
function windowsOf(len: number, allowAceLow: boolean): number[][] {
  const key = `${len}|${allowAceLow ? 1 : 0}`;
  const hit = windowCache.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  for (let start = 1; start + len - 1 <= 14; start++) {
    if (start === 1 && !allowAceLow) continue;
    const ranks: number[] = [];
    for (let k = 0; k < len; k++) {
      const v = start + k;
      ranks.push(v === 1 ? 14 : v);
    }
    out.push(ranks);
  }
  windowCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- 贪心拆分

interface Decomp {
  hands: number;
  singles: number;
  bombs: number;
}

/**
 * 贪心提取连续牌型（钢板 / 三连对 / 顺子）。
 * 返回提取数量；逢人配可以用来补缺口，但缺口越贵越不划算。
 */
function takeWindows(
  s: CState,
  len: number,
  need: number,
  allowAceLow: boolean,
  wildPenalty: number,
  threshold: number,
): number {
  let used = 0;
  let guard = 0;
  while (guard++ < 5) {
    let best: { ranks: number[]; wilds: number; cost: number } | null = null;
    for (const ranks of windowsOf(len, allowAceLow)) {
      let cost = 0;
      let wilds = 0;
      for (const rank of ranks) {
        const have = s.c[rank - 2];
        if (have >= need) {
          cost += (have - need) * 3;
        } else if (have > 0) {
          wilds += need - have;
          cost += 1;
        } else {
          wilds += need;
          cost += wildPenalty;
        }
      }
      if (wilds > s.w) continue;
      cost += wilds * 2;
      if (best === null || cost < best.cost) best = { ranks, wilds, cost };
    }
    if (best === null || best.cost > threshold) break;
    for (const rank of best.ranks) {
      const idx = rank - 2;
      s.c[idx] -= Math.min(need, s.c[idx]);
    }
    s.w -= best.wilds;
    used += 1;
  }
  return used;
}

/** 贪心拆分：王 → 炸弹 → 钢板 → 三连对 → 顺子 → 三带二 → 三张 → 对子 → 单张，最后安置逢人配 */
function greedyDecompose(src: CState, level: number, rules: RuleConfig): Decomp {
  const s = cloneState(src);
  let hands = 0;
  let bombs = 0;

  // 王：四大天王 > 对子 > 单张
  if (s.sj >= 2 && s.bj >= 2) {
    hands += 1;
    bombs += 1;
    s.sj -= 2;
    s.bj -= 2;
  }
  hands += Math.floor(s.sj / 2) + Math.floor(s.bj / 2);
  let singles = (s.sj % 2) + (s.bj % 2);
  hands += singles;
  s.sj = 0;
  s.bj = 0;

  // 自然炸弹
  for (let i = 0; i < RANKS; i++) {
    if (s.c[i] >= 4) {
      s.c[i] -= Math.min(s.c[i], rules.bombMaxSize);
      hands += 1;
      bombs += 1;
    }
  }

  // 连续牌型：钢板（2 个连续三张）→ 三连对 → 顺子
  hands += takeWindows(s, 2, 3, rules.allowAceLowInTubePlate, 6, 16);
  hands += takeWindows(s, 3, 2, rules.allowAceLowInTubePlate, 6, 16);
  hands += takeWindows(s, 5, 1, rules.allowAceLowInStraight, 6, 14);

  // 三带二：三张尽量带掉最小的对子
  for (let i = 0; i < RANKS; i++) {
    if (s.c[i] < 3) continue;
    let bestJ = -1;
    let bestValue = Number.POSITIVE_INFINITY;
    for (let j = 0; j < RANKS; j++) {
      if (j === i || s.c[j] < 2) continue;
      const v = rankOrderValue(j + 2, level);
      if (v < bestValue) {
        bestValue = v;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      s.c[i] -= 3;
      s.c[bestJ] -= 2;
      hands += 1;
    }
  }

  // 剩下的三张：有逢人配就补成炸弹
  let triples = 0;
  for (let i = 0; i < RANKS; i++) {
    while (s.c[i] >= 3) {
      if (s.w >= 1) {
        s.c[i] -= 3;
        s.w -= 1;
        hands += 1;
        bombs += 1;
      } else {
        s.c[i] -= 3;
        triples += 1;
      }
    }
  }

  // 对子 / 单张
  let naturalPairs = 0;
  let naturalSingles = 0;
  for (let i = 0; i < RANKS; i++) {
    naturalPairs += Math.floor(s.c[i] / 2);
    naturalSingles += s.c[i] % 2;
  }

  let wildsLeft = s.w;
  const basePieces = triples + naturalPairs + naturalSingles + wildsLeft;
  let save = 0;
  // 逢人配 + 单张 → 对子
  let use = Math.min(wildsLeft, naturalSingles);
  save += use;
  naturalSingles -= use;
  wildsLeft -= use;
  // 逢人配 + 对子 → 三张
  use = Math.min(wildsLeft, naturalPairs);
  save += use;
  naturalPairs -= use;
  wildsLeft -= use;
  // 两张逢人配 → 对子
  save += Math.floor(wildsLeft / 2);
  wildsLeft -= 2 * Math.floor(wildsLeft / 2);

  hands += basePieces - save;
  singles += naturalSingles + wildsLeft;

  return { hands, singles, bombs };
}

// ---------------------------------------------------------------- 精确搜索

interface ExactVal {
  h: number;
  s: number;
  b: number;
}

function exactCost(v: ExactVal): number {
  return v.h * 1000 + v.s * 20 - v.b * 5;
}

const exactMemo = new Map<string, ExactVal>();
const EXACT_MEMO_MAX = 80000;

interface SearchCtx {
  nodes: number;
}

function zeroDeltas(): number[] {
  return new Array<number>(RANKS).fill(0);
}

function applyConsume(
  s: CState,
  deltas: readonly number[],
  sj: number,
  bj: number,
  w: number,
): CState | null {
  const next = cloneState(s);
  for (let i = 0; i < RANKS; i++) {
    const d = deltas[i];
    if (d === 0) continue;
    if (next.c[i] < d) return null;
    next.c[i] -= d;
  }
  if (next.sj < sj || next.bj < bj || next.w < w) return null;
  next.sj -= sj;
  next.bj -= bj;
  next.w -= w;
  return next;
}

type MoveCb = (type: ComboType, next: CState) => void;

/** 枚举所有"包含指定自然点数 m 的牌"的合法出牌（保证覆盖所有拆分） */
function forEachNaturalMove(
  s: CState,
  m: number,
  rules: RuleConfig,
  cb: MoveCb,
): void {
  const rank = m + 2;
  const cm = s.c[m];
  const w0 = s.w;

  // 单张
  {
    const next = cloneState(s);
    next.c[m] -= 1;
    cb(ComboType.Single, next);
  }

  // 对子 / 三张
  for (const size of [2, 3]) {
    const type = size === 2 ? ComboType.Pair : ComboType.Triple;
    const maxNatural = Math.min(size, cm);
    for (let nc = 1; nc <= maxNatural; nc++) {
      const wilds = size - nc;
      if (wilds > w0) continue;
      const deltas = zeroDeltas();
      deltas[m] = nc;
      const next = applyConsume(s, deltas, 0, 0, wilds);
      if (next) cb(type, next);
    }
  }

  // 炸弹（4..bombMaxSize 张）
  const maxBomb = Math.min(rules.bombMaxSize, cm + w0);
  for (let size = 4; size <= maxBomb; size++) {
    const maxNatural = Math.min(size, cm);
    const minNatural = Math.max(1, size - w0);
    for (let nc = minNatural; nc <= maxNatural; nc++) {
      const deltas = zeroDeltas();
      deltas[m] = nc;
      const next = applyConsume(s, deltas, 0, 0, size - nc);
      if (next) cb(ComboType.Bomb, next);
    }
  }

  // 三带二：m 作三张
  for (let nc = 1; nc <= Math.min(3, cm); nc++) {
    const tripleWilds = 3 - nc;
    if (tripleWilds > w0) continue;
    for (let p = 0; p < RANKS; p++) {
      if (p === m || s.c[p] === 0) continue;
      const maxPair = Math.min(2, s.c[p]);
      for (let pc = 1; pc <= maxPair; pc++) {
        const pairWilds = 2 - pc;
        if (tripleWilds + pairWilds > w0) continue;
        const deltas = zeroDeltas();
        deltas[m] = nc;
        deltas[p] = pc;
        const next = applyConsume(s, deltas, 0, 0, tripleWilds + pairWilds);
        if (next) cb(ComboType.FullHouse, next);
      }
    }
  }

  // 三带二：m 作对子
  for (let pc = 1; pc <= Math.min(2, cm); pc++) {
    const pairWilds = 2 - pc;
    if (pairWilds > w0) continue;
    for (let t = 0; t < RANKS; t++) {
      if (t === m || s.c[t] === 0) continue;
      const maxTriple = Math.min(3, s.c[t]);
      const minTriple = Math.max(1, 3 - (w0 - pairWilds));
      for (let tc = minTriple; tc <= maxTriple; tc++) {
        const tripleWilds = 3 - tc;
        if (pairWilds + tripleWilds > w0) continue;
        const deltas = zeroDeltas();
        deltas[m] = pc;
        deltas[t] = tc;
        const next = applyConsume(s, deltas, 0, 0, pairWilds + tripleWilds);
        if (next) cb(ComboType.FullHouse, next);
      }
    }
  }

  // 顺子 / 三连对 / 钢板
  const structures: Array<[number, number, boolean, ComboType]> = [
    [5, 1, rules.allowAceLowInStraight, ComboType.Straight],
    [3, 2, rules.allowAceLowInTubePlate, ComboType.Tube],
    [2, 3, rules.allowAceLowInTubePlate, ComboType.Plate],
  ];
  for (const [len, need, aceLow, type] of structures) {
    for (const ranks of windowsOf(len, aceLow)) {
      if (!ranks.includes(rank)) continue;
      const deltas = zeroDeltas();
      let wilds = 0;
      for (const r of ranks) {
        const take = Math.min(need, s.c[r - 2]);
        deltas[r - 2] = take;
        wilds += need - take;
      }
      if (wilds > w0) continue;
      const next = applyConsume(s, deltas, 0, 0, wilds);
      if (next) cb(type, next);
    }
  }
}

/** 只剩王时的手数（逢人配在 solveExact 里单独处理） */
function forEachJokerMove(s: CState, cb: MoveCb): void {
  if (s.sj >= 1) {
    const next = cloneState(s);
    next.sj -= 1;
    cb(ComboType.Single, next);
  }
  if (s.bj >= 1) {
    const next = cloneState(s);
    next.bj -= 1;
    cb(ComboType.Single, next);
  }
  if (s.sj >= 2) {
    const next = cloneState(s);
    next.sj -= 2;
    cb(ComboType.Pair, next);
  }
  if (s.bj >= 2) {
    const next = cloneState(s);
    next.bj -= 2;
    cb(ComboType.Pair, next);
  }
  if (s.sj >= 2 && s.bj >= 2) {
    const next = cloneState(s);
    next.sj -= 2;
    next.bj -= 2;
    cb(ComboType.JokerBomb, next);
  }
}

function firstNatural(s: CState): number {
  for (let i = 0; i < RANKS; i++) if (s.c[i] > 0) return i;
  return -1;
}

function solveExact(
  s: CState,
  level: number,
  rules: RuleConfig,
  ctx: SearchCtx,
): ExactVal {
  const total = totalCards(s);
  if (total === 0) return { h: 0, s: 0, b: 0 };

  const key =
    `${level}|${rules.bombMaxSize}|${rules.allowAceLowInStraight ? 1 : 0}|` +
    `${rules.allowAceLowInTubePlate ? 1 : 0}|${stateSignature(s)}`;
  const hit = exactMemo.get(key);
  if (hit) return hit;

  // 只剩逢人配：两张一对，单张一手
  if (s.sj === 0 && s.bj === 0 && firstNatural(s) < 0) {
    const val: ExactVal = { h: Math.ceil(s.w / 2), s: s.w % 2, b: 0 };
    exactMemo.set(key, val);
    return val;
  }

  if (ctx.nodes >= SEARCH_NODE_BUDGET) return { h: total, s: total, b: 0 };
  ctx.nodes += 1;

  let best: ExactVal | null = null;
  const consider: MoveCb = (type, next) => {
    const sub = solveExact(next, level, rules, ctx);
    const cand: ExactVal = {
      h: sub.h + 1,
      s: sub.s + (type === ComboType.Single ? 1 : 0),
      b: sub.b + (isBombType(type) ? 1 : 0),
    };
    if (best === null || exactCost(cand) < exactCost(best)) best = cand;
  };

  const m = firstNatural(s);
  if (m < 0) forEachJokerMove(s, consider);
  else forEachNaturalMove(s, m, rules, consider);

  const val = best ?? { h: total, s: total, b: 0 };
  if (ctx.nodes < SEARCH_NODE_BUDGET) {
    if (exactMemo.size > EXACT_MEMO_MAX) exactMemo.clear();
    exactMemo.set(key, val);
  }
  return val;
}

// ---------------------------------------------------------------- 对外接口

function computeControl(hand: readonly Card[], level: number, bombs: number): number {
  let control = bombs * 2;
  for (const card of hand) {
    if (isWild(card, level)) {
      control += 1;
      continue;
    }
    if (card.rank === BIG_JOKER) control += 3;
    else if (card.rank === SMALL_JOKER) control += 2;
    else if (card.rank === level) control += 1.5;
    else if (card.rank === 14) control += 0.7;
  }
  return control;
}

/**
 * 评估一手牌。
 * ≤ 14 张时走精确搜索求最小手数；否则用贪心拆分。
 */
export function evaluateHand(
  hand: readonly Card[],
  level: number,
  rules: RuleConfig = DEFAULT_RULES,
): HandValue {
  const state = countsFromHand(hand, level);
  const total = totalCards(state);
  const greedy = greedyDecompose(state, level, rules);

  let hands = greedy.hands;
  let singles = greedy.singles;
  let bombs = greedy.bombs;
  let exact = false;
  let nodes = 0;

  if (total <= EXACT_LIMIT) {
    const ctx: SearchCtx = { nodes: 0 };
    const found = solveExact(state, level, rules, ctx);
    nodes = ctx.nodes;
    exact = true;
    if (found.h <= hands) {
      hands = found.h;
      singles = found.s;
      bombs = found.b;
    }
  }

  const control = computeControl(hand, level, bombs);
  const wilds = state.w;
  const score = hands * 100 + singles * 8 - control * 6 - bombs * 12 - wilds * 4;
  return { hands, singles, control, bombs, wilds, score, exact, nodes };
}

/** 出牌所消耗牌力的代价：用的牌越大，代价越高 */
export function spentValue(cards: readonly Card[], level: number): number {
  let sum = 0;
  for (const c of cards) {
    const v = orderValue(c, level);
    if (v >= 16) sum += 10;
    else if (v === 15) sum += 7;
    else if (v >= 13) sum += 3;
    else if (v >= 11) sum += 1;
  }
  return sum;
}

/** 手牌中是否只剩这一手牌就能出完 */
export function isFinishingMove(hand: readonly Card[], cards: readonly Card[]): boolean {
  return hand.length === cards.length;
}
