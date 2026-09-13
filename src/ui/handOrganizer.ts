import { orderValue } from '../core/cards';
import { labelForCards, splitHand } from '../core/split';
import { DEFAULT_RULES, type RuleConfig } from '../core/rules';
import type { Card } from '../core/types';

export type SortMode = 'rank' | 'suit' | 'count' | 'combo';

export const SORT_MODE_LABEL: Record<SortMode, string> = {
  rank: '按大小',
  suit: '按花色',
  count: '按张数',
  combo: '按牌型',
};

export const SORT_MODE_ORDER: SortMode[] = ['rank', 'suit', 'count', 'combo'];

/** 手牌区里的一块：平铺模式下只有一块，分组模式下每个牌型 / 玩家自定组一块 */
export interface HandSlot {
  id: string;
  kind: 'flat' | 'group';
  ids: number[];
  /** 玩家自己起的名字；为空则按牌面内容自动推导 */
  customLabel?: string;
}

export interface ResolvedSlot {
  id: string;
  /** 展示用标签（自定义优先，否则按内容推导） */
  label: string;
  kind: 'flat' | 'group';
  cards: Card[];
  /** 是否用了玩家自定义的名字 */
  custom: boolean;
}

/** 拖到「新组」区域时使用的虚拟目标 id */
export const NEW_GROUP = '__new__';

const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, D: 2, C: 3, J: 4 };

export function sortForDisplay(cards: readonly Card[], level: number, mode: SortMode): Card[] {
  const list = cards.slice();
  if (mode === 'suit') {
    return list.sort(
      (a, b) =>
        SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] ||
        orderValue(b, level) - orderValue(a, level) ||
        a.id - b.id,
    );
  }
  if (mode === 'count') {
    const counts = new Map<number, number>();
    for (const c of list) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    return list.sort(
      (a, b) =>
        (counts.get(b.rank) ?? 0) - (counts.get(a.rank) ?? 0) ||
        orderValue(b, level) - orderValue(a, level) ||
        a.id - b.id,
    );
  }
  return list.sort(
    (a, b) => orderValue(b, level) - orderValue(a, level) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit],
  );
}

/**
 * 手牌排布管理器。
 *
 * - 平铺模式：一块，按大小 / 花色 / 张数排序
 * - 按牌型模式：拆成若干带标签的牌型块
 * - 用户拖动过之后进入「自定义」状态，不再被自动重排覆盖，只做增删维护
 */
export class HandOrganizer {
  slots: HandSlot[] = [];
  mode: SortMode = 'rank';
  /** 用户是否手工调整过 */
  customized = false;
  private seq = 0;
  private lastKey = '';

  private nextId(): string {
    this.seq += 1;
    return `s${this.seq}`;
  }

  /** 切换理牌方式（会丢弃手工排布） */
  setMode(mode: SortMode, hand: readonly Card[], level: number, rules: RuleConfig): void {
    this.mode = mode;
    this.customized = false;
    this.lastKey = '';
    this.rebuild(hand, level, rules);
  }

  /** 每次渲染前调用：仅在手牌真正变化时重排 */
  sync(hand: readonly Card[], level: number, rules: RuleConfig): void {
    const key = `${this.mode}|${level}|${hand
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!this.customized) {
      this.rebuild(hand, level, rules);
      return;
    }
    this.pruneAndAppend(hand);
  }

  /** 用户手工重排后调用 */
  markCustomized(): void {
    this.customized = true;
  }

  private pruneAndAppend(hand: readonly Card[]): void {
    const alive = new Set(hand.map((c) => c.id));
    for (const slot of this.slots) slot.ids = slot.ids.filter((id) => alive.has(id));
    const known = new Set(this.slots.flatMap((s) => s.ids));
    const fresh = hand.filter((c) => !known.has(c.id));
    if (fresh.length > 0) {
      if (this.slots.length === 0) this.slots = [{ id: this.nextId(), kind: 'flat', ids: [] }];
      const target = this.slots[this.slots.length - 1];
      for (const c of fresh) target.ids.push(c.id);
    }
    this.slots = this.slots.filter((s) => s.ids.length > 0);
    if (this.slots.length === 0) {
      this.slots = [{ id: this.nextId(), kind: 'flat', ids: hand.map((c) => c.id) }];
    }
  }

  private rebuild(hand: readonly Card[], level: number, rules: RuleConfig = DEFAULT_RULES): void {
    if (this.mode === 'combo') {
      const groups = splitHand(hand, level, rules);
      this.slots = groups.map((g) => ({
        id: this.nextId(),
        kind: 'group' as const,
        ids: g.cards.map((c) => c.id),
      }));
      if (this.slots.length === 0) {
        this.slots = [{ id: this.nextId(), kind: 'flat', ids: hand.map((c) => c.id) }];
      }
      return;
    }
    const sorted = sortForDisplay(hand, level, this.mode);
    this.slots = [{ id: this.nextId(), kind: 'flat', ids: sorted.map((c) => c.id) }];
  }

  /** 当前是否已经是分组排布 */
  isGrouped(): boolean {
    return this.slots.some((s) => s.kind === 'group');
  }

  /** 还没分组就先按牌型自动拆一遍，作为手工调整的起点 */
  ensureGrouped(hand: readonly Card[], level: number, rules: RuleConfig): void {
    if (this.isGrouped()) return;
    this.mode = 'combo';
    this.customized = true;
    this.lastKey = '';
    this.rebuild(hand, level, rules);
    this.markCustomized();
  }

  /**
   * 手动成组：把选中的牌从原组里抽出来，单独组成一个新区块。
   * 新块插在「第一张选中牌原来所在组」的位置，符合直觉。
   */
  createGroup(
    cardIds: readonly number[],
    hand: readonly Card[],
    level: number,
    rules: RuleConfig,
    customLabel?: string,
  ): boolean {
    if (cardIds.length === 0) return false;
    this.ensureGrouped(hand, level, rules);
    const picked = new Set(cardIds);
    const known = new Set(this.slots.flatMap((s) => s.ids));
    if (!cardIds.every((id) => known.has(id))) return false;

    const anchor = this.slots.find((s) => s.ids.some((id) => picked.has(id)))?.id ?? null;
    for (const slot of this.slots) slot.ids = slot.ids.filter((id) => !picked.has(id));
    const alive = this.slots.filter((s) => s.ids.length > 0);
    const at = anchor ? alive.findIndex((s) => s.id === anchor) : alive.length - 1;
    const slot: HandSlot = {
      id: this.nextId(),
      kind: 'group',
      ids: cardIds.slice(),
      ...(customLabel ? { customLabel } : {}),
    };
    alive.splice(at < 0 ? alive.length : at + 1, 0, slot);
    this.slots = alive;
    this.markCustomized();
    this.lastKey = '';
    return true;
  }

  /** 拆分分组：把这一组的牌放回「未分组」里，方便重新划分 */
  dissolveGroup(slotId: string): boolean {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot || slot.kind !== 'group') return false;
    const ids = slot.ids.slice();
    this.slots = this.slots.filter((s) => s.id !== slotId);
    let loose = this.slots.find((s) => s.kind === 'group' && s.customLabel === '未分组');
    if (!loose) {
      loose = { id: this.nextId(), kind: 'group', ids: [], customLabel: '未分组' };
      this.slots.push(loose);
    }
    loose.ids.push(...ids);
    this.markCustomized();
    this.lastKey = '';
    return true;
  }

  /** 找到某张牌所属的组 id */
  slotIdOf(cardId: number): string | null {
    return this.findSlotOf(cardId)?.id ?? null;
  }

  /** 给一组改名字；传空字符串恢复自动推导 */
  renameSlot(slotId: string, label: string): boolean {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) return false;
    const trimmed = label.trim();
    if (trimmed) slot.customLabel = trimmed;
    else delete slot.customLabel;
    this.markCustomized();
    return true;
  }

  /** 强制按当前模式重新自动排布（「重排」按钮） */
  reflow(hand: readonly Card[], level: number, rules: RuleConfig): void {
    this.customized = false;
    this.lastKey = '';
    this.rebuild(hand, level, rules);
  }

  findSlotOf(cardId: number): HandSlot | null {
    return this.slots.find((s) => s.ids.includes(cardId)) ?? null;
  }

  /** 把一张牌移动到目标块的指定下标 */
  moveCard(cardId: number, targetId: string, index: number): boolean {
    const from = this.findSlotOf(cardId);
    const to = this.slots.find((s) => s.id === targetId);
    if (!from || !to) return false;
    const fromIndex = from.ids.indexOf(cardId);
    if (fromIndex < 0) return false;
    let insertAt = Math.max(0, Math.min(to.ids.length, index));
    if (from === to && fromIndex < insertAt) insertAt -= 1;
    if (from === to && fromIndex === insertAt) return false;
    from.ids.splice(fromIndex, 1);
    to.ids.splice(insertAt, 0, cardId);
    this.slots = this.slots.filter((s) => s.ids.length > 0);
    if (this.slots.length === 0) this.slots = [{ id: this.nextId(), kind: 'flat', ids: [] }];
    this.markCustomized();
    this.lastKey = '';
    return true;
  }

  /** 把整块移动到另一块之前 / 之后 */
  moveSlot(slotId: string, targetId: string, before: boolean): boolean {
    if (slotId === targetId) return false;
    const from = this.slots.findIndex((s) => s.id === slotId);
    if (from < 0) return false;
    const [slot] = this.slots.splice(from, 1);
    const at = this.slots.findIndex((s) => s.id === targetId);
    if (at < 0) {
      this.slots.push(slot);
    } else {
      this.slots.splice(before ? at : at + 1, 0, slot);
    }
    this.markCustomized();
    this.lastKey = '';
    return true;
  }

  /**
   * 把 id 序列解析成可直接渲染的块。
   * 标签每次都按当前牌面重算 —— 手工拖动之后名字不会和牌对不上。
   */
  resolve(hand: readonly Card[], level = 2, rules: RuleConfig = DEFAULT_RULES): ResolvedSlot[] {
    const map = new Map(hand.map((c) => [c.id, c]));
    return this.slots
      .map((s) => {
        const cards = s.ids.map((id) => map.get(id)).filter((c): c is Card => Boolean(c));
        const label =
          s.kind === 'flat' ? '' : (s.customLabel ?? labelForCards(cards, level, rules));
        return { id: s.id, label, kind: s.kind, cards, custom: Boolean(s.customLabel) };
      })
      .filter((s) => s.cards.length > 0);
  }

  /** 用于对比：当前排布是否与自动排布一致 */
  isCustomized(): boolean {
    return this.customized;
  }
}
