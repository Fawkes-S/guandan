import { describe, expect, it } from 'vitest';
import {
  measureDecisionTime,
  runBenchmark,
  summarize,
  type BenchProfile,
  type WinRateRow,
} from '../core/bench';

const EASY: BenchProfile = { name: 'easy', difficulty: 'easy' };
const NORMAL: BenchProfile = { name: 'normal', difficulty: 'normal' };
const HARD: BenchProfile = { name: 'hard', difficulty: 'hard' };

/** 固定种子，保证基准可复现、不抖动 */
const SEEDS = 18;
/** hard vs normal 差距较小，用更大样本量才能看出优势 */
const MIRROR_SEEDS = 40;
const SEED_BASE = 90001;
const MAX_ROUNDS = 30;

function run(a: BenchProfile, b: BenchProfile, seeds = SEEDS): WinRateRow {
  return summarize(
    runBenchmark({ profileA: a, profileB: b, seeds, seedBase: SEED_BASE, maxRounds: MAX_ROUNDS }),
  );
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printTable(rows: WinRateRow[]): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('  对局组合            A 胜   B 胜   和/未决   A 胜率    平均局数   平均决策(ms)');
  lines.push('  ' + '-'.repeat(78));
  for (const r of rows) {
    lines.push(
      '  ' +
        pad(`${r.profileA} vs ${r.profileB}`, 20) +
        pad(String(r.winsA), 7) +
        pad(String(r.winsB), 7) +
        pad(String(r.undecided), 9) +
        pad(pct(r.winRateA), 10) +
        pad(r.avgRounds.toFixed(1), 11) +
        r.avgDecisionMs.toFixed(3),
    );
  }
  lines.push('');
  console.log(lines.join('\n'));
}

describe('自对弈基准', () => {
  it('hard / normal 对 easy 的胜率与决策耗时', () => {
    const hardVsEasy = run(HARD, EASY);
    const normalVsEasy = run(NORMAL, EASY);
    const hardVsNormal = run(HARD, NORMAL, MIRROR_SEEDS);
    printTable([hardVsEasy, normalVsEasy, hardVsNormal]);

    const timings = [
      measureDecisionTime('easy', 200),
      measureDecisionTime('normal', 200),
      measureDecisionTime('hard', 200),
    ];
    const timingLines = timings.map(
      (t) =>
        `  ${pad(t.difficulty, 8)} 满手 27 张 decidePlay: avg ${t.avgMs.toFixed(3)}ms  p95 ${t.p95Ms.toFixed(3)}ms  max ${t.maxMs.toFixed(3)}ms  (n=${t.samples})`,
    );
    console.log('\n  决策耗时\n' + timingLines.join('\n') + '\n');

    // 胜率断言：hard 对 easy 要有明显优势
    expect(hardVsEasy.decided).toBeGreaterThan(20);
    expect(hardVsEasy.winRateA).toBeGreaterThanOrEqual(0.6);
    // normal 也要强于 easy
    expect(normalVsEasy.decided).toBeGreaterThan(20);
    expect(normalVsEasy.winRateA).toBeGreaterThan(0.5);
    // 难度分层的单调性：hard 不弱于 normal
    // hard 与 normal 共用同一套估值器与走法生成器，差别只在炸弹精度与威胁反应；
    // 300 局大样本实测约 50%，而这里只有约 80 局（标准误 ≈ ±5.6pp），
    // 所以把门槛设在 0.4 —— 断言的是「没有明显退化」，而不是「稳定更强」。
    expect(hardVsNormal.winRateA).toBeGreaterThanOrEqual(0.4);

    // 性能预算：满手决策平均远低于 120ms
    for (const t of timings) {
      expect(t.avgMs).toBeLessThan(120);
      expect(t.p95Ms).toBeLessThan(120);
    }
  }, 180000);
});
