import { decidePlay, decideReturn, type Difficulty } from './ai';
import type { GuandanGame } from './engine';

export type StepResult = 'acted' | 'human-turn' | 'round-ended' | 'match-ended';

export interface AutoplayConfig {
  /** 人类玩家座位；null 表示全 AI 自动对局 */
  human: number | null;
  difficulty: Difficulty | ((player: number) => Difficulty);
  rng?: () => number;
}

function resolveDifficulty(
  difficulty: AutoplayConfig['difficulty'],
  player: number,
): Difficulty {
  return typeof difficulty === 'function' ? difficulty(player) : difficulty;
}

/**
 * 推进一个 AI 决策；如果轮到人类玩家则返回 'human-turn' 不做任何事。
 * UI 的自动循环与 AI 自动对局测试共用此函数。
 */
export function aiStep(game: GuandanGame, config: AutoplayConfig): StepResult {
  const rng = config.rng ?? Math.random;
  if (game.phase === 'returnTribute') {
    const req = game.pending[0];
    if (!req) return 'round-ended';
    if (config.human !== null && req.player === config.human) return 'human-turn';
    const id = decideReturn(game, req.player, resolveDifficulty(config.difficulty, req.player), rng);
    game.submitReturn(req.player, id);
    return 'acted';
  }
  if (game.phase === 'playing') {
    const player = game.current;
    if (config.human !== null && player === config.human) return 'human-turn';
    const decision = decidePlay(game, player, resolveDifficulty(config.difficulty, player), rng);
    if (decision.action === 'pass') game.pass(player);
    else game.play(player, decision.cards);
    return 'acted';
  }
  if (game.phase === 'roundEnd') return 'round-ended';
  return 'match-ended';
}

export interface SimulationResult {
  rounds: number;
  actions: number;
  matchWinner: number | null;
  levelHistory: Array<[number, number]>;
}

/** 全 AI 自动跑一整场比赛（测试与观战用） */
export function simulateMatch(
  game: GuandanGame,
  difficulty: AutoplayConfig['difficulty'] = 'normal',
  rng: () => number = Math.random,
  maxRounds = 40,
): SimulationResult {
  let actions = 0;
  const levelHistory: Array<[number, number]> = [];
  while (game.phase !== 'matchEnd' && game.round < maxRounds) {
    game.startRound();
    let guard = 0;
    while (game.phase === 'returnTribute' || game.phase === 'playing') {
      aiStep(game, { human: null, difficulty, rng });
      actions += 1;
      if (++guard > 20000) throw new Error('自动对局疑似死循环');
    }
    levelHistory.push([game.levels[0], game.levels[1]]);
  }
  return {
    rounds: game.round,
    actions,
    matchWinner: game.matchWinner,
    levelHistory,
  };
}
