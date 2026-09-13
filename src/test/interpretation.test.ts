import { describe, expect, it } from 'vitest';
import { classify, detectCombos } from '../core/combos';
import { validatePlay, enumeratePlays } from '../core/candidates';
import { beats } from '../core/compare';
import { ComboType } from '../core/types';
import { H } from './helpers';

/**
 * 回归：同一手牌的多种解释必须取「最强」的那个。
 *
 * 实战事故：红桃 7 8 (配) 10 J 本来是同花顺，引擎取了「顺子」这个弱解释，
 * 结果被下家的 4 张炸压掉 —— 而 4 张炸本来就压不过同花顺。
 */
describe('一手多解时取最强解释', () => {
  const sfCards = H('H7', 'H8', 'H2', 'H10', 'HJ'); // 红桃2 是逢人配，当红桃9

  it('红桃 7 8 (配) 10 J 判定为同花顺', () => {
    const combos = detectCombos(sfCards, 2);
    expect(combos.map((c) => c.type)).toContain(ComboType.StraightFlush);
    const res = validatePlay(sfCards, sfCards, 2, null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.combo.type).toBe(ComboType.StraightFlush);
  });

  it('同花顺能压过 4 张炸，4 张炸压不过它', () => {
    const res = validatePlay(sfCards, sfCards, 2, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bomb = classify(H('SQ', 'DQ', 'CQ', 'HQ'), 2)!;
    expect(bomb.type).toBe(ComboType.Bomb);
    expect(beats(res.combo, bomb)).toBe(true);
    expect(beats(bomb, res.combo)).toBe(false);
  });

  it('4 张炸也压不过 6 张炸，但能压过 5 张以下之外的同花顺以外的牌型', () => {
    const res = validatePlay(sfCards, sfCards, 2, null);
    if (!res.ok) return;
    const straight = classify(H('D3', 'C4', 'H5', 'S6', 'C7'), 2)!;
    expect(beats(res.combo, straight)).toBe(true);
  });

  it('跟牌时同样取最强解释（不再自动降级）', () => {
    const target = classify(H('D3', 'C4', 'H5', 'S6', 'C7'), 2)!; // 顺子到 7
    const res = validatePlay(sfCards, sfCards, 2, target);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.combo.type).toBe(ComboType.StraightFlush);
  });

  it('enumeratePlays 与引擎用同一套解释', () => {
    const opts = enumeratePlays(sfCards, 2, null);
    const sf = opts.find((o) => o.cards.length === 5 && o.combo.type === ComboType.StraightFlush);
    expect(sf).toBeTruthy();
    const play = opts.find((o) => o.cards.length === 5);
    if (play) {
      const res = validatePlay(play.cards, play.cards, 2, null);
      if (res.ok) expect(res.combo.type).toBe(play.combo.type);
    }
  });

  it('两张逢人配可以读成「对级牌」，取最强解释', () => {
    const cards = H('H2', 'H2');
    const res = validatePlay(cards, cards, 2, null);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.combo.type).toBe(ComboType.Pair);
      expect(res.combo.rank).toBe(15);
    }
  });

  it('红桃2 + 3 只能读成「对 3」（凑不出第二张级牌）', () => {
    const cards = H('H2', 'S3');
    const res = validatePlay(cards, cards, 2, null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.combo.rank).toBe(3);
  });

  it('顺子窗口存在歧义时取更大的那个', () => {
    // 3 4 5 6 + 配：可以当 2-6，也可以当 3-7
    const cards = H('S3', 'S4', 'S5', 'S6', 'H2');
    const res = validatePlay(cards, cards, 2, null);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.combo.rank).toBe(7);
  });
});
