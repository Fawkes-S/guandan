import { describe, expect, it } from 'vitest';
import { HandOrganizer } from '../ui/handOrganizer';
import { DEFAULT_RULES } from '../core/rules';
import { createDeck, shuffle, mulberry32 } from '../core/cards';
import { H } from './helpers';

describe('HandOrganizer', () => {
  it('平铺模式只有一块，按大小排序', () => {
    const hand = H('S3', 'SA', 'SK');
    const org = new HandOrganizer();
    org.setMode('rank', hand, 2, DEFAULT_RULES);
    expect(org.slots).toHaveLength(1);
    const resolved = org.resolve(hand);
    expect(resolved).toHaveLength(1);
    // A 比 K 大，应排在前面
    expect(resolved[0].cards.map((c) => c.rank)).toEqual([14, 13, 3]);
  });

  it('按牌型模式切出多块，且所有牌都出现一次', () => {
    const hand = H('S3', 'D4', 'C5', 'H6', 'S7', 'S9', 'D9', 'C9', 'SA', 'DA', 'SK', 'DK');
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const resolved = org.resolve(hand);
    expect(resolved.length).toBeGreaterThan(1);
    const ids = resolved.flatMap((s) => s.cards.map((c) => c.id)).sort((a, b) => a - b);
    expect(ids).toEqual(hand.map((c) => c.id).sort((a, b) => a - b));
    expect(resolved.every((s) => s.label.length > 0)).toBe(true);
  });

  it('moveCard 可以跨块搬牌，并进入自定义状态', () => {
    const hand = H('S3', 'S4', 'S5');
    const org = new HandOrganizer();
    org.setMode('combo', hand, 2, DEFAULT_RULES);
    const before = org.resolve(hand);
    const target = before.find((s) => s.cards.length >= 2) ?? before[0];
    const source = before.find((s) => s.id !== target.id) ?? before[0];
    const cardId = source.cards[0].id;
    const moved = org.moveCard(cardId, target.id, 0);
    if (source.id !== target.id) {
      expect(moved).toBe(true);
      expect(org.isCustomized()).toBe(true);
      const after = org.resolve(hand);
      const host = after.find((s) => s.id === target.id)!;
      expect(host.cards[0].id).toBe(cardId);
    }
  });

  it('moveSlot 可以整块换位', () => {
    const hand = H('S3', 'D4', 'C5', 'H6', 'S7', 'S9', 'D9');
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const before = org.resolve(hand).map((s) => s.id);
    expect(before.length).toBeGreaterThan(1);
    const ok = org.moveSlot(before[before.length - 1], before[0], true);
    expect(ok).toBe(true);
    const after = org.resolve(hand).map((s) => s.id);
    expect(after[0]).toBe(before[before.length - 1]);
    expect(after.length).toBe(before.length);
  });

  it('自定义排布后手牌变化只做增删，不重排', () => {
    const hand = H('S3', 'D4', 'C5', 'H6', 'S7', 'S9', 'D9');
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const first = org.resolve(hand).map((s) => s.id);
    org.moveSlot(first[first.length - 1], first[0], true);
    const customOrder = org.resolve(hand).map((s) => s.cards.map((c) => c.id).join('-'));
    // 打掉一张牌
    const shorter = hand.filter((c) => c.id !== hand[0].id);
    org.sync(shorter, 5, DEFAULT_RULES);
    const after = org.resolve(shorter).map((s) => s.cards.map((c) => c.id).join('-'));
    // 块顺序保持自定义结果（去掉空块后）
    expect(after[0]).toBe(customOrder[0]);
  });

  it('reflow 会丢掉自定义并恢复自动排布', () => {
    const hand = H('S3', 'D4', 'C5', 'H6', 'S7', 'S9', 'D9');
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const shape = (): string[] =>
      org.resolve(hand).map((s) => s.cards.map((c) => c.id).join('-'));
    const auto = shape();
    const ids = org.resolve(hand);
    org.moveSlot(ids[ids.length - 1].id, ids[0].id, true);
    expect(org.isCustomized()).toBe(true);
    expect(shape()).not.toEqual(auto);
    org.reflow(hand, 5, DEFAULT_RULES);
    expect(org.isCustomized()).toBe(false);
    expect(shape()).toEqual(auto);
  });

  it('随机手牌拆分不丢牌、不重复', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const hand = shuffle(createDeck(), mulberry32(seed * 977)).slice(0, 27);
      const level = 2 + (seed % 13);
      const org = new HandOrganizer();
      org.setMode('combo', hand, level, DEFAULT_RULES);
      const resolved = org.resolve(hand);
      const ids = resolved.flatMap((s) => s.cards.map((c) => c.id));
      expect(ids).toHaveLength(hand.length);
      expect(new Set(ids).size).toBe(hand.length);
    }
  });
});

describe('手动成组 / 拆组 / 改名', () => {
  const hand = H('S3', 'D4', 'C5', 'H6', 'S7', 'S9', 'D9', 'C9', 'SK', 'DK');

  it('可以把任意选中的几张牌单独组成一组', () => {
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const picked = hand.filter((c) => [3, 4, 5, 6, 7].includes(c.rank)).map((c) => c.id);
    expect(org.createGroup(picked, hand, 5, DEFAULT_RULES)).toBe(true);
    const slots = org.resolve(hand, 5, DEFAULT_RULES);
    const made = slots.find((s) => s.cards.length === 5 && s.cards.every((c) => picked.includes(c.id)));
    expect(made).toBeTruthy();
    // 标签按内容自动推导成顺子
    expect(made!.label).toContain('顺子');
    // 一张不多一张不少
    const ids = slots.flatMap((s) => s.cards.map((c) => c.id)).sort((a, b) => a - b);
    expect(ids).toEqual(hand.map((c) => c.id).sort((a, b) => a - b));
  });

  it('成组后标签跟着内容变，不会留着旧名字', () => {
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const pair = hand.filter((c) => c.rank === 13).map((c) => c.id);
    org.createGroup(pair, hand, 5, DEFAULT_RULES);
    let slots = org.resolve(hand, 5, DEFAULT_RULES);
    expect(slots.find((s) => s.cards.length === 2)!.label).toContain('对子');

    // 再拖一张 9 进去 → 标签应变成「三张 9」之类，而不是还写对子 K
    const target = org.slots.find((s) => s.ids.length === 2)!;
    const nine = hand.find((c) => c.rank === 9)!;
    org.moveCard(nine.id, target.id, 2);
    slots = org.resolve(hand, 5, DEFAULT_RULES);
    const merged = slots.find((s) => s.cards.some((c) => c.id === nine.id))!;
    expect(merged.label).not.toContain('对子 K');
  });

  it('拆组会把牌放进「未分组」，不丢牌', () => {
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const target = org.slots.find((s) => s.ids.length >= 2)!;
    const before = org.slots.flatMap((s) => s.ids).length;
    expect(org.dissolveGroup(target.id)).toBe(true);
    const slots = org.resolve(hand, 5, DEFAULT_RULES);
    expect(slots.some((s) => s.label === '未分组')).toBe(true);
    expect(slots.flatMap((s) => s.cards).length).toBe(before);
  });

  it('改名后使用自定义名字，清空则回到自动推导', () => {
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const id = org.slots[0].id;
    org.renameSlot(id, '我的顺子');
    let slots = org.resolve(hand, 5, DEFAULT_RULES);
    expect(slots.find((s) => s.id === id)!.label).toBe('我的顺子');
    expect(slots.find((s) => s.id === id)!.custom).toBe(true);
    org.renameSlot(id, '   ');
    slots = org.resolve(hand, 5, DEFAULT_RULES);
    expect(slots.find((s) => s.id === id)!.custom).toBe(false);
  });

  it('平铺模式下成组会自动切换到分组排布', () => {
    const org = new HandOrganizer();
    org.setMode('rank', hand, 5, DEFAULT_RULES);
    expect(org.isGrouped()).toBe(false);
    const picked = hand.slice(0, 5).map((c) => c.id);
    org.createGroup(picked, hand, 5, DEFAULT_RULES);
    expect(org.isGrouped()).toBe(true);
    expect(org.resolve(hand, 5, DEFAULT_RULES).some((s) => s.cards.length === 5)).toBe(true);
  });

  it('成组一次后，手牌变化不会打散自定义分组', () => {
    const org = new HandOrganizer();
    org.setMode('combo', hand, 5, DEFAULT_RULES);
    const picked = [hand[0].id, hand[1].id, hand[2].id, hand[3].id, hand[4].id];
    org.createGroup(picked, hand, 5, DEFAULT_RULES);
    org.renameSlot(org.slots.find((s) => s.ids.length === 5)!.id, '开牌顺子');
    const shorter = hand.filter((c) => c.id !== hand[9].id);
    org.sync(shorter, 5, DEFAULT_RULES);
    expect(org.resolve(shorter, 5, DEFAULT_RULES).some((s) => s.label === '开牌顺子')).toBe(true);
  });
});
