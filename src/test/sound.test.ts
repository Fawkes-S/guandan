import { describe, expect, it } from 'vitest';
import { sfx, SFX_LABELS, type SfxName } from '../ui/sound';

/**
 * 音效引擎的行为护栏。
 * jsdom 没有 Web Audio，所以这里验证的是"没有音频环境时也必须安全"，以及试听面板
 * 与引擎的枚举保持同步（加了新音效却忘记配试听按钮，会在这里被抓住）。
 */
describe('音效引擎', () => {
  it('没有 Web Audio 环境时调用不抛异常', () => {
    expect(() => {
      sfx.unlock();
      sfx.play('click');
      sfx.preview('bomb');
      sfx.setEnabled(false);
      sfx.setEnabled(true);
    }).not.toThrow();
  });

  it('音量会夹在 0~1 之间', () => {
    sfx.setVolume(-3);
    expect(sfx.volume).toBe(0);
    sfx.setVolume(9);
    expect(sfx.volume).toBe(1);
    sfx.setVolume(0.6);
    expect(sfx.volume).toBeCloseTo(0.6);
  });

  it('每个音效都在试听面板里有条目', () => {
    const names: SfxName[] = [
      'click',
      'select',
      'deal',
      'play',
      'pass',
      'bomb',
      'tribute',
      'place',
      'win',
      'lose',
      'error',
      'toggle',
    ];
    const labelled = new Set(SFX_LABELS.map(([n]) => n));
    for (const n of names) expect(labelled.has(n)).toBe(true);
    // 反向：面板里也不该有引擎不认识的名字
    expect(SFX_LABELS).toHaveLength(names.length);
  });
});
