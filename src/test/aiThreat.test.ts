import { describe, expect, it } from 'vitest';
import { GuandanGame } from '../core/engine';
import { decidePlay } from '../core/ai';
import { classify } from '../core/combos';
import { H } from './helpers';

/**
 * 威胁反应回归：对手只剩 1 张牌时，AI 必须把它当回事。
 * 之前只有「困难」档会反应，默认的「普通」档完全无视 —— 这是实战里最刺眼的 AI 缺陷。
 */
function mk(hands: string[][], lead: { p: number; card: string }, level = 5): GuandanGame {
  const g = new GuandanGame({}, 1);
  g.phase = 'playing';
  g.hands = hands.map((h) => H(...h));
  g.levels = [level, level];
  g.levelTeam = 0;
  g.lastPlay = { player: lead.p, combo: classify(H(lead.card), level)! };
  g.passCount = 0;
  g.finishOrder = [];
  g.events = [];
  return g;
}

const LEVELS = ['normal', 'hard'] as const;

describe('对手只剩 1 张时的威胁反应', () => {
  for (const difficulty of LEVELS) {
    it(`${difficulty}：对手领出、自己能压 → 必须拦截`, () => {
      const g = mk([['S3', 'S4', 'SK'], ['C9'], ['D5', 'D6'], ['S2']], { p: 1, card: 'C9' });
      g.hands[1] = [];
      g.current = 0;
      const d = decidePlay(g, 0, difficulty);
      expect(d.action).toBe('play');
    });

    it(`${difficulty}：队友只出了张小牌、对手只剩 1 张 → 抢过出牌权`, () => {
      const g = mk([['S3', 'S4'], ['C9'], ['CA', 'HQ', 'D7'], ['S2', 'D2']], { p: 0, card: 'C7' });
      g.current = 2;
      const d = decidePlay(g, 2, difficulty);
      expect(d.action).toBe('play');
    });

    it(`${difficulty}：队友那手已经很硬（对手压不过）→ 不必抢`, () => {
      // 队友打出 4 张炸弹，对手只剩 1 张
      const g = mk(
        [['S3', 'S4'], ['C9'], ['SA', 'S2', 'S3', 'S4'], ['D2', 'D3']],
        { p: 0, card: 'C7' },
      );
      g.lastPlay = { player: 0, combo: classify(H('S9', 'D9', 'C9', 'H9'), 5)! };
      g.hands[0] = H('S3', 'S4');
      g.current = 2;
      const d = decidePlay(g, 2, difficulty);
      // 手里没有更大的炸弹，只能过牌
      expect(d.action).toBe('pass');
    });
  }

  it('对手还有 4 张时，队友出小牌不抢（保持正常配合）', () => {
    const g = mk(
      [['S3', 'S4'], ['C9', 'D9', 'C10', 'D10'], ['CA', 'HQ', 'D7'], ['S2', 'D2']],
      { p: 0, card: 'C7' },
    );
    g.current = 2;
    const d = decidePlay(g, 2, 'hard');
    expect(d.action).toBe('pass');
  });
});
