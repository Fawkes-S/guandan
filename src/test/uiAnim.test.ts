// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bombEffect, captureRects, floatBubble, flyPlay, motion, playFlip, stagger } from '../ui/anim';
import { sfx } from '../ui/sound';
import { C } from './helpers';

function mountTable(): HTMLElement {
  document.body.innerHTML = `
    <div class="app">
      <div class="table" id="table">
        <div class="seat" id="seat1"></div>
        <div class="center"><div class="play-row" id="row"></div></div>
      </div>
    </div>`;
  return document.getElementById('table') as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  motion.enabled = true;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('音效引擎', () => {
  it('在没有 AudioContext 的环境里静默降级，不抛异常', () => {
    expect(() => {
      sfx.unlock();
      sfx.play('deal');
      sfx.play('bomb');
      sfx.play('win');
      sfx.setEnabled(false);
      sfx.play('play');
      sfx.setEnabled(true);
      sfx.setVolume(0.3);
    }).not.toThrow();
  });

  it('关闭音效后不再产生任何音频节点', () => {
    sfx.setEnabled(false);
    expect(() => sfx.play('bomb')).not.toThrow();
    sfx.setEnabled(true);
  });
});

describe('动效工具', () => {
  it('floatBubble 插入气泡并在 1.2 秒后自动移除', () => {
    const table = mountTable();
    const seat = document.getElementById('seat1') as HTMLElement;
    floatBubble(table, seat, '不要');
    const bubble = document.querySelector('.bubble');
    expect(bubble?.textContent).toBe('不要');
    expect(bubble?.classList.contains('bubble-pass')).toBe(true);
    vi.advanceTimersByTime(1400);
    expect(document.querySelector('.bubble')).toBeNull();
  });

  it('bombEffect 会加入墨晕与震屏，并在结束后清理', () => {
    const table = mountTable();
    bombEffect(table);
    expect(document.querySelectorAll('.bomb-ring').length).toBe(3);
    expect(document.querySelector('.bomb-splash')).toBeTruthy();
    expect(document.querySelector('.app')?.classList.contains('shake')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(document.querySelectorAll('.bomb-ring').length).toBe(0);
    expect(document.querySelector('.app')?.classList.contains('shake')).toBe(false);
  });

  it('flyPlay 会生成飞牌层并在动画结束后回调', () => {
    const table = mountTable();
    const seat = document.getElementById('seat1') as HTMLElement;
    const done = vi.fn();
    flyPlay(table, seat, [C('S3'), C('S4'), C('S5')], 2, done);
    expect(document.querySelectorAll('.fly-layer .card.flying').length).toBe(3);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(done).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.fly-layer')).toBeNull();
  });

  it('captureRects / playFlip 能记录并还原牌位', () => {
    const table = mountTable();
    table.innerHTML = '<div data-flip="a" style="width:10px;height:10px"></div>';
    const rects = captureRects(table);
    expect(rects.has('a')).toBe(true);
    expect(() => playFlip(table, rects)).not.toThrow();
  });

  it('关闭动效后不再插入任何特效节点', () => {
    motion.enabled = false;
    const table = mountTable();
    floatBubble(table, document.getElementById('seat1') as HTMLElement, '不要');
    bombEffect(table);
    const done = vi.fn();
    flyPlay(table, document.getElementById('seat1') as HTMLElement, [C('S3')], 2, done);
    expect(document.querySelector('.bubble')).toBeNull();
    expect(document.querySelectorAll('.bomb-ring').length).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
    motion.enabled = true;
  });

  it('stagger 会为元素设置递增延迟', () => {
    document.body.innerHTML = '<div id="box"><i class="x"></i><i class="x"></i><i class="x"></i></div>';
    const box = document.getElementById('box') as HTMLElement;
    stagger(box, '.x', 30);
    const delays = Array.from(box.querySelectorAll<HTMLElement>('.x')).map(
      (el) => el.style.animationDelay,
    );
    expect(delays).toEqual(['0ms', '30ms', '60ms']);
  });
});
