import { createDeck, levelText, mulberry32, orderValue, shuffle, sortCards } from './cards';
import { clearDetectCache, comboKey, detectCombos } from './combos';
import { beats } from './compare';
import { validatePlay } from './candidates';
import {
  canAntiTribute,
  biggerTributeIndex,
  planTribute,
  returnCandidates,
  tributeCard,
} from './tribute';
import { DEFAULT_RULES, teammateOf, type RuleConfig } from './rules';
import { applyRoundResult } from './scoring';
import type { Card, Combo } from './types';

export type Phase = 'idle' | 'playing' | 'returnTribute' | 'roundEnd' | 'matchEnd';

export interface PlayRecord {
  player: number;
  cards: Card[];
  combo: Combo | null;
}

export type GameEvent =
  | { type: 'deal' }
  | { type: 'tribute'; from: number; to: number; card: Card }
  | { type: 'antiTribute'; players: number[] }
  | { type: 'return'; from: number; to: number; card: Card }
  | { type: 'play'; player: number; combo: Combo }
  | { type: 'pass'; player: number }
  | { type: 'finish'; player: number; place: number }
  | { type: 'trick'; leader: number; borrowed: boolean }
  | { type: 'roundEnd'; result: RoundResult }
  | { type: 'matchEnd'; team: number };

export interface PendingReturn {
  kind: 'return';
  /** 还贡者（收贡方） */
  player: number;
  /** 收贡对象（进贡者） */
  to: number;
  /** 可选的牌 id */
  candidateIds: number[];
}

export interface RoundResult {
  finishOrder: number[];
  headTeam: number;
  gain: number;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  /** 本局打的级牌属于哪一队 */
  levelTeamBefore: number;
  /** 是否打 A 局 */
  wasARound: boolean;
  /** 是否成功过 A */
  passedA: boolean;
  /** 三次不过 A 触发降级 */
  aReset: boolean;
  matchWinner: number | null;
}

export interface TributeLog {
  from: number;
  to: number;
  card: Card;
  returned?: Card;
}

/**
 * 掼蛋对局状态机。
 *
 * 只负责规则与状态迁移，不涉及任何渲染；随机数可注入，便于测试与回放。
 */
export class GuandanGame {
  readonly rules: RuleConfig;
  private rng: () => number;

  round = 0;
  /** 两队各自的级数（下标 = 队伍编号 0/1） */
  levels: [number, number];
  /** 打 A 失败次数 */
  aAttempts: [number, number] = [0, 0];
  /** 本局级牌属于哪一队（上一局获胜方坐庄） */
  levelTeam = 0;

  phase: Phase = 'idle';
  hands: Card[][] = [[], [], [], []];
  current = 0;
  lastPlay: { player: number; combo: Combo } | null = null;
  passCount = 0;
  finishOrder: number[] = [];
  trickPlays: PlayRecord[] = [];
  lastTrickPlays: PlayRecord[] = [];
  history: PlayRecord[] = [];
  /** 已打出的所有牌，供 AI 记牌 */
  playedPool: Card[] = [];

  pending: PendingReturn[] = [];
  tributes: TributeLog[] = [];
  /** 本局抗贡的玩家（空数组表示正常进贡或本局无进贡） */
  antiTributePlayers: number[] = [];
  events: GameEvent[] = [];

  prevFinishOrder: number[] = [];
  roundResult: RoundResult | null = null;
  matchWinner: number | null = null;
  aRoundTeam: number | null = null;

  constructor(rules: Partial<RuleConfig> = {}, seed = 20240914) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = mulberry32(seed);
    this.levels = [this.rules.levelStart, this.rules.levelStart];
  }

  get level(): number {
    return this.levels[this.levelTeam];
  }

  handOf(player: number): Card[] {
    return this.hands[player];
  }

  /** 手牌按大小排序（展示用） */
  sortedHand(player: number): Card[] {
    return sortCards(this.hands[player], this.level);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  isFinished(player: number): boolean {
    return this.hands[player].length === 0;
  }

  activePlayers(): number[] {
    return [0, 1, 2, 3].filter((p) => this.hands[p].length > 0);
  }

  nextActive(from: number): number {
    for (let i = 1; i <= 4; i++) {
      const p = (from + i) % 4;
      if (this.hands[p].length > 0) return p;
    }
    return from;
  }

  /** 当前跟牌目标（首出时为 null） */
  get target(): Combo | null {
    return this.lastPlay?.combo ?? null;
  }

  totalPlayedCount(player: number): number {
    return this.history.filter((h) => h.player === player && h.combo).length;
  }

  // ---------------------------------------------------------------- 开局

  startRound(): void {
    if (this.phase === 'matchEnd') throw new Error('比赛已结束');
    clearDetectCache();
    this.round += 1;
    this.finishOrder = [];
    this.history = [];
    this.trickPlays = [];
    this.lastTrickPlays = [];
    this.lastPlay = null;
    this.passCount = 0;
    this.pending = [];
    this.tributes = [];
    this.antiTributePlayers = [];
    this.playedPool = [];
    this.roundResult = null;
    this.events = [];

    const deck = shuffle(createDeck(), this.rng);
    this.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 27, i * 27 + 27));
    this.aRoundTeam =
      this.levels[this.levelTeam] === this.rules.levelCap ? this.levelTeam : null;
    this.events.push({ type: 'deal' });

    const canTribute =
      this.round > 1 && this.rules.tributeEnabled && this.prevFinishOrder.length === 4;
    if (!canTribute) {
      this.phase = 'playing';
      this.current = Math.floor(this.rng() * 4);
      return;
    }
    this.setupTribute();
  }

  private setupTribute(): void {
    const order = this.prevFinishOrder;
    const head = order[0];
    const plan = planTribute(order, head);

    if (plan.kind === 'none') {
      this.phase = 'playing';
      this.current = head;
      return;
    }

    const level = this.level;
    const payers = plan.kind === 'double' ? plan.losers : [plan.payer!];

    if (canAntiTribute(this.hands, payers)) {
      this.antiTributePlayers = payers.slice();
      this.events.push({ type: 'antiTribute', players: payers.slice() });
      this.phase = 'playing';
      this.current = head;
      return;
    }

    if (plan.kind === 'single') {
      const payer = plan.payer!;
      const card = tributeCard(this.hands[payer], level);
      this.moveCard(payer, head, card);
      this.tributes.push({ from: payer, to: head, card });
      this.events.push({ type: 'tribute', from: payer, to: head, card });
      this.queueReturn(head, payer);
      this.phase = 'returnTribute';
      this.current = payer;
      return;
    }

    // 双贡：两人各交出最大牌；默认较大的给头游，另一张给二游
    const second = order[1];
    const cards = payers.map((p) => tributeCard(this.hands[p], level));
    const bigIdx = biggerTributeIndex(cards, level);
    // payers 按名次排列：payers[0] 名次更好，最后一个即末游
    const lastIdx = payers.length - 1;
    const assignments: Array<[number, number, Card]> = payers.map((p, i) => {
      const toHead = this.rules.doubleTributeBigToHead ? i === bigIdx : i === lastIdx;
      return [p, toHead ? head : second, cards[i]];
    });
    for (const [from, to, card] of assignments) {
      this.moveCard(from, to, card);
      this.tributes.push({ from, to, card });
      this.events.push({ type: 'tribute', from, to, card });
    }
    // 由贡出大牌的一方先出牌
    const first = payers[bigIdx];
    for (const [from, to] of assignments) {
      this.queueReturn(to, from);
    }
    this.phase = 'returnTribute';
    this.current = first;
  }

  private queueReturn(receiver: number, payer: number): void {
    const candidates = returnCandidates(this.hands[receiver], this.rules);
    this.pending.push({
      kind: 'return',
      player: receiver,
      to: payer,
      candidateIds: candidates.map((c) => c.id),
    });
  }

  private moveCard(from: number, to: number, card: Card): void {
    this.hands[from] = this.hands[from].filter((c) => c.id !== card.id);
    this.hands[to] = [...this.hands[to], card];
  }

  /** 处理还贡（玩家或 AI 选择） */
  submitReturn(player: number, cardId: number): void {
    if (this.phase !== 'returnTribute') throw new Error('当前不是还贡阶段');
    const idx = this.pending.findIndex((p) => p.player === player);
    if (idx < 0) throw new Error('该玩家无需还贡');
    const req = this.pending[idx];
    if (!req.candidateIds.includes(cardId)) throw new Error('这张牌不能用于还贡');
    const card = this.hands[player].find((c) => c.id === cardId);
    if (!card) throw new Error('手牌中没有这张牌');
    this.moveCard(player, req.to, card);
    // 手牌需要重新排序展示，这里保持原样由 UI 排序
    const log = this.tributes.find((t) => t.from === req.to && t.to === player);
    if (log) log.returned = card;
    this.events.push({ type: 'return', from: player, to: req.to, card });
    this.pending.splice(idx, 1);
    if (this.pending.length === 0) {
      this.phase = 'playing';
    }
  }

  /** 还贡候选牌（UI 高亮用） */
  returnCandidatesFor(player: number): Card[] {
    const req = this.pending.find((p) => p.player === player);
    if (!req) return [];
    const ids = new Set(req.candidateIds);
    return this.hands[player].filter((c) => ids.has(c.id));
  }

  // ---------------------------------------------------------------- 出牌

  canPass(player: number): boolean {
    return (
      this.phase === 'playing' &&
      this.current === player &&
      this.lastPlay !== null &&
      this.hands[player].length > 0
    );
  }

  play(player: number, cards: readonly Card[]): Combo {
    if (this.phase !== 'playing') throw new Error('当前不能出牌');
    if (this.current !== player) throw new Error('还没轮到你出牌');
    const hand = this.hands[player];
    if (hand.length === 0) throw new Error('你已经出完牌了');
    const result = validatePlay(hand, cards, this.level, this.target, this.rules);
    if (!result.ok) throw new Error(result.reason);
    return this.commit(player, cards, result.combo);
  }

  /**
   * 按指定解释出牌（逢人配存在多种解释时由玩家选择）。
   * 会校验牌与解释是否匹配、是否压得过上家。
   */
  playAs(player: number, cards: readonly Card[], combo: Combo): Combo {
    if (this.phase !== 'playing') throw new Error('当前不能出牌');
    if (this.current !== player) throw new Error('还没轮到你出牌');
    const hand = this.hands[player];
    if (hand.length === 0) throw new Error('你已经出完牌了');
    const handIds = new Set(hand.map((c) => c.id));
    if (!cards.every((c) => handIds.has(c.id))) throw new Error('所选牌不在手牌中');
    const combos = detectCombos(cards, this.level, { rules: this.rules });
    const key = comboKey(combo);
    const match = combos.find((c) => comboKey(c) === key);
    if (!match) throw new Error('与所选牌型不符');
    if (this.target && !beats(match, this.target)) throw new Error('压不过上家的牌');
    return this.commit(player, cards, match);
  }

  private commit(player: number, cards: readonly Card[], combo: Combo): Combo {
    const hand = this.hands[player];
    const ids = new Set(cards.map((c) => c.id));
    this.hands[player] = hand.filter((c) => !ids.has(c.id));
    this.lastPlay = { player, combo };
    this.passCount = 0;
    const record: PlayRecord = { player, cards: cards.slice(), combo };
    this.trickPlays.push(record);
    this.history.push(record);
    this.playedPool.push(...cards);
    this.events.push({ type: 'play', player, combo });

    if (this.hands[player].length === 0) {
      this.finishOrder.push(player);
      this.events.push({ type: 'finish', player, place: this.finishOrder.length });
      // 头游 + 二游同队 = 双下，升级已成定局（+3），没必要再打完三游/末游
      const doubleDown =
        this.rules.endEarlyOnDoubleDown &&
        this.finishOrder.length === 2 &&
        teammateOf(this.finishOrder[0]) === this.finishOrder[1];
      if (doubleDown || this.finishOrder.length >= 3) {
        this.endRound();
        return combo;
      }
    }
    this.current = this.nextActive(player);
    return combo;
  }

  pass(player: number): void {
    if (!this.canPass(player)) throw new Error('当前不能过牌');
    this.passCount += 1;
    const record: PlayRecord = { player, cards: [], combo: null };
    this.trickPlays.push(record);
    // 过牌同样记入完整牌谱，复盘时用于还原每一手的边界
    this.history.push(record);
    this.events.push({ type: 'pass', player });

    const lastP = this.lastPlay!.player;
    const activeCount = this.activePlayers().length;
    const needed = activeCount - (this.hands[lastP].length > 0 ? 1 : 0);
    if (this.passCount >= needed) {
      this.startNewTrick();
      return;
    }
    this.current = this.nextActive(player);
  }

  private startNewTrick(): void {
    const lastP = this.lastPlay!.player;
    const partner = teammateOf(lastP);
    let leader: number;
    let borrowed = false;
    if (this.hands[lastP].length > 0) {
      leader = lastP;
    } else {
      leader = this.hands[partner].length > 0 ? partner : this.nextActive(lastP);
      borrowed = leader === partner;
    }
    this.lastTrickPlays = this.trickPlays;
    this.trickPlays = [];
    this.passCount = 0;
    this.lastPlay = null;
    this.current = leader;
    this.events.push({ type: 'trick', leader, borrowed });
  }

  // ---------------------------------------------------------------- 结算

  private endRound(): void {
    // 双下提前结束时分不出三游/末游，按剩余手牌数排名（少的在前）给个合理次序
    const remaining = [0, 1, 2, 3]
      .filter((p) => !this.finishOrder.includes(p))
      .sort((a, b) => this.hands[a].length - this.hands[b].length || a - b);
    const order = [...this.finishOrder, ...remaining];
    const levelsBefore: [number, number] = [this.levels[0], this.levels[1]];
    const levelTeamBefore = this.levelTeam;

    const outcome = applyRoundResult({
      finishOrder: order,
      levels: this.levels,
      aAttempts: this.aAttempts,
      levelTeam: this.levelTeam,
      aRoundTeam: this.aRoundTeam,
      rules: this.rules,
    });

    this.levels = outcome.levels;
    this.aAttempts = outcome.aAttempts;
    this.prevFinishOrder = order;
    this.levelTeam = outcome.headTeam;
    this.matchWinner = outcome.matchWinner;
    this.roundResult = {
      finishOrder: order,
      headTeam: outcome.headTeam,
      gain: outcome.gain,
      levelsBefore,
      levelsAfter: [this.levels[0], this.levels[1]],
      levelTeamBefore,
      wasARound: outcome.wasARound,
      passedA: outcome.passedA,
      aReset: outcome.aReset,
      matchWinner: outcome.matchWinner,
    };
    this.phase = outcome.matchWinner !== null ? 'matchEnd' : 'roundEnd';
    this.lastTrickPlays = this.trickPlays;
    this.trickPlays = [];
    this.lastPlay = null;
    this.events.push({ type: 'roundEnd', result: this.roundResult });
    if (outcome.matchWinner !== null) {
      this.events.push({ type: 'matchEnd', team: outcome.matchWinner });
    }
  }

  /** 当前级牌的展示文本 */
  levelLabel(team = this.levelTeam): string {
    return levelText(this.levels[team]);
  }

  /** 导出快照（存档用） */
  snapshot(): Record<string, unknown> {
    return {
      rules: this.rules,
      round: this.round,
      levels: this.levels,
      aAttempts: this.aAttempts,
      levelTeam: this.levelTeam,
      phase: this.phase,
      hands: this.hands,
      current: this.current,
      lastPlay: this.lastPlay,
      passCount: this.passCount,
      finishOrder: this.finishOrder,
      history: this.history,
      playedPool: this.playedPool,
      pending: this.pending,
      tributes: this.tributes,
      antiTributePlayers: this.antiTributePlayers,
      prevFinishOrder: this.prevFinishOrder,
      aRoundTeam: this.aRoundTeam,
    };
  }

  static fromSnapshot(snap: Record<string, unknown>, seed = 1): GuandanGame {
    const game = new GuandanGame(snap.rules as Partial<RuleConfig>, seed);
    Object.assign(game, {
      round: snap.round,
      levels: snap.levels,
      aAttempts: snap.aAttempts,
      levelTeam: snap.levelTeam,
      phase: snap.phase,
      hands: snap.hands,
      current: snap.current,
      lastPlay: snap.lastPlay,
      passCount: snap.passCount,
      finishOrder: snap.finishOrder,
      history: snap.history,
      playedPool: snap.playedPool,
      pending: snap.pending,
      tributes: snap.tributes,
      antiTributePlayers: snap.antiTributePlayers,
      prevFinishOrder: snap.prevFinishOrder,
      aRoundTeam: snap.aRoundTeam,
    });
    return game;
  }

  /** 剩余手牌数（UI 展示） */
  handCounts(): number[] {
    return this.hands.map((h) => h.length);
  }

  /**
   * 记牌：某自然点数还有几张在**别人**手里（总数 - 已打出 - 我的手牌）。
   * AI 判断"我这张是不是当前最大"时使用。
   */
  remainingRankCount(rank: number, excludePlayer: number): number {
    const total = rank >= 15 ? 2 : 8;
    const played = this.playedPool.filter((c) => c.rank === rank).length;
    const mine = this.hands[excludePlayer].filter((c) => c.rank === rank).length;
    return Math.max(0, total - played - mine);
  }

  /** 出牌顺序（用于 UI 布局：逆时针） */
  seatOrder(): number[] {
    return [0, 1, 2, 3];
  }

  /** 某玩家已出牌张数排名（用于展示） */
  playedCounts(): number[] {
    return [0, 1, 2, 3].map((p) => this.playedPoolCount(p));
  }

  private playedPoolCount(player: number): number {
    return this.history
      .filter((h) => h.player === player)
      .reduce((n, h) => n + h.cards.length, 0);
  }

  /** 当前手牌按点数的排序值，供 UI 判断级牌高亮 */
  isLevelCard(card: Card): boolean {
    return card.rank === this.level;
  }

  orderValueOf(card: Card): number {
    return orderValue(card, this.level);
  }
}
