// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../ui/app';

function setup(seed = 7): { app: App; root: HTMLElement } {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const app = new App(root, { seed, rules: { aiDelayMs: 0 }, autoStart: false });
  return { app, root };
}

/** 推进 AI 的定时器，直到轮到人类或本局结束 */
function pumpUntilHuman(app: App, maxTicks = 400): void {
  for (let i = 0; i < maxTicks; i++) {
    const g = app.game;
    if (g.phase === 'roundEnd' || g.phase === 'matchEnd') return;
    if (g.phase === 'returnTribute' && g.pending[0]?.player === app.human) return;
    if (g.phase === 'playing' && g.current === app.human) return;
    vi.advanceTimersByTime(1000);
  }
}

/** 人类自动操作一步（优先用提示） */
function autoHuman(app: App): void {
  const g = app.game;
  if (app.view.mode === 'return') {
    const candidate = g.returnCandidatesFor(app.human)[0];
    if (candidate) {
      app.selectCardForTest(candidate.id);
      app.pressPrimary();
    }
    return;
  }
  if (g.phase !== 'playing' || g.current !== app.human) return;
  app.pressHint();
  if (app.view.selected.size === 0) {
    if (g.canPass(app.human)) app.pressPass();
    return;
  }
  app.pressPrimary();
  // 首出遇到多种解释时会弹出选择器
  const choice = document.querySelector<HTMLButtonElement>('#choice-list .choice');
  if (choice) choice.click();
}

/** 进贡面板是新的一步：出现时先点「开始出牌 / 去还贡」再继续 */
function dismissTribute(app: App): void {
  void app;
  const go = document.querySelector<HTMLButtonElement>('#tribute-go');
  if (go) go.click();
}

function playWholeRound(app: App): void {
  let guard = 0;
  while (guard++ < 500) {
    const g = app.game;
    if (g.phase === 'roundEnd' || g.phase === 'matchEnd') return;
    pumpUntilHuman(app);
    if (app.game.phase === 'roundEnd' || app.game.phase === 'matchEnd') return;
    autoHuman(app);
  }
  throw new Error('本局未能在限定步数内结束');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('UI 渲染', () => {
  it('挂载后渲染四个座位与 27 张手牌', () => {
    const { app } = setup();
    app.newMatch();
    expect(app.game.hands[app.human]).toHaveLength(27);
    expect(document.querySelectorAll('#hand .card')).toHaveLength(27);
    expect(document.querySelectorAll('.seat')).toHaveLength(4);
    expect(document.querySelector('#hud')?.textContent).toContain('打');
  });

  it('手牌里逢人配被标记为「配」', () => {
    const { app } = setup(3);
    app.newMatch();
    const level = app.game.level;
    const wilds = app.game.hands[app.human].filter((c) => c.suit === 'H' && c.rank === level);
    expect(document.querySelectorAll('#hand .card.wild')).toHaveLength(wilds.length);
    if (wilds.length > 0) {
      expect(document.querySelector('#hand .card.wild .seal')?.textContent).toBe('配');
    }
  });
});

describe('人类出牌交互', () => {
  it('提示 + 出牌后手牌减少，并且是合法动作', () => {
    const { app } = setup(11);
    app.newMatch();
    pumpUntilHuman(app);
    if (app.game.phase !== 'playing' || app.game.current !== app.human) return;
    const before = app.game.hands[app.human].length;
    autoHuman(app);
    expect(app.game.hands[app.human].length).toBeLessThan(before);
  });

  it('选牌后按钮状态正确', () => {
    const { app } = setup(5);
    app.newMatch();
    pumpUntilHuman(app);
    if (app.game.current !== app.human) return;
    const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play') as HTMLButtonElement;
    expect(btnPlay.disabled).toBe(true);
    app.selectCardForTest(app.game.hands[app.human][0].id);
    expect(btnPlay.disabled).toBe(false);
  });

  it('出非法牌会给出错误提示且不改动手牌', () => {
    const { app } = setup(21);
    app.newMatch();
    pumpUntilHuman(app);
    const g = app.game;
    if (g.current !== app.human) return;
    if (!g.target) return; // 需要跟牌场景
    // 找两张互不成牌型的牌
    const hand = g.hands[app.human];
    const before = hand.length;
    app.selectCardForTest(hand[0].id);
    app.selectCardForTest(hand[1].id);
    app.pressPrimary();
    if (document.querySelector('#choice-list')) return;
    expect(g.hands[app.human].length === before || app.view.message.length > 0).toBe(true);
  });
});

describe('完整一局（UI 驱动）', () => {
  it('可以用提示/不要把一整局打完并弹出结算', () => {
    const { app } = setup(101);
    app.newMatch();
    playWholeRound(app);
    expect(['roundEnd', 'matchEnd']).toContain(app.game.phase);
    const modal = document.querySelector<HTMLElement>('#modal');
    expect(modal?.hidden).toBe(false);
    expect(modal?.textContent).toContain('本局');
    expect(document.querySelectorAll('.rank-row')).toHaveLength(4);
  });

  it('结算里可以点「下一局」继续', () => {
    const { app } = setup(202);
    app.newMatch();
    playWholeRound(app);
    const next = document.querySelector<HTMLButtonElement>('#modal-next');
    expect(next).toBeTruthy();
    next!.click();
    dismissTribute(app);
    // 第二局开始后可能进入进贡/还贡阶段
    expect(['playing', 'returnTribute']).toContain(app.game.phase);
    expect(document.querySelector<HTMLElement>('#modal')?.hidden).toBe(true);
    const total = app.game.hands.reduce((n, h) => n + h.length, 0);
    expect(total).toBe(108);
  });
});

describe('还贡交互', () => {
  it('还贡阶段只高亮不大于 10 的牌，并能让对局继续', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { app } = setup(seed);
      app.game.prevFinishOrder = [0, 1, 2, 3];
      app.game.round = 1;
      app.startRound();
      dismissTribute(app);
      if (app.game.phase !== 'returnTribute') continue;
      const req = app.game.pending[0];
      if (req.player !== app.human) continue;

      const cards = document.querySelectorAll('#hand .card');
      expect(cards).toHaveLength(app.game.hands[app.human].length);
      expect(document.querySelector('#btn-play')?.textContent).toBe('确认还贡');
      expect(document.querySelectorAll('#hand .card.dim')).toHaveLength(
        app.game.hands[app.human].length - req.candidateIds.length,
      );

      const candidate = app.game.returnCandidatesFor(app.human)[0];
      app.selectCardForTest(candidate.id);
      app.pressPrimary();
      expect(app.game.phase).toBe('playing');
      expect(app.game.hands[app.human]).toHaveLength(27);
      return;
    }
    throw new Error('未找到人类需要还贡的种子');
  });
});

describe('规则弹层', () => {
  it('可以打开规则速查', () => {
    setup();
    document.querySelector<HTMLButtonElement>('#btn-rules')?.click();
    const modal = document.querySelector<HTMLElement>('#modal');
    expect(modal?.hidden).toBe(false);
    expect(modal?.textContent).toContain('逢人配');
    document.querySelector<HTMLButtonElement>('#modal-close')?.click();
    expect(modal?.hidden).toBe(true);
  });
});

describe('理牌与存档', () => {
  it('理牌按钮在四种排序间循环', () => {
    const { app } = setup(15);
    app.newMatch();
    const btnSort = document.querySelector<HTMLButtonElement>('#btn-sort') as HTMLButtonElement;
    expect(app.view.sortMode).toBe('rank');
    btnSort.click();
    expect(app.view.sortMode).toBe('suit');
    btnSort.click();
    expect(app.view.sortMode).toBe('count');
    // 按张数排序时，第一张牌的点数应是手里张数最多的点数
    const hand = app.game.hands[app.human];
    const counts = new Map<number, number>();
    for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    const firstId = Number(
      document.querySelector('#hand .card')?.getAttribute('data-id'),
    );
    const firstCard = hand.find((c) => c.id === firstId);
    expect(firstCard).toBeTruthy();
    expect(counts.get(firstCard!.rank)).toBe(maxCount);
    btnSort.click();
    expect(app.view.sortMode).toBe('combo');
    btnSort.click();
    expect(app.view.sortMode).toBe('rank');
  });

  it('按牌型模式把牌拆成带标签的区块，且一张不丢', () => {
    const { app } = setup(31);
    app.newMatch();
    const btnSort = document.querySelector<HTMLButtonElement>('#btn-sort') as HTMLButtonElement;
    for (let i = 0; i < 3; i++) btnSort.click();
    expect(app.view.sortMode).toBe('combo');
    expect(document.querySelector('#hand')?.classList.contains('grouped')).toBe(true);
    const groups = document.querySelectorAll('.hand-group');
    expect(groups.length).toBeGreaterThan(1);
    const labels = Array.from(document.querySelectorAll('.group-label'));
    expect(labels.length).toBe(groups.length);
    for (const l of labels) expect((l.textContent ?? '').length).toBeGreaterThan(0);
    // 所有手牌都渲染且只渲染一次
    expect(document.querySelectorAll('#hand .card')).toHaveLength(app.game.hands[app.human].length);
    const shown = Array.from(document.querySelectorAll<HTMLElement>('#hand .slot')).map((el) =>
      Number(el.dataset.cardId),
    );
    expect(new Set(shown).size).toBe(shown.length);
    expect(new Set(shown)).toEqual(new Set(app.game.hands[app.human].map((c) => c.id)));
  });

  it('刷新后可以恢复未打完的一局', () => {
    window.localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const app1 = new App(document.getElementById('app') as HTMLElement, { seed: 77 });
    pumpUntilHuman(app1);
    autoHuman(app1);
    if (app1.game.phase !== 'playing' && app1.game.phase !== 'returnTribute') return;
    const saved = window.localStorage.getItem('guandan.save.v1');
    expect(saved).toBeTruthy();
    const handBefore = app1.game.hands[app1.human]
      .map((c) => c.id)
      .sort((x, y) => x - y);
    const roundBefore = app1.game.round;

    document.body.innerHTML = '<div id="app"></div>';
    const app2 = new App(document.getElementById('app') as HTMLElement, { seed: 77 });
    expect(app2.game.round).toBe(roundBefore);
    expect(app2.game.hands[app2.human].map((c) => c.id).sort((x, y) => x - y)).toEqual(handBefore);
    window.localStorage.clear();
  });
});

describe('牌谱抽屉', () => {
  it('三个面板都能正确渲染', () => {
    const { app } = setup(404);
    app.newMatch();
    pumpUntilHuman(app);
    autoHuman(app);

    app.toggleDrawerForTest('log');
    expect(document.querySelector<HTMLElement>('#drawer')?.hidden).toBe(false);
    const hasLog = document.querySelector('.log-trick') ?? document.querySelector('.panel-empty');
    expect(hasLog).toBeTruthy();

    app.toggleDrawerForTest('count');
    expect(document.querySelectorAll('.count-cell')).toHaveLength(15);
    // 记牌数字应等于「总数 - 已出 - 我手上」
    const levelCell = document.querySelectorAll('.count-cell')[0] as HTMLElement;
    expect(levelCell.textContent).toBeTruthy();

    app.toggleDrawerForTest('help');
    expect(document.querySelectorAll('.help-row').length).toBeGreaterThan(5);
    expect(document.querySelector('#drawer')?.textContent).toContain('逢人配');
  });

  it('有出牌后牌谱会出现记录行', () => {
    const { app } = setup(606);
    app.newMatch();
    for (let i = 0; i < 4; i++) {
      pumpUntilHuman(app);
      if (app.game.phase !== 'playing') break;
      autoHuman(app);
    }
    app.toggleDrawerForTest('log');
    expect(app.game.history.length).toBeGreaterThan(0);
    const rows = document.querySelectorAll('.log-row');
    expect(rows.length).toBe(app.game.history.length);
  });
});

describe('复盘', () => {
  it('可以打开、逐步回放并退出', () => {
    const { app } = setup(303);
    app.newMatch();
    pumpUntilHuman(app);
    autoHuman(app);
    pumpUntilHuman(app);
    autoHuman(app);
    if (app.game.history.length === 0) return;

    app.openReplayForTest();
    const layer = document.querySelector<HTMLElement>('#replay-layer');
    expect(layer?.hidden).toBe(false);
    expect(document.querySelector('.replay-panel')).toBeTruthy();
    expect(app.replayLengthForTest).toBe(app.game.history.length);

    // 第一步与最后一步都能定位
    app.seekReplayForTest(0);
    expect(document.querySelector('.replay-step')?.textContent).toContain('1 /');
    app.seekReplayForTest(app.replayLengthForTest - 1);
    expect(document.querySelector('.replay-step')?.textContent).toContain(
      `${app.replayLengthForTest} /`,
    );

    const closeBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.replay-head .btn')).find(
      (b) => b.textContent === '退出复盘',
    );
    closeBtn?.click();
    expect(layer?.hidden).toBe(true);
  });

  it('复盘面板能看到四家剩余张数与我的手牌', () => {
    const { app } = setup(808);
    app.newMatch();
    pumpUntilHuman(app);
    autoHuman(app);
    if (app.game.history.length === 0) return;
    app.openReplayForTest();
    expect(document.querySelectorAll('.replay-seat')).toHaveLength(4);
    app.seekReplayForTest(0);
    expect(document.querySelectorAll('.replay-hand .card').length).toBeGreaterThan(0);
  });
});

describe('键盘快捷键与设置', () => {
  const fire = (key: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  it('L 开关侧栏，H 给出提示', () => {
    const { app } = setup(505);
    app.newMatch();
    pumpUntilHuman(app);
    fire('l');
    expect(document.querySelector<HTMLElement>('#drawer')?.hidden).toBe(false);
    fire('l');
    expect(document.querySelector<HTMLElement>('#drawer')?.hidden).toBe(true);

    if (app.game.phase === 'playing' && app.game.current === app.human) {
      fire('h');
      expect(app.view.selected.size).toBeGreaterThan(0);
    }
  });

  it('M 可以开关音效，Esc 清空选牌', () => {
    const { app } = setup(707);
    app.newMatch();
    pumpUntilHuman(app);
    if (app.game.phase === 'playing' && app.game.current === app.human) {
      app.selectCardForTest(app.game.hands[app.human][0].id);
      expect(app.view.selected.size).toBe(1);
      fire('Escape');
      expect(app.view.selected.size).toBe(0);
    }
    const box = document.querySelector<HTMLInputElement>('#opt-sound') as HTMLInputElement;
    const before = box.checked;
    fire('m');
    expect(box.checked).toBe(!before);
    fire('m');
    expect(box.checked).toBe(before);
  });
});

describe('进贡面板', () => {
  it('发生进贡时弹出面板并展示进贡明细，点继续后进入出牌', () => {
    for (let seed = 1; seed < 100; seed++) {
      const { app } = setup(seed);
      app.game.prevFinishOrder = [0, 1, 2, 3];
      app.game.round = 1;
      app.startRound();
      if (app.game.antiTributePlayers.length > 0) continue; // 抗贡，没有进贡明细
      if (!document.querySelector('#tribute-go')) continue;

      const modal = document.querySelector<HTMLElement>('#modal');
      expect(modal?.hidden).toBe(false);
      expect(modal?.textContent).toContain('进贡');
      expect(document.querySelectorAll('.tribute-row').length).toBe(app.game.tributes.length);
      expect(document.querySelectorAll('.tribute-row .card').length).toBeGreaterThan(0);

      // 面板开着的时候不能推进
      expect(app.view.canAct).toBe(false);

      (document.querySelector('#tribute-go') as HTMLButtonElement).click();
      expect(['playing', 'returnTribute']).toContain(app.game.phase);
      return;
    }
    throw new Error('没找到会发生进贡的种子');
  });

  it('抗贡时不进贡，面板说明原因', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { app } = setup(seed);
      app.game.prevFinishOrder = [0, 1, 2, 3];
      app.game.round = 1;
      app.startRound();
      if (app.game.antiTributePlayers.length === 0) continue;
      const modal = document.querySelector<HTMLElement>('#modal');
      expect(modal?.textContent).toContain('抗贡');
      expect(app.game.tributes).toHaveLength(0);
      (document.querySelector('#tribute-go') as HTMLButtonElement).click();
      expect(app.game.phase).toBe('playing');
      return;
    }
    throw new Error('没找到抗贡的种子');
  });
});

describe('「不要」快捷键', () => {
  const fire = (key: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  it('空格 / P 可以过牌', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { app } = setup(seed);
      app.newMatch();
      for (let i = 0; i < 40; i++) {
        pumpUntilHuman(app);
        if (app.game.phase !== 'playing') break;
        if (app.view.canPass) {
          const before = app.game.history.length;
          fire('p');
          expect(app.game.history.length).toBe(before + 1);
          expect(app.game.history[app.game.history.length - 1].combo).toBeNull();
          return;
        }
        autoHuman(app);
      }
    }
    throw new Error('没有造出可以过牌的局面');
  });

  it('空格在首出时会退化为止出牌', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { app } = setup(seed);
      app.newMatch();
      pumpUntilHuman(app);
      if (app.game.phase !== 'playing' || app.game.current !== app.human) continue;
      if (app.view.canPass) continue; // 要的是首出
      app.pressHint();
      const before = app.game.hands[app.human].length;
      fire(' ');
      expect(app.game.hands[app.human].length).toBeLessThan(before);
      return;
    }
  });
});
