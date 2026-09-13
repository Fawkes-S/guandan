/**
 * 规则配置：所有存在地区差异的规则点集中在此，方便切换。
 */
export interface RuleConfig {
  /** 起始级数（打几开始） */
  levelStart: number;
  /** 最高级数 A = 14 */
  levelCap: number;
  /** 炸弹最大张数 */
  bombMaxSize: number;
  /** 是否启用进贡 / 还贡 / 抗贡 */
  tributeEnabled: boolean;
  /** 还贡牌的自然点数上限（含） */
  tributeReturnMaxRank: number;
  /** 双贡时，两张贡牌中较大的给头游 */
  doubleTributeBigToHead: boolean;
  /** 顺子中 A 可作 1（A2345） */
  allowAceLowInStraight: boolean;
  /** 三连对 / 钢板中 A 可作 1 */
  allowAceLowInTubePlate: boolean;
  /** 同花顺压制力介于 5 张炸与 6 张炸之间 */
  straightFlushBetween5And6: boolean;
  /** 过 A 条件：'notLast' 需队友非末游；'anyWin' 只要头游即可 */
  passACondition: 'notLast' | 'anyWin';
  /** 打 A 最多尝试次数（三次不过 A） */
  aRetryLimit: number;
  /** 超过次数后的处理：'reset' 降回 2；'keep' 继续打 A */
  aRetryPolicy: 'reset' | 'keep';
  /** 升级不能跳过 A */
  levelCapAtA: boolean;
  /** 头游与二游同队（双下）时立刻结束本局，不再打三游/末游 */
  endEarlyOnDoubleDown: boolean;
  /** AI 决策后思考延迟（毫秒），0 表示立即 */
  aiDelayMs: number;
  /** 是否显示 AI 手牌（调试用） */
  debugShowAiHands: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  levelStart: 2,
  levelCap: 14,
  bombMaxSize: 10,
  tributeEnabled: true,
  tributeReturnMaxRank: 10,
  doubleTributeBigToHead: true,
  allowAceLowInStraight: true,
  allowAceLowInTubePlate: true,
  straightFlushBetween5And6: true,
  passACondition: 'notLast',
  aRetryLimit: 3,
  aRetryPolicy: 'reset',
  levelCapAtA: true,
  endEarlyOnDoubleDown: true,
  aiDelayMs: 650,
  debugShowAiHands: false,
};

export const TEAM_OF = [0, 1, 0, 1] as const;
export const PARTNER_OF = [2, 3, 0, 1] as const;

export function teammateOf(player: number): number {
  return (player + 2) % 4;
}

export function isTeammate(a: number, b: number): boolean {
  return a % 2 === b % 2;
}

export const PLAYER_NAMES = ['你', '下家', '对家', '上家'] as const;
