import { RANK_A, RANK_BIG_JOKER, RANK_SMALL_JOKER, type Card, type Suit } from '../core/types';

let nextId = 0;

/** 构造一张牌：'S3' 黑桃3 / 'H10' 红桃10 / 'DA' 方块A / 'BJ' 小王 / 'RJ' 大王 */
export function C(code: string): Card {
  if (code === 'BJ') return { id: nextId++, suit: 'J', rank: RANK_SMALL_JOKER, deck: 0 };
  if (code === 'RJ') return { id: nextId++, suit: 'J', rank: RANK_BIG_JOKER, deck: 0 };
  const suit = code[0] as Suit;
  const rest = code.slice(1);
  let rank: number;
  if (rest === 'A') rank = RANK_A;
  else if (rest === 'K') rank = 13;
  else if (rest === 'Q') rank = 12;
  else if (rest === 'J') rank = 11;
  else rank = Number(rest);
  if (!Number.isFinite(rank)) throw new Error(`无法解析的牌：${code}`);
  return { id: nextId++, suit, rank, deck: 0 };
}

export function H(...codes: string[]): Card[] {
  return codes.map(C);
}

/** 重置 id 计数，保证用例之间互不干扰 */
export function resetIds(): void {
  nextId = 0;
}

// ------------------------------------------------------------------ 测试驱动器

import { enumeratePlays } from '../core/candidates';
import type { GuandanGame } from '../core/engine';

/**
 * 用"随机合法出牌"策略推进一回合，供引擎测试使用。
 * 保证不会产生非法动作——合法性由引擎自己校验。
 */
export function stepRandom(game: GuandanGame, rng: () => number): void {
  if (game.phase === 'returnTribute') {
    const req = game.pending[0];
    const pick = req.candidateIds[Math.floor(rng() * req.candidateIds.length)];
    game.submitReturn(req.player, pick);
    return;
  }
  if (game.phase !== 'playing') throw new Error(`无法推进的阶段：${game.phase}`);
  const player = game.current;
  const options = enumeratePlays(game.hands[player], game.level, game.target, game.rules);
  if (game.target) {
    if (options.length === 0 || rng() < 0.35) {
      game.pass(player);
      return;
    }
  }
  const idx = Math.floor(rng() * Math.min(options.length, 6));
  game.play(player, options[idx].cards);
}

/** 打完一整局；返回实际执行的动作数 */
export function playRound(game: GuandanGame, rng: () => number, maxSteps = 5000): number {
  game.startRound();
  let steps = 0;
  while (game.phase === 'returnTribute' || game.phase === 'playing') {
    stepRandom(game, rng);
    steps += 1;
    if (steps > maxSteps) throw new Error('单局动作数超限，可能存在死循环');
  }
  return steps;
}

