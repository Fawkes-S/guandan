import './style.css';
import { mount } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 容器');

const params = new URLSearchParams(window.location.search);
const spectate = params.get('spectate') === '1' || params.get('demo') === '1';
const difficulty = (params.get('difficulty') as 'easy' | 'normal' | 'hard' | null) ?? 'normal';
const seedParam = params.get('seed');

const app = mount(root, {
  human: spectate ? -1 : 0,
  difficulty,
  seed: seedParam ? Number(seedParam) : undefined,
  rules: spectate ? { aiDelayMs: 520 } : {},
});

// PWA 自动更新：新版本 Service Worker 接管后自动刷新一次，
// 否则玩家会一直看到预缓存里的旧界面（这正是"改动已发布但页面没变"的原因）。
if ('serviceWorker' in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
    hadController = true;
  });
}

// 开发期把实例挂到 window，方便调试与自动化对局分析
if (import.meta.env.DEV) {
  (window as unknown as { __guandan?: unknown }).__guandan = app;
}

// ?sort=combo 启动即用「按牌型」理牌
const sortParam = params.get('sort');
if (sortParam === 'combo' || sortParam === 'suit' || sortParam === 'count') {
  window.setTimeout(() => app.setSortModeForTest(sortParam), 1200);
}

// 便于分享与截图：?drawer=log|count|help 直接展开侧栏，?replay=1 直接进入复盘
const drawer = params.get('drawer');
if (drawer === 'log' || drawer === 'count' || drawer === 'help') {
  window.setTimeout(() => app.toggleDrawerForTest(drawer), 2600);
}
if (params.get('replay') === '1') {
  window.setTimeout(() => app.openReplayForTest(), 6000);
}
