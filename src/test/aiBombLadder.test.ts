import { describe, expect, it } from 'vitest';
import { GuandanGame } from '../core/engine';
import { decidePlay } from '../core/ai';
import { classify } from '../core/combos';
import { ComboType } from '../core/types';
import { H } from './helpers';

/**
 * 回归：炸弹必须按"阶梯"使用 —— 越大的炸越贵，先用够用的小炸。
 *
 * 实战事故：上家手里同时有 4 张 K 炸和梅花同花顺，面对对家的钢板，
 * 它直接烧了同花顺。原因是当时"只有炸弹能压"的场面会让同花顺免罚，
 * 于是同花顺看起来比 4 张炸还便宜。
 */
function mk(aiHand: string[], targetCards: string[], oppCards: string[], level = 3): GuandanGame {
  const g = new GuandanGame({}, 1);
  g.phase = 'playing';
  g.levels = [level, level];
  g.levelTeam = 0;
  g.hands = [
    H('SQ', 'DQ', 'CQ', 'HQ', 'SJ', 'DJ'),
    H(...oppCards),
    H('S6', 'D6', 'C6', 'S7', 'D7', 'C7'),
    H(...aiHand),
  ];
  g.lastPlay = { player: 2, combo: classify(H(...targetCards), level)! };
  g.current = 3;
  g.passCount = 0;
  g.finishOrder = [];
  g.events = [];
  return g;
}

const AI_WITH_BOTH = ['SK', 'DK', 'CK', 'HK', 'C3', 'C4', 'C5', 'C6', 'C7'];

describe('炸弹使用阶梯', () => {
  it('手里同时有 4 张 K 炸和同花顺时，优先用 4 张 K 炸', () => {
    const g = mk(AI_WITH_BOTH, ['S6', 'D6', 'C6', 'S7', 'D7', 'C7'], ['S9']);
    const d = decidePlay(g, 3, 'hard');
    expect(d.action).toBe('play');
    expect(d.cards).toHaveLength(4);
    const combo = classify(d.cards, 3)!;
    expect(combo.type).toBe(ComboType.Bomb);
    expect(combo.power).toBeLessThan(105); // 不是同花顺
  });

  it('4 张炸压不过 5 张炸时，才用同花顺', () => {
    const g = mk(AI_WITH_BOTH, ['S4', 'D4', 'C4', 'H4', 'S4'], ['S9']);
    const d = decidePlay(g, 3, 'hard');
    if (d.action === 'play') {
      const combo = classify(d.cards, 3)!;
      expect(combo.type).toBe(ComboType.StraightFlush);
    }
  });

  it('开局对家出钢板、手里牌还多时，不该急着炸', () => {
    const g = mk([...AI_WITH_BOTH, 'S2', 'D2'], ['S6', 'D6', 'C6', 'S7', 'D7', 'C7'], ['S9', 'D9']);
    const d = decidePlay(g, 3, 'normal');
    expect(d.action).toBe('pass');
  });

  it('绝不炸队友的牌', () => {
    const g = mk(AI_WITH_BOTH, ['S6', 'D6', 'C6', 'S7', 'D7', 'C7'], ['S9']);
    // 把钢板改成队友（座位 0 的队友是 2 … 这里让座位 1 出，它是 3 的队友）
    g.lastPlay = { player: 1, combo: classify(H('S6', 'D6', 'C6', 'S7', 'D7', 'C7'), 3)! };
    const d = decidePlay(g, 3, 'hard');
    expect(d.action).toBe('pass');
  });
});
