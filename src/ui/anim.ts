import type { Card } from '../core/types';
import { cardEl } from './render';

/** 是否启用动效（可由设置面板关闭，或跟随系统 reduced-motion） */
export const motion = {
  enabled: true,
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

motion.enabled = !prefersReducedMotion();

// ------------------------------------------------------------------ FLIP

/** 记录容器内所有 [data-flip] 元素的当前位置，用于 FLIP 动画 */
export function captureRects(container: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  if (!motion.enabled) return map;
  container.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const key = el.dataset.flip;
    if (key) map.set(key, el.getBoundingClientRect());
  });
  return map;
}

/**
 * FLIP：让同一 data-flip 键的元素从旧位置平滑移动到新位置。
 * 新出现的元素不做处理（由入场动画负责）。
 */
export function playFlip(container: HTMLElement, prev: Map<string, DOMRect>): void {
  if (!motion.enabled || prev.size === 0) return;
  container.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const key = el.dataset.flip;
    if (!key) return;
    const before = prev.get(key);
    if (!before) return;
    const after = el.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) return;
    const rot = el.style.getPropertyValue('--rot') || '0deg';
    const ty = el.style.getPropertyValue('--ty') || '0px';
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}) translateY(${ty})`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform .34s cubic-bezier(.2,.85,.25,1)';
      el.style.transform = '';
      window.setTimeout(() => {
        el.style.transition = '';
      }, 380);
    });
  });
}

// ------------------------------------------------------------------ 飞牌

/**
 * 出牌飞行：从座位位置飞出几张牌落到牌桌中央。
 * 返回动画总时长（毫秒）。
 */
export function flyPlay(
  table: HTMLElement,
  from: HTMLElement,
  cards: readonly Card[],
  level: number,
  onLand?: () => void,
): number {
  if (!motion.enabled || cards.length === 0) {
    onLand?.();
    return 0;
  }
  const tableRect = table.getBoundingClientRect();
  const fromRect = from.getBoundingClientRect();
  const center = table.querySelector<HTMLElement>('.center');
  const toRect = (center ?? table).getBoundingClientRect();

  const layer = document.createElement('div');
  layer.className = 'fly-layer';
  table.appendChild(layer);

  const w = 46;
  const h = 66;
  const startX = fromRect.left - tableRect.left + fromRect.width / 2 - w / 2;
  const startY = fromRect.top - tableRect.top + fromRect.height / 2 - h / 2;
  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);

  cards.forEach((card, i) => {
    const el = cardEl(card, level, { small: true, interactive: false });
    el.classList.add('flying');
    el.style.left = `${startX}px`;
    el.style.top = `${startY}px`;
    el.style.zIndex = String(100 + i);
    el.style.transitionDelay = `${i * 38}ms`;
    layer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${dx}px, ${dy}px) scale(.86) rotate(${(i - cards.length / 2) * 3}deg)`;
      el.style.opacity = '0.15';
    });
  });

  const total = 200 + cards.length * 38;
  window.setTimeout(() => {
    layer.remove();
    onLand?.();
  }, total);
  return total;
}

// ------------------------------------------------------------------ 气泡

/** 在某个座位附近浮出一个短语气泡（如「不要」） */
export function floatBubble(
  table: HTMLElement,
  anchor: HTMLElement,
  text: string,
  variant: 'pass' | 'info' | 'bomb' = 'pass',
): void {
  if (!motion.enabled) return;
  const tableRect = table.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `bubble bubble-${variant}`;
  el.textContent = text;
  el.style.left = `${rect.left - tableRect.left + rect.width / 2}px`;
  el.style.top = `${rect.top - tableRect.top + rect.height / 2}px`;
  table.appendChild(el);
  window.setTimeout(() => el.remove(), 1200);
}

// ------------------------------------------------------------------ 特效

/** 炸弹：墨晕扩散 + 轻微震屏 */
export function bombEffect(table: HTMLElement): void {
  if (!motion.enabled) return;
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('div');
    ring.className = 'bomb-ring';
    ring.style.animationDelay = `${i * 90}ms`;
    table.appendChild(ring);
    window.setTimeout(() => ring.remove(), 1100 + i * 90);
  }
  const splash = document.createElement('div');
  splash.className = 'bomb-splash';
  table.appendChild(splash);
  window.setTimeout(() => splash.remove(), 900);

  const app = table.closest('.app');
  if (app) {
    app.classList.add('shake');
    window.setTimeout(() => app.classList.remove('shake'), 460);
  }
}

/** 级牌或逢人配的强调脉冲 */
export function pulse(el: HTMLElement): void {
  if (!motion.enabled) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  window.setTimeout(() => el.classList.remove('pulse'), 700);
}

/** 结算数字滚动 */
export function countUp(el: HTMLElement, to: number, duration = 600): void {
  if (!motion.enabled) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(eased * to));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 手牌错峰入场 */
export function stagger(container: HTMLElement, selector: string, step = 26, base = 0): void {
  if (!motion.enabled) return;
  container.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
    el.style.animationDelay = `${base + i * step}ms`;
  });
}
