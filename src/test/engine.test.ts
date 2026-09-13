import { describe, expect, it } from 'vitest';
import { GuandanGame } from '../core/engine';
import { applyRoundResult } from '../core/scoring';
import { planTribute, canAntiTribute, returnCandidates, tributeCard } from '../core/tribute';
import { orderValue } from '../core/cards';
import { DEFAULT_RULES, type RuleConfig } from '../core/rules';
import { ComboType } from '../core/types';
import { C, H, playRound, stepRandom } from './helpers';
import { mulberry32 } from '../core/cards';

function freshGame(rules: Partial<RuleConfig> = {}, seed = 7): GuandanGame {
  return new GuandanGame(rules, seed);
}

describe('发牌', () => {
  it('四家各 27 张，合计 108 张且无重复', () => {
    const g = freshGame();
    g.startRound();
    expect(g.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    const ids = new Set(g.hands.flat().map((c) => c.id));
    expect(ids.size).toBe(108);
    expect(g.phase).toBe('playing');
    expect(g.level).toBe(2);
  });
});

describe('出牌流程', () => {
  it('首出不能过牌，轮次不对不能出牌', () => {
    const g = freshGame();
    g.startRound();
    const first = g.current;
    expect(g.canPass(first)).toBe(false);
    expect(() => g.pass(first)).toThrow();
    const other = (first + 1) % 4;
    expect(() => g.play(other, [g.hands[other][0]])).toThrow();
  });

  it('出牌后手牌减少，非法牌型被拒绝', () => {
    const g = freshGame();
    g.startRound();
    const p = g.current;
    const before = g.hands[p].length;
    g.play(p, [g.hands[p][0]]);
    expect(g.hands[p]).toHaveLength(before - 1);
    expect(g.target).not.toBeNull();
    const q = g.current;
    expect(() => g.play(q, [])).toThrow();
  });

  it('三家过牌后由最后出牌者重新首出', () => {
    const g = freshGame();
    g.startRound();
    const leader = g.current;
    g.play(leader, [g.hands[leader][0]]);
    let guard = 0;
    while (g.target !== null && guard++ < 8) g.pass(g.current);
    expect(g.current).toBe(leader);
    expect(g.target).toBeNull();
  });
});

describe('接风（对门借风）', () => {
  it('出完牌后其他三家全过，由对家接风', () => {
    const g = freshGame();
    g.phase = 'playing';
    g.hands = [[C('S3'), C('S4')], [C('S5')], [C('S6'), C('S7')], [C('S8'), C('S9')]];
    g.current = 1;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [];
    g.events = [];

    g.play(1, [g.hands[1][0]]); // 玩家1 出完
    expect(g.finishOrder).toEqual([1]);
    expect(g.current).toBe(2);
    g.pass(2);
    g.pass(3);
    g.pass(0);
    expect(g.current).toBe(3); // 1 的对家
    const trick = g.drainEvents().find((e) => e.type === 'trick');
    expect(trick).toEqual({ type: 'trick', leader: 3, borrowed: true });
  });

  it('出完牌后其余三家全过，由对家接风（对家还在场上）', () => {
    const g = freshGame();
    g.phase = 'playing';
    g.hands = [[C('S3')], [C('S4')], [C('S6')], [C('S7')]];
    g.current = 1;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [2]; // 2 已走完，与 1 不同队（不会触发双下提前结束）
    g.events = [];

    g.play(1, [g.hands[1][0]]); // 1 出完最后一手
    expect(g.finishOrder).toEqual([2, 1]);
    g.pass(2);
    g.pass(3);
    g.pass(0);
    expect(g.current).toBe(3); // 1 的对家接风
    const trick = g.drainEvents().find((e) => e.type === 'trick');
    expect(trick).toEqual({ type: 'trick', leader: 3, borrowed: true });
  });

  it('对家也走完时顺延给下家', () => {
    // 开启双下提前结束的话，「对家也走完」必然触发双下收局，这条分支只在不提前结束时可达
    const g = freshGame({ endEarlyOnDoubleDown: false });
    g.phase = 'playing';
    g.hands = [[C('S3')], [C('S4')], [C('S6')], []];
    g.current = 1;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [3]; // 1 的对家 3 已走完
    g.events = [];

    g.play(1, [g.hands[1][0]]);
    expect(g.finishOrder).toEqual([3, 1]);
    expect(g.current).toBe(2);
    g.pass(2);
    g.pass(0);
    expect(g.current).toBe(2); // 对家已出完，顺延给下一个还有牌的人
    const trick = g.drainEvents().find((e) => e.type === 'trick');
    expect(trick).toEqual({ type: 'trick', leader: 2, borrowed: false });
  });
});

describe('升级结算', () => {
  const base = {
    levels: [2, 2] as [number, number],
    aAttempts: [0, 0] as [number, number],
    levelTeam: 0,
    aRoundTeam: null,
    rules: DEFAULT_RULES,
  };

  it('头游+二游升 3 级，+三游升 2 级，+末游升 1 级', () => {
    expect(applyRoundResult({ ...base, finishOrder: [0, 2, 1, 3] }).gain).toBe(3);
    expect(applyRoundResult({ ...base, finishOrder: [0, 1, 2, 3] }).gain).toBe(2);
    expect(applyRoundResult({ ...base, finishOrder: [0, 1, 3, 2] }).gain).toBe(1);
  });

  it('升级不会跳过 A', () => {
    const out = applyRoundResult({ ...base, levels: [13, 2], finishOrder: [0, 2, 1, 3] });
    expect(out.levels[0]).toBe(14);
  });

  it('打 A 局：头游+二游过 A 获胜', () => {
    const out = applyRoundResult({
      ...base,
      levels: [14, 5],
      levelTeam: 0,
      aRoundTeam: 0,
      finishOrder: [0, 2, 1, 3],
    });
    expect(out.matchWinner).toBe(0);
    expect(out.passedA).toBe(true);
  });

  it('打 A 局：头游+末游不算过 A', () => {
    const out = applyRoundResult({
      ...base,
      levels: [14, 5],
      levelTeam: 0,
      aRoundTeam: 0,
      finishOrder: [0, 1, 3, 2],
    });
    expect(out.matchWinner).toBeNull();
    expect(out.aAttempts[0]).toBe(1);
    expect(out.levels[0]).toBe(14);
  });

  it('三次不过 A 降回 2 重新打', () => {
    const out = applyRoundResult({
      ...base,
      levels: [14, 5],
      levelTeam: 0,
      aRoundTeam: 0,
      aAttempts: [2, 0],
      finishOrder: [1, 3, 0, 2],
    });
    expect(out.matchWinner).toBeNull();
    expect(out.aReset).toBe(true);
    expect(out.levels[0]).toBe(2);
    expect(out.aAttempts[0]).toBe(0);
  });
});

describe('进贡方案', () => {
  it('双下：两名输方都进贡', () => {
    const plan = planTribute([0, 2, 1, 3], 0);
    expect(plan.kind).toBe('double');
    expect(plan.losers).toEqual([1, 3]);
  });

  it('单下：由名次更低的输方进贡', () => {
    const a = planTribute([0, 1, 2, 3], 0);
    expect(a.kind).toBe('single');
    expect(a.payer).toBe(3);
    const b = planTribute([0, 1, 3, 2], 0);
    expect(b.kind).toBe('single');
    expect(b.payer).toBe(3);
  });

  it('抗贡需要两张大王', () => {
    const hands = [[C('RJ'), C('RJ')], [C('S3')]];
    expect(canAntiTribute(hands, [0])).toBe(true);
    expect(canAntiTribute(hands, [1])).toBe(false);
    const split = [[C('RJ')], [C('RJ')]];
    expect(canAntiTribute(split, [0, 1])).toBe(true);
  });

  it('进贡牌是除逢人配外的最大牌', () => {
    const hand = H('H2', 'SA', 'D3');
    expect(tributeCard(hand, 2).rank).toBe(14);
    const hand2 = H('H2', 'D3');
    expect(tributeCard(hand2, 2).rank).toBe(3);
  });

  it('还贡只能用不大于 10 的牌', () => {
    const cands = returnCandidates(H('SA', 'DK', 'S9', 'D3'), DEFAULT_RULES);
    expect(cands.map((c) => c.rank).sort()).toEqual([3, 9]);
    // 全是大于 10 的牌时退化为任意牌
    expect(returnCandidates(H('SA', 'DK', 'RJ'), DEFAULT_RULES)).toHaveLength(3);
  });
});

describe('进贡 / 还贡流程', () => {
  it('单贡：末游进贡、头游还贡，之后由进贡者先出牌', () => {
    for (let seed = 1; seed < 80; seed++) {
      const g = new GuandanGame({}, seed);
      g.round = 1;
      g.prevFinishOrder = [0, 1, 2, 3];
      g.startRound();
      if (g.phase === 'playing') continue; // 抗贡，换种子
      expect(g.phase).toBe('returnTribute');
      expect(g.tributes).toHaveLength(1);
      const t = g.tributes[0];
      expect(t.from).toBe(3);
      expect(t.to).toBe(0);
      const req = g.pending[0];
      expect(req.player).toBe(0);
      const back = g.returnCandidatesFor(0);
      expect(back.length).toBeGreaterThan(0);
      expect(back.every((c) => c.rank <= 10 || back.length === g.hands[0].length)).toBe(true);
      g.submitReturn(0, req.candidateIds[0]);
      expect(g.phase).toBe('playing');
      expect(g.current).toBe(3);
      expect(g.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
      return;
    }
    throw new Error('未找到未抗贡的随机种子');
  });

  it('双贡：两人分别进贡给头游与二游，并各还一张', () => {
    for (let seed = 1; seed < 120; seed++) {
      const g = new GuandanGame({}, seed);
      g.round = 1;
      g.prevFinishOrder = [0, 2, 1, 3];
      g.startRound();
      if (g.phase === 'playing') continue;
      expect(g.tributes).toHaveLength(2);
      const receivers = g.tributes.map((t) => t.to).sort();
      expect(receivers).toEqual([0, 2]);
      const bigIdx = orderValue(g.tributes[0].card, g.level) >= orderValue(g.tributes[1].card, g.level) ? 0 : 1;
      expect(g.tributes[bigIdx].to).toBe(0);
      expect(g.pending).toHaveLength(2);
      while (g.pending.length > 0) {
        const req = g.pending[0];
        g.submitReturn(req.player, req.candidateIds[0]);
      }
      expect(g.phase).toBe('playing');
      expect(g.current).toBe(g.tributes[bigIdx].from);
      expect(g.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
      return;
    }
    throw new Error('未找到未抗贡的随机种子');
  });
});

describe('完整对局（随机策略）', () => {
  it('连续多局不会产生非法动作或死循环', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed * 991);
      const g = new GuandanGame({}, seed * 31);
      for (let round = 0; round < 25 && g.phase !== 'matchEnd'; round++) {
        playRound(g, rng);
        expect(g.roundResult).not.toBeNull();
        const order = g.roundResult!.finishOrder;
        expect([...order].sort()).toEqual([0, 1, 2, 3]);
        // 已出的牌 + 末游手中剩余的牌 = 108
        expect(g.hands.reduce((n, h) => n + h.length, 0) + g.playedPool.length).toBe(108);
      }
      expect(g.phase === 'matchEnd' || g.round === 25).toBe(true);
    }
  }, 60000);

  it('一局结束后按名次升级', () => {
    const rng = mulberry32(4242);
    const g = new GuandanGame({}, 2024);
    playRound(g, rng);
    const r = g.roundResult!;
    expect(r.gain).toBeGreaterThanOrEqual(1);
    expect(r.gain).toBeLessThanOrEqual(3);
    expect(g.levels[r.headTeam]).toBe(2 + r.gain);
    expect(g.levelTeam).toBe(r.headTeam);
  });
});

describe('状态机健壮性', () => {
  it('可以在任意时刻读取快照并恢复', () => {
    const g = freshGame({}, 11);
    g.startRound();
    stepRandom(g, mulberry32(3));
    stepRandom(g, mulberry32(4));
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    const restored = GuandanGame.fromSnapshot(snap);
    expect(restored.hands.map((h) => h.length)).toEqual(g.hands.map((h) => h.length));
    expect(restored.current).toBe(g.current);
    expect(restored.level).toBe(g.level);
  });

  it('统计某点数在别人手里的剩余数量', () => {
    const g = freshGame({}, 5);
    g.phase = 'playing';
    g.hands = [[C('BJ'), C('S3')], [C('BJ')], [C('RJ')], [C('RJ')]];
    g.playedPool = [];
    expect(g.remainingRankCount(15, 0)).toBe(1); // 另一张小王在别人手里
    expect(g.remainingRankCount(15, 1)).toBe(1); // 自己 1 张，别人还有 1 张
    expect(g.remainingRankCount(14, 0)).toBe(8);
  });
});

describe('事件流', () => {
  it('发牌、出牌、过牌、名次都有事件', () => {
    const rng = mulberry32(99);
    const g = new GuandanGame({}, 77);
    const steps = playRound(g, rng);
    expect(steps).toBeGreaterThan(0);
    expect(g.history.length).toBeGreaterThan(0);
    expect(g.history.some((h) => h.combo && h.combo.type === ComboType.Single)).toBe(true);
  });
});

describe('双下提前结束', () => {
  it('头游和二游同队时立刻收局，不再打三游/末游', () => {
    const g = freshGame();
    g.phase = 'playing';
    g.hands = [[C('S3')], [C('S4')], [C('S5')], [C('S6')]];
    g.current = 0;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [];
    g.events = [];

    g.play(0, [g.hands[0][0]]); // 0 走完 → 头游
    expect(g.finishOrder).toEqual([0]);
    expect(g.phase).toBe('playing');
    g.pass(1); // 1 不要
    g.play(2, [g.hands[2][0]]); // 2 走完 → 二游，与头游同队
    expect(g.finishOrder.slice(0, 2)).toEqual([0, 2]);
    expect(g.phase).not.toBe('playing');
    expect(g.roundResult).not.toBeNull();
    expect(g.roundResult!.gain).toBe(3);
    expect([...g.roundResult!.finishOrder].sort()).toEqual([0, 1, 2, 3]);
  });

  it('关闭该配置后仍然打完三游/末游', () => {
    const g = freshGame({ endEarlyOnDoubleDown: false });
    g.phase = 'playing';
    g.hands = [[C('S3')], [C('S4')], [C('S5')], [C('S6')]];
    g.current = 0;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [];
    g.events = [];

    g.play(0, [g.hands[0][0]]);
    g.pass(1);
    g.play(2, [g.hands[2][0]]);
    expect(g.finishOrder).toEqual([0, 2]);
    expect(g.phase).toBe('playing');
  });

  it('头游与二游不同队时正常继续', () => {
    const g = freshGame({ endEarlyOnDoubleDown: false });
    g.phase = 'playing';
    g.hands = [[C('S3')], [C('S4')], [C('S5')], [C('S6')]];
    g.current = 0;
    g.lastPlay = null;
    g.passCount = 0;
    g.finishOrder = [];
    g.events = [];
    g.play(0, [g.hands[0][0]]);
    g.play(1, [g.hands[1][0]]); // 1 是对方
    expect(g.finishOrder).toEqual([0, 1]);
    expect(g.phase).toBe('playing');
  });
});
