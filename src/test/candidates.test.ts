import { describe, expect, it } from 'vitest';
import { enumeratePlays, validatePlay, rankWindows, buildModel } from '../core/candidates';
import { classify } from '../core/combos';
import { beats } from '../core/compare';
import { createDeck, shuffle, mulberry32 } from '../core/cards';
import { ComboType, type Card } from '../core/types';
import { DEFAULT_RULES } from '../core/rules';
import { H } from './helpers';

function randomHand(count: number, seed: number): Card[] {
  const rng = mulberry32(seed);
  return shuffle(createDeck(), rng).slice(0, count);
}

describe('rankWindows', () => {
  it('包含 A2345 与 10JQKA，不含越界窗口', () => {
    const w = rankWindows(5, true);
    const tops = w.map((x) => x.top);
    expect(tops).toContain(5);
    expect(tops).toContain(14);
    expect(tops).not.toContain(15);
    expect(tops).not.toContain(4);
    const a2345 = w.find((x) => x.top === 5)!;
    expect(a2345.ranks).toEqual([14, 2, 3, 4, 5]);
  });

  it('不允许 A 作 1 时窗口从 2 起', () => {
    const w = rankWindows(5, false);
    expect(w.map((x) => x.top)).not.toContain(5);
    expect(w[0].ranks).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('buildModel', () => {
  it('把逢人配、王与普通牌分开', () => {
    const m = buildModel(H('H2', 'S2', 'S3', 'S3', 'BJ', 'RJ'), 2);
    expect(m.wilds).toHaveLength(1);
    expect(m.smallJokers).toHaveLength(1);
    expect(m.bigJokers).toHaveLength(1);
    expect(m.byRank.get(2)).toHaveLength(1);
    expect(m.byRank.get(3)).toHaveLength(2);
  });
});

describe('enumeratePlays（首出）', () => {
  it('所有候选都能被识别为合法牌型，且是手牌子集', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const hand = randomHand(27, seed);
      const level = 2 + (seed % 13);
      const options = enumeratePlays(hand, level, null, DEFAULT_RULES);
      expect(options.length).toBeGreaterThan(0);
      const ids = new Set(hand.map((c) => c.id));
      for (const opt of options) {
        expect(opt.cards.every((c) => ids.has(c.id))).toBe(true);
        expect(new Set(opt.cards.map((c) => c.id)).size).toBe(opt.cards.length);
        const re = classify(opt.cards, level, { rules: DEFAULT_RULES });
        expect(re).not.toBeNull();
      }
    }
  });

  it('能识别手上的炸弹与同花顺', () => {
    const hand = H('S3', 'D3', 'C3', 'H3', 'S4', 'S5', 'S6', 'S7', 'SA', 'DA');
    const options = enumeratePlays(hand, 2, null, DEFAULT_RULES);
    expect(options.some((o) => o.combo.type === ComboType.Bomb && o.combo.rank === 3)).toBe(true);
    expect(
      options.some((o) => o.combo.type === ComboType.StraightFlush && o.combo.rank === 7),
    ).toBe(true);
  });

  it('逢人配可用于补成炸弹或顺子', () => {
    const hand = H('H2', 'S3', 'D3', 'C3', 'S4', 'S5', 'S6');
    const options = enumeratePlays(hand, 2, null, DEFAULT_RULES);
    expect(options.some((o) => o.combo.type === ComboType.Bomb && o.combo.cards.length === 4)).toBe(
      true,
    );
    expect(
      options.some((o) => o.combo.type === ComboType.StraightFlush || o.combo.type === ComboType.Straight),
    ).toBe(true);
  });
});

describe('enumeratePlays（跟牌）', () => {
  it('所有候选都严格大于目标', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const hand = randomHand(27, seed + 100);
      const level = 2 + (seed % 13);
      const all = enumeratePlays(hand, level, null, DEFAULT_RULES);
      // 取一个非炸弹候选当目标
      const targetOpt = all.find((o) => !o.combo.isBomb) ?? all[0];
      const target = targetOpt.combo;
      const follow = enumeratePlays(hand, level, target, DEFAULT_RULES);
      for (const opt of follow) {
        expect(beats(opt.combo, target)).toBe(true);
      }
    }
  });

  it('没有能压的牌时返回空数组', () => {
    const target = classify(H('RJ', 'RJ'), 2)!; // 对大王
    const hand = H('S3', 'D3', 'S4', 'D4');
    expect(enumeratePlays(hand, 2, target, DEFAULT_RULES)).toHaveLength(0);
  });
});

describe('validatePlay', () => {
  const hand = H('S3', 'D3', 'C3', 'H3', 'S9', 'D9');

  it('拒绝空选与非法牌型', () => {
    expect(validatePlay(hand, [], 2, null).ok).toBe(false);
    expect(validatePlay(hand, H('S3', 'D9'), 2, null).ok).toBe(false);
  });

  it('接受合法牌型并拒绝压不过的出牌', () => {
    const r = validatePlay(hand, hand.filter((c) => c.rank === 3), 2, null);
    expect(r.ok).toBe(true);
    const target = classify(H('SA', 'DA'), 2)!;
    const r2 = validatePlay(hand, H('S9', 'D9'), 2, target);
    expect(r2.ok).toBe(false);
  });

  it('拒绝不在手牌中的牌', () => {
    const r = validatePlay(hand, H('S5'), 2, null);
    expect(r.ok).toBe(false);
  });
});

describe('性能', () => {
  it('27 张手牌首出候选枚举在 300ms 内完成', () => {
    const hand = randomHand(27, 7);
    const start = Date.now();
    for (let i = 0; i < 20; i++) enumeratePlays(hand, 2, null, DEFAULT_RULES);
    const cost = (Date.now() - start) / 20;
    expect(cost).toBeLessThan(300);
  });
});
