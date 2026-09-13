import { enumeratePlays, type PlayOption } from './candidates';
import { evaluateHand, spentValue } from './handEval';
import { POWER_JOKER_BOMB, POWER_STRAIGHT_FLUSH, bombPower } from './combos';
import { orderValue, rankOrderValue } from './cards';
import { teammateOf, type RuleConfig } from './rules';
import { ComboType, isWild, type Card, type Combo } from './types';
import type { GuandanGame } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiDecision {
  action: 'play' | 'pass';
  cards: Card[];
  reason: string;
}

const OPPONENT_URGENT = 2;
const OPPONENT_CRITICAL = 1;

function othersOf(player: number): number[] {
  return [0, 1, 2, 3].filter((p) => p !== player);
}

function opponentsOf(player: number): number[] {
  const partner = teammateOf(player);
  return othersOf(player).filter((p) => p !== partner);
}

function remainingAfter(hand: readonly Card[], cards: readonly Card[]): Card[] {
  const ids = new Set(cards.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
}

// ---------------------------------------------------------------- 记牌

interface TableInfo {
  level: number;
  /** 下标 = 点数 2..16，别人手里还有几张（总数 - 已打出 - 我的手牌） */
  rem: number[];
  /** 还没露面的逢人配数量 */
  unseenWilds: number;
  /** 其他玩家手牌总数（用于判断炸弹是否还有可能存在） */
  totalOutside: number;
}

function buildInfo(game: GuandanGame, player: number): TableInfo {
  const level = game.level;
  const rem = new Array<number>(17).fill(0);
  for (let r = 2; r <= 16; r++) rem[r] = game.remainingRankCount(r, player);
  let myWilds = 0;
  for (const c of game.hands[player]) if (isWild(c, level)) myWilds += 1;
  let playedWilds = 0;
  for (const c of game.playedPool) if (isWild(c, level)) playedWilds += 1;
  const unseenWilds = Math.max(0, 2 - myWilds - playedWilds);
  let totalOutside = 0;
  for (const p of othersOf(player)) totalOutside += game.hands[p].length;
  return { level, rem, unseenWilds, totalOutside };
}

/** 某点数在别人手里"能凑出多少张"的上界；逢人配可以补任意非王牌 */
function effCount(info: TableInfo, rank: number): number {
  if (rank >= 15) return info.rem[rank];
  if (rank === info.level) return info.rem[rank];
  return info.rem[rank] + info.unseenWilds;
}

/** 是否存在同类型但更大的一手（不含炸弹） */
function sameTypeBeatsPossible(info: TableInfo, combo: Combo, rules: RuleConfig): boolean {
  const level = info.level;
  const type = combo.type;
  if (type === ComboType.Single || type === ComboType.Pair || type === ComboType.Triple) {
    const size = combo.cards.length;
    for (let r = 2; r <= 16; r++) {
      if (rankOrderValue(r, level) <= combo.rank) continue;
      if (effCount(info, r) >= size) return true;
    }
    return false;
  }
  if (type === ComboType.Straight) {
    for (const w of windows(5, rules.allowAceLowInStraight)) {
      if (w.top <= combo.rank) continue;
      if (w.ranks.every((r) => effCount(info, r) >= 1)) return true;
    }
    return false;
  }
  if (type === ComboType.Tube) {
    for (const w of windows(3, rules.allowAceLowInTubePlate)) {
      if (w.top <= combo.rank) continue;
      if (w.ranks.every((r) => effCount(info, r) >= 2)) return true;
    }
    return false;
  }
  if (type === ComboType.Plate) {
    for (const w of windows(2, rules.allowAceLowInTubePlate)) {
      if (w.top <= combo.rank) continue;
      if (w.ranks.every((r) => effCount(info, r) >= 3)) return true;
    }
    return false;
  }
  if (type === ComboType.FullHouse) {
    for (let t = 2; t <= 14; t++) {
      if (rankOrderValue(t, level) <= combo.rank) continue;
      if (effCount(info, t) < 3) continue;
      for (let p = 2; p <= 14; p++) {
        if (p === t) continue;
        if (effCount(info, p) >= 2) return true;
      }
    }
    return false;
  }
  // 炸弹 / 同花顺 / 四大天王由 bombBeatsExist 处理
  return false;
}

interface Window {
  ranks: number[];
  top: number;
}

const windowsCache = new Map<string, Window[]>();

function windows(len: number, allowAceLow: boolean): Window[] {
  const key = `${len}|${allowAceLow ? 1 : 0}`;
  const hit = windowsCache.get(key);
  if (hit) return hit;
  const out: Window[] = [];
  for (let start = 1; start + len - 1 <= 14; start++) {
    if (start === 1 && !allowAceLow) continue;
    const ranks: number[] = [];
    for (let k = 0; k < len; k++) {
      const v = start + k;
      ranks.push(v === 1 ? 14 : v);
    }
    out.push({ ranks, top: start + len - 1 });
  }
  windowsCache.set(key, out);
  return out;
}

/** 别人手里有没有同花顺（近似：按花色统计未见过的牌，逢人配可补缺口） */
function straightFlushPossible(
  game: GuandanGame,
  player: number,
  level: number,
  unseenWilds: number,
  allowAceLow: boolean,
): boolean {
  const suits: Array<'S' | 'H' | 'D' | 'C'> = ['S', 'H', 'D', 'C'];
  const myHand = game.hands[player];
  for (const suit of suits) {
    const unseen = new Array<number>(15).fill(2);
    for (const c of game.playedPool) {
      if (c.suit === suit && c.rank <= 14) unseen[c.rank] -= 1;
    }
    for (const c of myHand) {
      if (c.suit === suit && c.rank <= 14) unseen[c.rank] -= 1;
    }
    // 红桃级牌就是逢人配，统一由 unseenWilds 表示，避免重复计数
    if (suit === 'H' && level >= 2 && level <= 14) unseen[level] = 0;
    for (const w of windows(5, allowAceLow)) {
      let missing = 0;
      for (const r of w.ranks) if ((unseen[r] ?? 0) <= 0) missing += 1;
      if (missing <= unseenWilds) return true;
    }
  }
  return false;
}

function bombPossibleOutside(
  game: GuandanGame,
  player: number,
  info: TableInfo,
  rules: RuleConfig,
): boolean {
  // 炸弹至少要 4 张同点，别人手里不够 4 张就不可能
  if (info.totalOutside < 4) return false;
  for (let r = 2; r <= 14; r++) {
    if (effCount(info, r) >= 4) return true;
  }
  if (info.rem[15] >= 2 && info.rem[16] >= 2) return true;
  if (info.totalOutside < 5) return false;
  return straightFlushPossible(
    game,
    player,
    info.level,
    info.unseenWilds,
    rules.allowAceLowInStraight,
  );
}

/** 是否有比 power/rank 更大的炸弹仍可能存在 */
function bombBeatsExist(
  game: GuandanGame,
  player: number,
  info: TableInfo,
  rules: RuleConfig,
  power: number,
  rank: number,
): boolean {
  if (power >= POWER_JOKER_BOMB) return false;
  if (info.totalOutside < 4) return false;
  if (info.rem[15] >= 2 && info.rem[16] >= 2) return true;

  const sfPower = rules.straightFlushBetween5And6 ? POWER_STRAIGHT_FLUSH : bombPower(5);
  if (
    info.totalOutside >= 5 &&
    straightFlushPossible(game, player, info.level, info.unseenWilds, rules.allowAceLowInStraight)
  ) {
    if (sfPower > power + 1e-9) return true;
    if (Math.abs(sfPower - power) < 1e-9 && rank < 14) return true;
  }

  for (let r = 2; r <= 14; r++) {
    const cnt = effCount(info, r);
    if (cnt < 4) continue;
    const maxSize = Math.min(rules.bombMaxSize, cnt);
    for (let size = 4; size <= maxSize; size++) {
      const p = bombPower(size);
      if (p > power + 1e-9) return true;
      if (Math.abs(p - power) < 1e-9 && rankOrderValue(r, info.level) > rank) return true;
    }
  }
  return false;
}

/** 单张 / 对子 / 三同张是否已是当前最大（不考虑炸弹） */
function isTopNormal(info: TableInfo, combo: Combo): boolean {
  if (
    combo.type !== ComboType.Single &&
    combo.type !== ComboType.Pair &&
    combo.type !== ComboType.Triple
  ) {
    return false;
  }
  const size = combo.cards.length;
  for (let r = 2; r <= 16; r++) {
    if (rankOrderValue(r, info.level) <= combo.rank) continue;
    if (effCount(info, r) >= size) return false;
  }
  return true;
}

/** 综合判断：这手牌是否已经无人能压（含炸弹威胁） */
function isUnbeatableWith(
  game: GuandanGame,
  player: number,
  info: TableInfo,
  rules: RuleConfig,
  combo: Combo,
): boolean {
  if (combo.type === ComboType.JokerBomb) return true;
  if (combo.isBomb) {
    return !bombBeatsExist(game, player, info, rules, combo.power, combo.rank);
  }
  if (sameTypeBeatsPossible(info, combo, rules)) return false;
  if (bombPossibleOutside(game, player, info, rules)) return false;
  return true;
}

/**
 * 记牌推断：这手牌是否大概率已经无人能压（含炸弹威胁）。
 */
export function isLikelyUnbeatable(game: GuandanGame, player: number, combo: Combo): boolean {
  const info = buildInfo(game, player);
  return isUnbeatableWith(game, player, info, game.rules, combo);
}

// ---------------------------------------------------------------- 难度参数

interface Params {
  bombPenalty: number;
  /** 用同花顺去压一张普通牌型的代价（小于拆真炸弹，但绝不该白烧） */
  flushPenalty: number;
  partnerPass: number;
  threatBonus: number;
  followBonus: number;
  useCounting: boolean;
  useThreat: boolean;
  /** 是否精确计算炸弹威胁 / 自己炸弹是否最大（hard 专有） */
  useBombs: boolean;
  randomize: number;
  randomPass: number;
}

function paramsFor(difficulty: Difficulty): Params {
  if (difficulty === 'easy') {
    return {
      bombPenalty: 55,
      flushPenalty: 25,
      partnerPass: 120,
      threatBonus: 0,
      followBonus: 0,
      useCounting: false,
      useThreat: false,
      useBombs: false,
      randomize: 0.45,
      randomPass: 0.25,
    };
  }
  if (difficulty === 'hard') {
    return {
      bombPenalty: 200,
      flushPenalty: 85,
      partnerPass: 260,
      threatBonus: 210,
      followBonus: 30,
      useCounting: true,
      useThreat: true,
      useBombs: true,
      randomize: 0,
      randomPass: 0,
    };
  }
  return {
    bombPenalty: 140,
    flushPenalty: 60,
    partnerPass: 200,
    threatBonus: 0,
    followBonus: 25,
    useCounting: true,
    useThreat: false,
    useBombs: false,
    randomize: 0,
    randomPass: 0,
  };
}

// ---------------------------------------------------------------- 决策

interface Ctx {
  game: GuandanGame;
  player: number;
  hand: readonly Card[];
  level: number;
  rules: GuandanGame['rules'];
  params: Params;
  info: TableInfo | null;
  partner: number;
  partnerCards: number;
  partnerOut: boolean;
  minOpp: number;
  /** 对手只剩 1 张牌（所有难度都可见的基础事实） */
  oppLastCard: boolean;
  /** 对手只剩 2 张以内（所有难度都可见） */
  oppNearOut: boolean;
  /** 困难档的威胁反应开关 */
  oppThreat: boolean;
  oppCritical: boolean;
  myBombs: number;
  jokersGone: boolean;
  rng: () => number;
}

/** 出手后的局面评估，以及若干结构 / 记牌标签 */
interface OptionEval {
  opt: PlayOption;
  afterHands: number;
  afterSingles: number;
  unbeatable: boolean;
  top: boolean;
  bombThreat: boolean;
  score: number;
}

function countBombs(hand: readonly Card[], level: number): number {
  const counts = new Map<number, number>();
  let wilds = 0;
  for (const c of hand) {
    if (isWild(c, level)) {
      wilds += 1;
      continue;
    }
    if (c.rank >= 15) continue;
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  let bombs = 0;
  for (const n of counts.values()) if (n >= 4) bombs += 1;
  if (wilds > 0) {
    for (const n of counts.values()) if (n === 3) {
      bombs += 1;
      break;
    }
  }
  return bombs;
}

function buildCtx(
  game: GuandanGame,
  player: number,
  difficulty: Difficulty,
  rng: () => number,
): Ctx {
  const partner = teammateOf(player);
  const opps = opponentsOf(player);
  const oppCounts = opps.map((p) => game.hands[p].length);
  const activeOpp = oppCounts.filter((n) => n > 0);
  const minOpp = activeOpp.length > 0 ? Math.min(...activeOpp) : 99;
  const params = paramsFor(difficulty);
  const info = params.useCounting ? buildInfo(game, player) : null;
  return {
    game,
    player,
    hand: game.hands[player],
    level: game.level,
    rules: game.rules,
    params,
    info,
    partner,
    partnerCards: game.hands[partner].length,
    partnerOut: game.hands[partner].length === 0,
    minOpp,
    oppLastCard: minOpp <= OPPONENT_CRITICAL,
    oppNearOut: minOpp <= OPPONENT_URGENT,
    oppThreat: Boolean(params.useThreat) && minOpp <= OPPONENT_URGENT,
    oppCritical: Boolean(params.useThreat) && minOpp <= OPPONENT_CRITICAL,
    myBombs: countBombs(game.hands[player], game.level),
    jokersGone: info !== null && info.rem[15] <= 0 && info.rem[16] <= 0,
    rng,
  };
}

function evaluateOption(ctx: Ctx, opt: PlayOption): OptionEval {
  const after = evaluateHand(remainingAfter(ctx.hand, opt.cards), ctx.level, ctx.rules);
  const isBomb = opt.combo.isBomb;
  let unbeatable = false;
  let top = false;
  let bombThreat = false;
  if (ctx.info) {
    top = isTopNormal(ctx.info, opt.combo);
    if (ctx.params.useBombs) {
      unbeatable = isUnbeatableWith(ctx.game, ctx.player, ctx.info, ctx.rules, opt.combo);
      if (!isBomb) bombThreat = bombPossibleOutside(ctx.game, ctx.player, ctx.info, ctx.rules);
    } else {
      unbeatable = top;
    }
  }
  return {
    opt,
    afterHands: after.hands,
    afterSingles: after.singles,
    unbeatable,
    top,
    bombThreat,
    score: after.score,
  };
}

/** AI 出牌决策 */
export function decidePlay(
  game: GuandanGame,
  player: number,
  difficulty: Difficulty = 'normal',
  rng: () => number = Math.random,
): AiDecision {
  const hand = game.hands[player];
  if (hand.length === 0) return { action: 'pass', cards: [], reason: '已经出完' };
  const ctx = buildCtx(game, player, difficulty, rng);

  if (game.target === null) return chooseLead(ctx);
  return chooseFollow(ctx);
}

function chooseFollow(ctx: Ctx): AiDecision {
  const { game, hand, level, rules } = ctx;
  const options = enumeratePlays(hand, level, game.target, rules);
  if (options.length === 0) {
    return { action: 'pass', cards: [], reason: '没有能压过的牌' };
  }

  const before = evaluateHand(hand, level, rules);
  const lastPlayer = game.lastPlay!.player;
  const partnerLed = lastPlayer === ctx.partner;
  // 除了同花顺之外，还有没有"不烧炸弹"的压法？
  // 有 → 用同花顺去压就是白烧一个大炸，要计代价；
  // 没有 → 它就是唯一手段，正常打。
  const hasCheaperBeat = options.some(
    (o) => o.combo.type !== ComboType.StraightFlush && !o.combo.isBomb,
  );
  const scored: Array<{ ev: OptionEval; score: number }> = [];

  for (const opt of options) {
    const ev = evaluateOption(ctx, opt);
    let score = ev.score - before.score;
    const isBomb = opt.combo.isBomb;
    // 真炸弹与同花顺分开计价：同花顺也是大炸，拿它去压一张普通牌就是白烧，
    // 但代价要小于拆一颗真炸弹（它同时还能当顺子用）。
    const isRealBomb = opt.combo.type === ComboType.Bomb || opt.combo.type === ComboType.JokerBomb;
    const isFlushSpend = opt.combo.type === ComboType.StraightFlush;
    score += spentValue(opt.cards, level) * 2;

    if (ev.afterHands === 0) score -= 1_000_000;

    if (isRealBomb || (isFlushSpend && hasCheaperBeat)) {
      let penalty = isRealBomb ? ctx.params.bombPenalty : ctx.params.flushPenalty;
      if (ctx.oppThreat) penalty -= 95;
      if (ev.afterHands <= 2) penalty -= 45;
      if (ctx.myBombs >= 2) penalty -= 30;
      if (ctx.partnerOut) penalty -= 20;
      penalty = Math.max(15, penalty);
      score += penalty;
      // 绝不炸队友的赢牌（除非自己能立刻走完）
      if (partnerLed && ev.afterHands > 0) {
        const desperate = ctx.oppCritical && ev.afterHands <= 1 && ctx.partnerCards > 0;
        if (!desperate) score += 900;
      }
    } else if (ctx.info) {
      if (ev.top) {
        if (ev.afterHands <= 2) score -= 120;
        else if (ev.bombThreat) score -= 5;
        else score -= 40;
        if (ctx.jokersGone) score -= 25;
      }
      if (ctx.oppCritical && opt.combo.type === ComboType.Single && !ev.top) {
        score += 55;
      }
    }

    // 两手中就能走完：拿到出牌权且只剩最后一手
    if (ctx.info && ev.afterHands === 1 && (ev.unbeatable || ev.afterSingles === 0)) {
      score -= 100;
    }

    if (partnerLed) {
      // 队友的那手牌够不够硬：炸弹，或级牌及以上
      const partnerPlay = game.lastPlay!.combo;
      const partnerStrong = partnerPlay.isBomb || partnerPlay.rank >= 15;
      if (ctx.oppLastCard && !partnerStrong) {
        // 对手随时可能走人：谁拿着出牌权谁说了算，能抢就抢。
        // 但只有"硬牌"（J 及以上）值得抢，也不为此拆炸弹。
        if (!isBomb && opt.combo.rank >= 12) score -= 260;
        else score += ctx.params.partnerPass;
      } else {
        score += ctx.params.partnerPass;
        if (ctx.partnerCards > 0 && ctx.partnerCards <= OPPONENT_URGENT) score += 80;
        if (ctx.oppThreat) score -= ctx.params.partnerPass * 0.55;
        if (ctx.oppCritical) score -= 60;
      }
    } else {
      score -= ctx.params.followBonus;
      if (ctx.oppThreat) score -= ctx.params.threatBonus;
      // 对手只剩 1 张必须尽量拦住 —— 这是基础competence，不该只在困难档生效
      if (ctx.oppLastCard) score -= 120;
      else if (ctx.oppNearOut) score -= 45;
      if (ctx.oppCritical) score -= 70;
      if (ctx.partnerOut) score -= 25;
    }

    scored.push({ ev, score });
  }

  scored.sort((a, b) => a.score - b.score);

  if (ctx.params.randomize > 0) {
    if (ctx.rng() < ctx.params.randomPass) {
      return { action: 'pass', cards: [], reason: '轻松模式随机过牌' };
    }
    if (ctx.rng() < ctx.params.randomize) {
      const pick = scored[Math.floor(ctx.rng() * scored.length)];
      return { action: 'play', cards: pick.ev.opt.cards, reason: '轻松模式随手跟牌' };
    }
    const best = scored[0];
    if (best.score > 25 && best.ev.afterHands > 0) {
      return { action: 'pass', cards: [], reason: '轻松模式保守过牌' };
    }
    return { action: 'play', cards: best.ev.opt.cards, reason: '轻松模式跟牌' };
  }

  const best = scored[0];
  if (best.score > 0) {
    return { action: 'pass', cards: [], reason: '代价过高，选择过牌' };
  }
  return { action: 'play', cards: best.ev.opt.cards, reason: describeChoice(best.ev.opt, best.score) };
}

function chooseLead(ctx: Ctx): AiDecision {
  const { hand, level, rules } = ctx;
  const options = enumeratePlays(hand, level, null, rules);
  if (options.length === 0) {
    const card = hand[0];
    return { action: 'play', cards: card ? [card] : [], reason: '被迫出牌' };
  }

  const finisher = options.find((o) => o.cards.length === hand.length);
  if (finisher) return { action: 'play', cards: finisher.cards, reason: '一把出完' };

  // 队友快走完：喂小牌
  if (ctx.info && !ctx.partnerOut) {
    if (ctx.partnerCards === 1 && ctx.minOpp > 1) {
      const singles = options
        .filter((o) => o.combo.type === ComboType.Single)
        .sort((a, b) => orderValue(a.cards[0], level) - orderValue(b.cards[0], level));
      if (singles.length > 0) {
        return { action: 'play', cards: singles[0].cards, reason: '给队友喂单张' };
      }
    }
    if (ctx.partnerCards === 2 && ctx.minOpp > 2) {
      const pairs = options
        .filter((o) => o.combo.type === ComboType.Pair)
        .sort((a, b) => orderValue(a.cards[0], level) - orderValue(b.cards[0], level));
      if (pairs.length > 0) {
        return { action: 'play', cards: pairs[0].cards, reason: '给队友喂对子' };
      }
    }
  }

  const before = evaluateHand(hand, level, rules);
  const scored: Array<{ ev: OptionEval; score: number }> = [];

  for (const opt of options) {
    const ev = evaluateOption(ctx, opt);
    let score = ev.score - before.score;
    score -= opt.cards.length * 3;
    score += spentValue(opt.cards, level) * 1.5;

    if (opt.combo.isBomb) {
      const realBomb = opt.combo.type === ComboType.Bomb || opt.combo.type === ComboType.JokerBomb;
      // 首出时同花顺同样是"清一手 5 张长牌"，不按炸弹计价（否则会把手牌捂烂）
      let penalty = realBomb ? ctx.params.bombPenalty : 0;
      if (ctx.info && ctx.partnerCards === 1) penalty += 40;
      if (ev.afterHands <= 2) penalty -= 40;
      score += Math.max(25, penalty);
    }
    if (ev.afterHands === 0) score -= 1_000_000;

    if (ctx.info) {
      if (ev.top) {
        if (ev.afterHands <= 2) score -= 120;
        else score -= 20;
      }
      // 对手只剩 1 张：别送一张他能压过的单张，优先出对子/大牌
      if (ctx.oppCritical) {
        if (opt.combo.type === ComboType.Single && !ev.top) score += 55;
        if (opt.combo.cards.length >= 2 && !opt.combo.isBomb && ev.top) score -= 45;
      }
      if (!ctx.partnerOut && ctx.partnerCards === 1 && opt.combo.type === ComboType.Single) {
        score -= 25;
      }
      if (ev.afterHands === 1 && (ev.unbeatable || ev.afterSingles === 0)) score -= 90;
      // 队友已经走完，只剩自己，尽量走完
      if (ctx.partnerOut && ev.afterHands <= 2) score -= 25;
    }

    scored.push({ ev, score });
  }

  scored.sort((a, b) => a.score - b.score);

  if (ctx.params.randomize > 0) {
    if (ctx.rng() < ctx.params.randomize) {
      const pick = scored[Math.floor(ctx.rng() * scored.length)];
      return { action: 'play', cards: pick.ev.opt.cards, reason: '轻松模式随手出牌' };
    }
    const pick = scored[Math.floor(ctx.rng() * Math.min(4, scored.length))];
    return { action: 'play', cards: pick.ev.opt.cards, reason: '轻松模式随手出牌' };
  }

  const best = scored[0];
  return { action: 'play', cards: best.ev.opt.cards, reason: describeChoice(best.ev.opt, best.score) };
}

function describeChoice(opt: PlayOption, score: number): string {
  return `出${opt.combo.label}（评估 ${Math.round(score)}）`;
}

/** AI 还贡：优先还单张里最小的牌，避免拆对子或送出级牌 */
export function decideReturn(
  game: GuandanGame,
  player: number,
  difficulty: Difficulty = 'normal',
  rng: () => number = Math.random,
): number {
  const candidates = game.returnCandidatesFor(player);
  if (candidates.length === 0) throw new Error('没有可还贡的牌');
  const level = game.level;
  const hand = game.hands[player];
  const rankCounter = new Map<number, number>();
  for (const c of hand) rankCounter.set(c.rank, (rankCounter.get(c.rank) ?? 0) + 1);

  const sorted = candidates.slice().sort((a, b) => {
    const loneA = (rankCounter.get(a.rank) ?? 0) === 1 ? 0 : 1;
    const loneB = (rankCounter.get(b.rank) ?? 0) === 1 ? 0 : 1;
    if (loneA !== loneB) return loneA - loneB;
    return orderValue(a, level) - orderValue(b, level);
  });

  if (difficulty === 'easy' && sorted.length > 1 && rng() < 0.3) {
    return sorted[1].id;
  }
  return sorted[0].id;
}

export { othersOf, opponentsOf };
