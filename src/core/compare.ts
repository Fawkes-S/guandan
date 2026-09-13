import type { Combo } from './types';

/** 比较用的复合强度：(压制力, 主牌点数) */
export function comboStrength(combo: Combo): [number, number] {
  return [combo.power, combo.rank];
}

/**
 * a 是否能压过 b。
 * - 炸弹之间比压制力（张数），同压制力比点数
 * - 炸弹压一切普通牌型
 * - 普通牌型必须同型同张数，且点数严格更大
 */
export function beats(a: Combo, b: Combo): boolean {
  if (a.isBomb && b.isBomb) {
    if (a.power !== b.power) return a.power > b.power;
    return a.rank > b.rank;
  }
  if (a.isBomb) return true;
  if (b.isBomb) return false;
  if (a.type !== b.type) return false;
  if (a.cards.length !== b.cards.length) return false;
  return a.rank > b.rank;
}

export function byStrength(a: Combo, b: Combo): number {
  return a.power - b.power || a.rank - b.rank;
}

export function sortByStrength(combos: readonly Combo[]): Combo[] {
  return combos.slice().sort(byStrength);
}

/**
 * 从同一手牌的多种解释里挑「最强」的那个。
 *
 * 关键：这些解释用的是**完全相同的几张牌**，所以强解释严格不劣于弱解释 ——
 * 比如 红桃7 红桃8 红桃(配) 红桃10 红桃J 既可以当顺子也可以当同花顺，
 * 取顺子只会让自己被一个 4 张炸轻易压掉，取同花顺才符合玩家本意。
 */
export function pickStrongest(combos: readonly Combo[]): Combo | null {
  if (combos.length === 0) return null;
  return combos.slice().sort((a, b) => b.power - a.power || b.rank - a.rank)[0];
}

/** 从若干解释中挑出能压过 target 的最小解释（AI 评估用） */
export function pickMinimalBeating(combos: readonly Combo[], target: Combo | null): Combo | null {
  const valid = target ? combos.filter((c) => beats(c, target)) : combos.slice();
  if (valid.length === 0) return null;
  return sortByStrength(valid)[0];
}

/** 是否为"炸弹"类（含同花顺、四大天王） */
export function isBombType(combo: Combo): boolean {
  return combo.isBomb;
}
