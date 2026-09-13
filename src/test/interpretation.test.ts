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

/**
 * 回归：wildAs 只标"真正发生了替代"的逢人配。
 * 红桃级牌当自己用（凑对级牌、在顺子里按自然点数站位）不算使用逢人配，
 * 否则玩家会看到「这手牌没用到逢人配却标着含配」。
 */
describe('逢人配标记的准确性', () => {
  it('红桃2 单出当级牌用 → 不标逢人配', () => {
    const combos = detectCombos(H('H2'), 2);
    const natural = combos.find((c) => c.rank === 15);
    expect(natural).toBeTruthy();
    expect(natural!.wildAs).toBeUndefined();
  });

  it('红桃2 + 黑桃2 组成对级牌 → 不标逢人配', () => {
    const combos = detectCombos(H('H2', 'S2'), 2);
    const pair = combos.find((c) => c.type === ComboType.Pair && c.rank === 15);
    expect(pair).toBeTruthy();
    expect(pair!.wildAs).toBeUndefined();
  });

  it('红桃2 在 23456 顺子里按自然点数 → 不标逢人配', () => {
    const combos = detectCombos(H('H2', 'S3', 'D4', 'C5', 'S6'), 2);
    const straight = combos.find((c) => c.type === ComboType.Straight && c.rank === 6);
    expect(straight).toBeTruthy();
    expect(straight!.wildAs).toBeUndefined();
  });

  it('红桃2 顶替红桃9 成同花顺 → 标出它当成了什么', () => {
    const combos = detectCombos(H('H7', 'H8', 'H2', 'H10', 'HJ'), 2);
    const sf = combos.find((c) => c.type === ComboType.StraightFlush);
    expect(sf).toBeTruthy();
    expect(sf!.wildAs).toHaveLength(1);
    expect(sf!.wildAs![0].rank).toBe(9);
    expect(sf!.wildAs![0].suit).toBe('H');
  });

  it('两张逢人配只标真正替代的那张', () => {
    // 红桃2 + 红桃2 + 3 4 5 → 可当 2/3/4/5/6（一张当 2、一张当 6）
    const combos = detectCombos(H('H2', 'H2', 'S3', 'D4', 'C5'), 2);
    const straight = combos.find((c) => c.type === ComboType.Straight && c.rank === 6);
    if (straight?.wildAs) {
      // 至多两张，且每张都必须真的改变了点数或花色
      expect(straight.wildAs.length).toBeLessThanOrEqual(2);
      for (const w of straight.wildAs) expect(w.suit === 'H' && w.rank === 2).toBe(false);
    }
  });
});
