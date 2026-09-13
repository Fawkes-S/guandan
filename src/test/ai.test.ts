import { describe, expect, it } from 'vitest';
import { GuandanGame } from '../core/engine';
import { decidePlay, decideReturn, isLikelyUnbeatable } from '../core/ai';
import { aiStep, simulateMatch } from '../core/autoplay';
import { beats } from '../core/compare';
import { validatePlay } from '../core/candidates';
import { detectCombos } from '../core/combos';
import { mulberry32 } from '../core/cards';
import { evaluateHand } from '../core/handEval';
import { ComboType, type Card } from '../core/types';
import { C, H } from './helpers';

function comboOf(cards: Card[], level: number) {
  return detectCombos(cards, level, {})[0];
}

function makeGame(): GuandanGame {
  const g = new GuandanGame({}, 1);
  g.phase = 'playing';
  g.current = 0;
  g.finishOrder = [];
  g.playedPool = [];
  g.passCount = 0;
  g.lastPlay = null;
  return g;
}

describe('AI 基本行为', () => {
  it('首出时一定会出牌，且牌来自手牌', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new GuandanGame({}, seed);
      g.startRound();
      const p = g.current;
      const d = decidePlay(g, p, 'normal');
      expect(d.action).toBe('play');
      expect(d.cards.length).toBeGreaterThan(0);
      const ids = new Set(g.hands[p].map((c) => c.id));
      expect(d.cards.every((c) => ids.has(c.id))).toBe(true);
    }
  });

  it('跟牌时要么过牌，要么出能压过目标的合法牌', () => {
    const rng = mulberry32(2024);
    for (let seed = 1; seed <= 25; seed++) {
      const g = new GuandanGame({}, seed);
      g.startRound();
      for (let step = 0; step < 40 && g.phase === 'playing'; step++) {
        const p = g.current;
        const target = g.target;
        const d = decidePlay(g, p, 'hard', rng);
        if (target === null) {
          expect(d.action).toBe('play');
          g.play(p, d.cards);
          continue;
        }
        if (d.action === 'pass') {
          g.pass(p);
        } else {
          const res = validatePlay(g.hands[p], d.cards, g.level, target, g.rules);
          expect(res.ok).toBe(true);
          if (res.ok) expect(beats(res.combo, target)).toBe(true);
          g.play(p, d.cards);
        }
      }
    }
  });

  it('压不过时必须过牌', () => {
    const g = new GuandanGame({}, 3);
    g.phase = 'playing';
    g.hands = [[C('S3'), C('S4')], [C('RJ'), C('RJ')], [C('S6')], [C('S7')]];
    g.current = 1;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [];
    g.play(1, [g.hands[1][0], g.hands[1][1]]); // 对大王
    expect(g.current).toBe(2);
    const d = decidePlay(g, 2, 'hard');
    expect(d.action).toBe('pass');
    expect(g.canPass(2)).toBe(true);
  });

  it('还贡返回候选牌中的一张', () => {
    for (let seed = 1; seed < 60; seed++) {
      const g = new GuandanGame({}, seed);
      g.round = 1;
      g.prevFinishOrder = [0, 1, 2, 3];
      g.startRound();
      if (g.phase !== 'returnTribute') continue;
      const req = g.pending[0];
      const id = decideReturn(g, req.player, 'normal');
      expect(req.candidateIds).toContain(id);
      g.submitReturn(req.player, id);
      expect(g.phase).toBe('playing');
      return;
    }
    throw new Error('未找到未抗贡的种子');
  });
});

describe('AI 自动对局', () => {
  it('AI vs AI 连跑多场无非法动作、无死锁', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed * 7717);
      const g = new GuandanGame({}, seed * 13);
      const result = simulateMatch(g, 'normal', rng, 30);
      expect(result.actions).toBeGreaterThan(0);
      expect(result.rounds).toBeGreaterThan(0);
      if (result.matchWinner !== null) {
        expect([0, 1]).toContain(result.matchWinner);
      }
    }
  }, 120000);

  it('三档难度都能跑完整局', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const g = new GuandanGame({}, 55);
      playRoundAi(g, difficulty, 99);
      expect(g.roundResult).not.toBeNull();
    }
  });
});

function playRoundAi(g: GuandanGame, difficulty: 'easy' | 'normal' | 'hard', seed: number): number {
  const rng = mulberry32(seed);
  g.startRound();
  let steps = 0;
  while (g.phase === 'returnTribute' || g.phase === 'playing') {
    aiStep(g, { human: null, difficulty, rng });
    if (++steps > 5000) throw new Error('死循环');
  }
  return steps;
}

describe('AI 决策质量（相对基准）', () => {
  it('困难档对简单档胜率不低', () => {
    let hardWins = 0;
    let games = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed * 31337);
      const g = new GuandanGame({}, seed * 101);
      // 队伍 0 = {0,2} 用困难档，队伍 1 = {1,3} 用简单档
      const result = simulateMatch(g, (p) => (p % 2 === 0 ? 'hard' : 'easy'), rng, 30);
      if (result.matchWinner === null) continue;
      games += 1;
      if (result.matchWinner === 0) hardWins += 1;
    }
    expect(games).toBeGreaterThan(5);
    expect(hardWins / games).toBeGreaterThanOrEqual(0.5);
  }, 180000);

  it('困难档能识别出无人能压的大牌', () => {
    const g = new GuandanGame({}, 9);
    g.phase = 'playing';
    g.hands = [[], [], [], []];
    const big = { id: 9001, suit: 'J' as const, rank: 16, deck: 0 as const };
    g.hands[0] = [big];
    const combo = {
      type: ComboType.Single,
      cards: [big],
      rank: 17,
      power: 0,
      isBomb: false,
      label: '单张',
    };
    expect(isLikelyUnbeatable(g, 0, combo)).toBe(true);
  });

  it('炸弹是否最大也要看记牌', () => {
    const g = new GuandanGame({}, 11);
    g.phase = 'playing';
    g.hands = [[], [], [], []];
    const level = g.level;
    g.hands[0] = H('S5', 'H5', 'D5', 'C5');
    const bomb = comboOf(g.hands[0], level);
    // 对 A 一定被外面的王对压住
    expect(isLikelyUnbeatable(g, 0, comboOf(H('SA', 'DA'), level))).toBe(false);
    // 别人手里没牌，不可能有更大的炸弹
    expect(isLikelyUnbeatable(g, 0, bomb)).toBe(true);
    // 别人手里牌很多时，更大的炸弹可能存在
    g.hands[3] = H('S2', 'S3', 'S4', 'S6', 'S7', 'S8', 'S9', 'S10');
    expect(isLikelyUnbeatable(g, 0, bomb)).toBe(false);
  });
});

describe('手牌估值', () => {
  it('顺子 + 对子的手数明显少于同数量散牌', () => {
    const level = 2;
    const straightPair = H('S3', 'S4', 'S5', 'S6', 'S7', 'H9', 'D9');
    const scattered = H('S2', 'S3', 'S5', 'S7', 'S9', 'SJ', 'SK', 'SA');
    const a = evaluateHand(straightPair, level);
    const b = evaluateHand(scattered, level);
    expect(a.hands).toBeLessThanOrEqual(2);
    expect(a.hands).toBeLessThan(b.hands);
  });

  it('常见牌型只算一手', () => {
    const level = 2;
    expect(evaluateHand(H('S5', 'H5', 'D5', 'C5'), level).hands).toBe(1); // 炸弹
    expect(evaluateHand(H('S5', 'H5', 'D5', 'S9', 'H9'), level).hands).toBe(1); // 三带二
    expect(evaluateHand(H('S3', 'H3', 'S4', 'H4', 'S5', 'H5'), level).hands).toBe(1); // 三连对
    expect(evaluateHand(H('S3', 'H3', 'D3', 'S4', 'H4', 'D4'), level).hands).toBe(1); // 钢板
    expect(evaluateHand(H('S3', 'S4', 'S5', 'S6', 'S7'), level).hands).toBe(1); // 顺子
    expect(evaluateHand(H('S3', 'S4', 'S5', 'S6', 'S7', 'H9', 'D9'), level).hands).toBe(2); // 顺子+对子
  });

  it('逢人配能补顺子 / 补对子，显著降低手数', () => {
    const level = 2;
    const withWild = evaluateHand(H('H2', 'S3', 'S4', 'S5', 'S6'), level); // 逢人配补成 3-4-5-6-7
    const without = evaluateHand(H('S3', 'S4', 'S5', 'S6', 'D9'), level);
    expect(withWild.hands).toBe(1);
    expect(withWild.hands).toBeLessThan(without.hands);
    expect(evaluateHand(H('H2', 'SK'), level).hands).toBe(1); // 逢人配 + K 成对
    expect(evaluateHand(H('H2', 'H2', 'S9'), level).hands).toBe(1); // 两张逢人配 + 9 成三张
  });

  it('≤14 张走精确搜索，手数在合理范围内', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new GuandanGame({}, seed * 977);
      g.startRound();
      const hand = g.hands[seed % 4].slice(0, 12);
      const v = evaluateHand(hand, g.level, g.rules);
      expect(v.exact).toBe(true);
      expect(v.hands).toBeGreaterThan(0);
      expect(v.hands).toBeLessThanOrEqual(hand.length);
    }
  });
});

describe('AI 战术（威胁 / 队友 / 收尾）', () => {
  it('对手只剩一张时，困难档会用炸弹拦截', () => {
    const g = makeGame();
    const played = H('SA', 'DA');
    g.hands = [
      H('S5', 'H5', 'D5', 'C5', 'S3'), // 只有 4 张 5 炸弹能压过对 A
      H('S9'), // 对手只剩一张
      H('S8', 'H8'),
      H('S2', 'S3', 'S4', 'S5', 'S6', 'S7'),
    ];
    g.lastPlay = { player: 3, combo: comboOf(played, g.level) };
    const d = decidePlay(g, 0, 'hard', mulberry32(7));
    expect(d.action).toBe('play');
    expect(d.cards.length).toBe(4);
  });

  it('不会炸队友的赢牌', () => {
    const g = makeGame();
    const played = H('SA', 'DA');
    g.hands = [
      H('S5', 'H5', 'D5', 'C5', 'S3', 'S4', 'S6', 'S7', 'S9', 'S10'),
      H('S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'),
      H('S8', 'H8', 'D8', 'S9', 'H9', 'D9', 'S10'),
      H('S2', 'H2', 'D2', 'S3', 'H3', 'D3', 'S4'),
    ];
    g.lastPlay = { player: 2, combo: comboOf(played, g.level) };
    const d = decidePlay(g, 0, 'hard', mulberry32(7));
    expect(d.action).toBe('pass');
  });

  it('队友只剩一张时会喂最小单张', () => {
    const g = makeGame();
    g.hands = [
      H('S3', 'S9', 'SK', 'D5'),
      H('S2', 'S3', 'S4', 'S5', 'S6'),
      H('S7'), // 队友剩一张
      H('S8', 'S9', 'S10', 'SJ'),
    ];
    const d = decidePlay(g, 0, 'hard', mulberry32(3));
    expect(d.action).toBe('play');
    expect(d.cards.length).toBe(1);
    expect(d.cards[0].rank).toBe(3);
  });

  it('能一把走完时一定走完', () => {
    const g = makeGame();
    g.hands = [
      H('S3', 'S4', 'S5', 'S6', 'S7'),
      H('S9', 'S10'),
      H('SJ', 'SQ'),
      H('SK', 'SA'),
    ];
    const d = decidePlay(g, 0, 'hard', mulberry32(1));
    expect(d.action).toBe('play');
    expect(d.cards.length).toBe(5);
  });

  it('相同局面下 hard 决策可复现', () => {
    const g1 = new GuandanGame({}, 321);
    g1.startRound();
    const p = g1.current;
    const a = decidePlay(g1, p, 'hard', mulberry32(99));
    const b = decidePlay(g1, p, 'hard', mulberry32(99));
    expect(a.action).toBe(b.action);
    expect(a.cards.map((c) => c.id)).toEqual(b.cards.map((c) => c.id));
  });
});
