import { describe, expect, it } from 'vitest';
import { classify, detectCombos, consecutiveTop, bombPower, POWER_STRAIGHT_FLUSH } from '../core/combos';
import { ComboType } from '../core/types';
import { beats, pickMinimalBeating } from '../core/compare';
import { createDeck, orderValue } from '../core/cards';
import { C, H } from './helpers';

const L = 2; // 打 2

function type(cards: ReturnType<typeof H>): ComboType | null {
  return classify(cards, L)?.type ?? null;
}

describe('牌堆', () => {
  it('两副牌共 108 张且 id 唯一', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });
});

describe('基础牌型识别', () => {
  it('单张 / 对子 / 三同张', () => {
    expect(type(H('S3'))).toBe(ComboType.Single);
    expect(type(H('S3', 'D3'))).toBe(ComboType.Pair);
    expect(type(H('S3', 'D3', 'C3'))).toBe(ComboType.Triple);
    expect(type(H('S3', 'D4'))).toBeNull();
  });

  it('炸弹 4~8 张，且 9/10 张需逢人配', () => {
    expect(type(H('S3', 'D3', 'C3', 'H3'))).toBe(ComboType.Bomb);
    expect(classify(H('S3', 'D3', 'C3', 'H3'), L)!.power).toBe(bombPower(4));
    const eight = H('S3', 'D3', 'C3', 'H3', 'S3', 'D3', 'C3', 'H3');
    expect(classify(eight, L)!.power).toBe(bombPower(8));
  });

  it('三带二只比三同张', () => {
    const a = classify(H('S9', 'D9', 'C9', 'S3', 'D3'), L)!;
    const b = classify(H('S8', 'D8', 'C8', 'SA', 'DA'), L)!;
    expect(a.type).toBe(ComboType.FullHouse);
    expect(beats(a, b)).toBe(true);
    expect(beats(b, a)).toBe(false);
    // 带的对子不参与比较
    const c = classify(H('S9', 'D9', 'C9', 'SA', 'DA'), L)!;
    expect(beats(c, a)).toBe(false);
  });

  it('顺子：A2345 与 10JQKA 合法，JQKA2 非法', () => {
    expect(type(H('SA', 'D2', 'C3', 'H4', 'S5'))).toBe(ComboType.Straight);
    expect(type(H('S10', 'DJ', 'CQ', 'HK', 'SA'))).toBe(ComboType.Straight);
    expect(type(H('SJ', 'DQ', 'CK', 'HA', 'S2'))).toBeNull();
    expect(type(H('S3', 'D4', 'C5', 'H6', 'S8'))).toBeNull();
    // A2345 记 5，23456 记 6
    expect(classify(H('SA', 'D2', 'C3', 'H4', 'S5'), L)!.rank).toBe(5);
    expect(classify(H('D2', 'C3', 'H4', 'S5', 'C6'), L)!.rank).toBe(6);
  });

  it('顺子中级牌按自然点数参与', () => {
    // 打 2 时，23456 里的 2 仍按 2 算
    const s = classify(H('D2', 'C3', 'H4', 'S5', 'C6'), L)!;
    expect(s.rank).toBe(6);
    expect(s.type).toBe(ComboType.Straight);
  });

  it('三连对（木板）与钢板', () => {
    expect(type(H('S3', 'D3', 'S4', 'D4', 'S5', 'D5'))).toBe(ComboType.Tube);
    expect(type(H('S3', 'D3', 'C3', 'S4', 'D4', 'C4'))).toBe(ComboType.Plate);
    expect(type(H('S3', 'D3', 'S4', 'D4', 'S6', 'D6'))).toBeNull();
    expect(type(H('S3', 'D3', 'S4', 'D4', 'S6'))).toBeNull();
    // A 作 1 的木板 / 钢板
    expect(type(H('SA', 'DA', 'S2', 'D2', 'S3', 'D3'))).toBe(ComboType.Tube);
    expect(type(H('SA', 'DA', 'CA', 'S2', 'D2', 'C2'))).toBe(ComboType.Plate);
    expect(consecutiveTop([14, 2, 3], true)).toBe(3);
  });

  it('同花顺与四大天王', () => {
    const sf = classify(H('S3', 'S4', 'S5', 'S6', 'S7'), L)!;
    expect(sf.type).toBe(ComboType.StraightFlush);
    expect(sf.power).toBe(POWER_STRAIGHT_FLUSH);
    const jb = classify(H('BJ', 'BJ', 'RJ', 'RJ'), L)!;
    expect(jb.type).toBe(ComboType.JokerBomb);
  });

  it('王牌不能与普通牌组合', () => {
    expect(type(H('BJ', 'S3'))).toBeNull();
    expect(type(H('BJ', 'RJ'))).toBeNull();
    expect(type(H('BJ', 'BJ'))).toBe(ComboType.Pair);
    expect(type(H('RJ', 'RJ'))).toBe(ComboType.Pair);
  });
});

describe('级牌与大小', () => {
  it('级牌大于 A、小于小王', () => {
    const levelPair = classify(H('S2', 'D2'), L)!;
    const acePair = classify(H('SA', 'DA'), L)!;
    const jokerPair = classify(H('BJ', 'BJ'), L)!;
    expect(beats(levelPair, acePair)).toBe(true);
    expect(beats(jokerPair, levelPair)).toBe(true);
    expect(orderValue(C('BJ'), L)).toBe(16);
    expect(orderValue(C('RJ'), L)).toBe(17);
  });

  it('打 A 时 A 即级牌', () => {
    const aPair = classify(H('SA', 'DA'), 14)!;
    const kPair = classify(H('SK', 'DK'), 14)!;
    expect(beats(aPair, kPair)).toBe(true);
    expect(aPair.rank).toBe(15);
  });
});

describe('炸弹压制序', () => {
  it('四大天王 > 6 张炸 > 同花顺 > 5 张炸 > 4 张炸 > 普通牌型', () => {
    const b4 = classify(H('S3', 'D3', 'C3', 'H3'), L)!;
    const b5 = classify(H('S4', 'D4', 'C4', 'H4', 'S4'), L)!;
    const sf = classify(H('C3', 'C4', 'C5', 'C6', 'C7'), L)!;
    const b6 = classify(H('S5', 'D5', 'C5', 'H5', 'S5', 'D5'), L)!;
    const jb = classify(H('BJ', 'BJ', 'RJ', 'RJ'), L)!;
    const straight = classify(H('D2', 'C3', 'H4', 'S5', 'C6'), L)!;
    expect(beats(b5, b4)).toBe(true);
    expect(beats(sf, b5)).toBe(true);
    expect(beats(b6, sf)).toBe(true);
    expect(beats(jb, b6)).toBe(true);
    expect(beats(b4, straight)).toBe(true);
    expect(beats(straight, b4)).toBe(false);
  });

  it('炸弹张数不同先比张数', () => {
    const b6low = classify(H('S3', 'D3', 'C3', 'H3', 'S3', 'D3'), L)!;
    const b5high = classify(H('SA', 'DA', 'CA', 'HA', 'SA'), L)!;
    expect(beats(b6low, b5high)).toBe(true);
  });
});

describe('逢人配（红桃级牌）', () => {
  it('红桃2 + 3 解释为对 3（逢人配替代 3）', () => {
    const combos = detectCombos(H('H2', 'S3'), L);
    expect(combos.map((c) => `${c.type}:${c.rank}`)).toContain('Pair:3');
    expect(combos).toHaveLength(1);
  });

  it('逢人配可补炸弹', () => {
    const combos = detectCombos(H('S3', 'D3', 'C3', 'H2'), L);
    const bomb = combos.find((c) => c.type === ComboType.Bomb);
    expect(bomb).toBeTruthy();
    expect(bomb!.cards).toHaveLength(4);
    expect(bomb!.rank).toBe(3);
  });

  it('逢人配可补顺子与同花顺（存在多种解释）', () => {
    const combos = detectCombos(H('S3', 'S4', 'S5', 'S6', 'H2'), L);
    const sfRanks = combos.filter((c) => c.type === ComboType.StraightFlush).map((c) => c.rank);
    expect(sfRanks).toContain(6); // 逢人配当 S2 → 23456 同花顺
    expect(sfRanks).toContain(7); // 逢人配当 S7 → 34567 同花顺
    const straights = combos.filter((c) => c.type === ComboType.Straight).map((c) => c.rank);
    expect(straights).toContain(6);
  });

  it('逢人配不能变成大小王', () => {
    const combos = detectCombos(H('H2', 'BJ'), L);
    expect(combos).toHaveLength(0);
  });

  it('两张逢人配可组成 10 张炸弹', () => {
    const hand = H('S3', 'D3', 'C3', 'H3', 'S3', 'D3', 'C3', 'H3', 'H2', 'H2');
    const combos = detectCombos(hand, L);
    const bomb = combos.find((c) => c.type === ComboType.Bomb && c.cards.length === 10);
    expect(bomb).toBeTruthy();
    expect(bomb!.power).toBe(bombPower(10));
  });
});

describe('pickMinimalBeating', () => {
  it('对 3 压不过对 4，返回 null', () => {
    const target = classify(H('S4', 'D4'), L)!;
    const combos = detectCombos(H('H2', 'S3'), L);
    expect(pickMinimalBeating(combos, target)).toBeNull();
  });

  it('对级牌能压过对 4', () => {
    const target = classify(H('S4', 'D4'), L)!;
    const combos = detectCombos(H('H2', 'D2'), L);
    const picked = pickMinimalBeating(combos, target);
    expect(picked).toBeTruthy();
    expect(picked!.rank).toBe(15);
  });
});
