import { teammateOf, type RuleConfig } from './rules';

/** 一局结束后的升级 / 过 A 结算（纯函数，便于单测） */
export interface UpgradeInput {
  finishOrder: readonly number[];
  levels: readonly [number, number];
  aAttempts: readonly [number, number];
  /** 本局级牌属于哪一队 */
  levelTeam: number;
  /** 打 A 局的队伍（非 A 局为 null） */
  aRoundTeam: number | null;
  rules: RuleConfig;
}

export interface UpgradeOutput {
  head: number;
  headTeam: number;
  /** 头游队友名次（1=二游, 2=三游, 3=末游） */
  teammatePos: number;
  gain: number;
  levels: [number, number];
  aAttempts: [number, number];
  matchWinner: number | null;
  aReset: boolean;
  wasARound: boolean;
  passedA: boolean;
}

export function applyRoundResult(input: UpgradeInput): UpgradeOutput {
  const { finishOrder, rules } = input;
  const head = finishOrder[0];
  const headTeam = head % 2;
  const teammatePos = finishOrder.indexOf(teammateOf(head));
  const gain = teammatePos === 1 ? 3 : teammatePos === 2 ? 2 : 1;

  const levels: [number, number] = [input.levels[0], input.levels[1]];
  const aAttempts: [number, number] = [input.aAttempts[0], input.aAttempts[1]];
  const levelTeamBefore = input.levelTeam;
  const wasARound = input.aRoundTeam !== null && input.aRoundTeam === levelTeamBefore;
  const qualifies = rules.passACondition === 'notLast' ? teammatePos !== 3 : true;

  let matchWinner: number | null = null;
  let aReset = false;

  if (wasARound && headTeam === levelTeamBefore && qualifies) {
    matchWinner = headTeam;
  } else {
    if (wasARound) {
      aAttempts[levelTeamBefore] += 1;
      if (aAttempts[levelTeamBefore] >= rules.aRetryLimit) {
        if (rules.aRetryPolicy === 'reset') {
          levels[levelTeamBefore] = rules.levelStart;
          aReset = true;
        }
        aAttempts[levelTeamBefore] = 0;
      }
    }
    if (!aReset) {
      let next = levels[headTeam] + gain;
      if (rules.levelCapAtA && next > rules.levelCap) next = rules.levelCap;
      levels[headTeam] = next;
    }
  }

  return {
    head,
    headTeam,
    teammatePos,
    gain,
    levels,
    aAttempts,
    matchWinner,
    aReset,
    wasARound,
    passedA: matchWinner !== null,
  };
}
