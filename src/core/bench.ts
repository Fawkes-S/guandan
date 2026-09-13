import { GuandanGame } from './engine';
import { decidePlay, decideReturn, type Difficulty } from './ai';
import { mulberry32 } from './cards';

/**
 * 自对弈基准：让两个难度档各坐一队打完整场比赛，统计胜率、平均局数与平均决策耗时。
 *
 * 说明：为了让基准可复现，所有随机数都由固定种子派生；
 * 默认每个种子交换一次阵营（A 坐 0/2 位、A 坐 1/3 位各打一场），消除发牌运气。
 */

export interface BenchProfile {
  name: string;
  difficulty: Difficulty;
}

export interface MatchRecord {
  seed: number;
  /** 队伍 0（0、2 号位）的难度档名字 */
  team0: string;
  winner: number | null;
  rounds: number;
  decisions: number;
  decisionMs: number;
}

export interface BenchOptions {
  profileA: BenchProfile;
  profileB: BenchProfile;
  /** 使用的种子数量（默认每个种子打 2 场，交换阵营） */
  seeds: number;
  seedBase?: number;
  maxRounds?: number;
  swapSides?: boolean;
}

export interface BenchResult {
  profileA: string;
  profileB: string;
  /** profileA 取胜的场次 */
  winsA: number;
  /** profileB 取胜的场次 */
  winsB: number;
  /** 分出胜负的场次（排除达到 maxRounds 仍未结束的） */
  decided: number;
  /** 未分胜负的场次 */
  undecided: number;
  /** 平均局数（所有已跑场次） */
  avgRounds: number;
  /** 平均每次 decidePlay 耗时（毫秒） */
  avgDecisionMs: number;
  /** decidePlay 调用次数 */
  decisions: number;
  matches: MatchRecord[];
  elapsedMs: number;
}

function difficultyOf(options: BenchOptions, player: number, aOnTeam0: boolean): Difficulty {
  const aSeat = aOnTeam0 ? player % 2 === 0 : player % 2 === 1;
  return aSeat ? options.profileA.difficulty : options.profileB.difficulty;
}

function playMatch(
  seed: number,
  options: BenchOptions,
  aOnTeam0: boolean,
): MatchRecord {
  const game = new GuandanGame({}, seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxRounds = options.maxRounds ?? 30;
  let decisions = 0;
  let decisionMs = 0;

  while (game.phase !== 'matchEnd' && game.round < maxRounds) {
    game.startRound();
    let guard = 0;
    while (game.phase === 'returnTribute' || game.phase === 'playing') {
      if (game.phase === 'returnTribute') {
        const req = game.pending[0];
        if (!req) break;
        const id = decideReturn(game, req.player, difficultyOf(options, req.player, aOnTeam0), rng);
        game.submitReturn(req.player, id);
      } else {
        const player = game.current;
        const t0 = performance.now();
        const decision = decidePlay(game, player, difficultyOf(options, player, aOnTeam0), rng);
        decisionMs += performance.now() - t0;
        decisions += 1;
        if (decision.action === 'pass') game.pass(player);
        else game.play(player, decision.cards);
      }
      if (++guard > 20000) throw new Error('自对弈疑似死循环');
    }
  }

  return {
    seed,
    team0: aOnTeam0 ? options.profileA.name : options.profileB.name,
    winner: game.matchWinner,
    rounds: game.round,
    decisions,
    decisionMs,
  };
}

/** 跑一批自对弈并汇总 */
export function runBenchmark(options: BenchOptions): BenchResult {
  const started = performance.now();
  const swap = options.swapSides ?? true;
  const matches: MatchRecord[] = [];
  for (let i = 0; i < options.seeds; i++) {
    const seed = (options.seedBase ?? 1000) + i * 7919;
    matches.push(playMatch(seed, options, true));
    if (swap) matches.push(playMatch(seed + 104729, options, false));
  }

  let winsA = 0;
  let winsB = 0;
  let decided = 0;
  let rounds = 0;
  let decisions = 0;
  let decisionMs = 0;
  for (const m of matches) {
    rounds += m.rounds;
    decisions += m.decisions;
    decisionMs += m.decisionMs;
    if (m.winner === null) continue;
    decided += 1;
    const aOnTeam0 = m.team0 === options.profileA.name;
    const aWon = (m.winner === 0) === aOnTeam0;
    if (aWon) winsA += 1;
    else winsB += 1;
  }

  return {
    profileA: options.profileA.name,
    profileB: options.profileB.name,
    winsA,
    winsB,
    decided,
    undecided: matches.length - decided,
    avgRounds: matches.length > 0 ? rounds / matches.length : 0,
    avgDecisionMs: decisions > 0 ? decisionMs / decisions : 0,
    decisions,
    matches,
    elapsedMs: performance.now() - started,
  };
}

export interface DecisionTiming {
  difficulty: Difficulty;
  samples: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

/**
 * 测量 27 张满手牌时的 decidePlay 耗时（首出决策，最坏情况之一）。
 */
export function measureDecisionTime(
  difficulty: Difficulty,
  samples = 200,
  seedBase = 424242,
): DecisionTiming {
  // 预热：用与测量完全相同的发牌序列先跑一遍，避免把 JIT / 首次分配算进平均值
  const warmCount = Math.min(samples, 60);
  for (let i = 0; i < warmCount; i++) {
    const warm = new GuandanGame({}, seedBase + i * 104729);
    warm.startRound();
    decidePlay(warm, warm.current, difficulty, mulberry32(seedBase + i * 7919));
  }
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const game = new GuandanGame({}, seedBase + i * 104729);
    game.startRound();
    const player = game.current;
    const rng = mulberry32(seedBase + i * 7919);
    const t0 = performance.now();
    decidePlay(game, player, difficulty, rng);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((s, t) => s + t, 0);
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? 0;
  return {
    difficulty,
    samples: times.length,
    avgMs: times.length > 0 ? sum / times.length : 0,
    maxMs: times.length > 0 ? times[times.length - 1] : 0,
    p95Ms: p95,
  };
}

export interface WinRateRow {
  profileA: string;
  profileB: string;
  winsA: number;
  winsB: number;
  decided: number;
  undecided: number;
  winRateA: number;
  avgRounds: number;
  avgDecisionMs: number;
}

export function summarize(result: BenchResult): WinRateRow {
  return {
    profileA: result.profileA,
    profileB: result.profileB,
    winsA: result.winsA,
    winsB: result.winsB,
    decided: result.decided,
    undecided: result.undecided,
    winRateA: result.decided > 0 ? result.winsA / result.decided : 0,
    avgRounds: result.avgRounds,
    avgDecisionMs: result.avgDecisionMs,
  };
}
