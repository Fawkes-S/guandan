import './style.css';
import { GuandanGame } from '../core/engine';
import { aiStep } from '../core/autoplay';
import { enumeratePlays, explainCards, type PlayOption } from '../core/candidates';
import { levelText, rankText } from '../core/cards';
import { teammateOf, type RuleConfig } from '../core/rules';
import type { Difficulty } from '../core/ai';
import { ComboType, SUIT_SYMBOL, isWild, type Card, type Combo } from '../core/types';
import { bombEffect, captureRects, floatBubble, flyPlay, motion, playFlip, pulse, stagger } from './anim';
import {
  renderCountPanel,
  renderHelpPanel,
  renderLogPanel,
  renderReplayOverlay,
  type DrawerTab,
  type PanelContext,
} from './panel';
import { Replay } from './replay';
import {
  NEW_GROUP,
  SORT_MODE_LABEL,
  SORT_MODE_ORDER,
  HandOrganizer,
  type SortMode,
} from './handOrganizer';
import {
  cardEl,
  renderApp,
  renderPartial,
  toast,
  updateSelectionClasses,
  type Refs,
  type ViewState,
} from './render';
import { sfx } from './sound';

const SAVE_KEY = 'guandan.save.v1';
const SETTINGS_KEY = 'guandan.settings.v1';
const SEAT_POS = ['bottom', 'right', 'top', 'left'] as const;

export interface AppOptions {
  /** 人类玩家座位，默认 0；传 -1 进入观战模式（四家全 AI） */
  human?: number;
  /** 随机种子；不传则按时间随机 */
  seed?: number;
  /** 规则覆盖 */
  rules?: Partial<RuleConfig>;
  /** 初始难度 */
  difficulty?: Difficulty;
  /** 是否立刻开第一局（测试可关掉） */
  autoStart?: boolean;
}

interface Settings {
  sound: boolean;
  motion: boolean;
}

function nameOf(player: number, human: number): string {
  if (human < 0) return `${player % 2 === 0 ? 'A' : 'B'}${Math.floor(player / 2) + 1}`;
  if (player === human) return '你';
  if (player === teammateOf(human)) return '对家';
  return player === 1 ? '下家' : '上家';
}

export class App {
  readonly human: number;
  private root: HTMLElement;
  private refs: Refs;
  private state: ViewState;
  private timer: number | null = null;
  private hintPool: PlayOption[] = [];
  private hintIndex = 0;
  private flushPool: PlayOption[] = [];
  private flushIndex = 0;
  private difficulty: Difficulty;
  private options: AppOptions;
  private sortMode: SortMode = 'rank';
  private settings: Settings = { sound: true, motion: true };

  /** 出牌阶段开始时的手牌快照，用于复盘 */
  private roundInitialHands: Card[][] | null = null;
  private replay: Replay | null = null;
  private replayIndex = 0;
  private replayPlaying = false;
  private replayTimer: number | null = null;

  private drawerOpen = false;
  private drawerTab: DrawerTab = 'log';
  private lastLogLength = -1;
  private dealPending = false;
  private tributeModalOpen = false;
  private audioUnlocked = false;
  private lastClickedId: number | null = null;
  /** 拖拽刚结束时短暂屏蔽牌桌点击，避免把「拖到牌桌上松手」误判成出牌 */
  private tableClickBlockedUntil = 0;
  private organizer = new HandOrganizer();
  private customHintShown = false;
  private caret: HTMLElement | null = null;
  private drag: {
    kind: 'card' | 'slot' | 'lasso';
    cardId: number;
    slotId: string;
    startX: number;
    startY: number;
    active: boolean;
    ghost: HTMLElement | null;
    drop: { slotId: string; index: number } | null;
    slotDrop: { slotId: string; before: boolean } | null;
  } | null = null;

  /** 当前对局（测试可直接读取） */
  game: GuandanGame;
  /** 当前视图状态（测试可直接读取） */
  view: ViewState;

  constructor(root: HTMLElement, options: AppOptions = {}) {
    this.options = options;
    this.root = root;
    this.human = options.human ?? 0;
    this.difficulty = options.difficulty ?? 'normal';
    this.settings = this.loadSettings();
    this.applySettings();
    this.refs = this.buildSkeleton(root);
    this.game = new GuandanGame(options.rules ?? {}, options.seed ?? 1);
    this.state = {
      human: this.human,
      selected: new Set<number>(),
      message: '',
      messageKind: 'info',
      mode: 'play',
      returnIds: new Set<number>(),
      canAct: false,
      canPass: false,
      showResult: false,
      aiThinking: false,
      spectating: this.human < 0,
      sortMode: this.sortMode,
      slots: [],
      draggingCardId: null,
      draggingSlotId: null,
      dealing: false,
      hideCenterPlay: false,
    };
    this.view = this.state;
    this.bind();
    if (options.autoStart !== false) this.boot();
  }

  // ------------------------------------------------------------- 设置

  private loadSettings(): Settings {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { sound: true, motion: true };
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { sound: parsed.sound !== false, motion: parsed.motion !== false };
    } catch {
      return { sound: true, motion: true };
    }
  }

  private saveSettings(): void {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* 忽略 */
    }
  }

  private applySettings(): void {
    sfx.setEnabled(this.settings.sound);
    motion.enabled = this.settings.motion;
    this.root.classList.toggle('no-motion', !this.settings.motion);
  }

  // ------------------------------------------------------------- 骨架

  private buildSkeleton(root: HTMLElement): Refs {
    root.innerHTML = `
      <div class="app">
        <header class="topbar">
          <div class="brand">掼蛋<span>·水墨</span></div>
          <div class="hud" id="hud"></div>
          <div class="hud tools">
            <select id="difficulty" title="AI 难度">
              <option value="easy">轻松</option>
              <option value="normal" selected>普通</option>
              <option value="hard">困难</option>
            </select>
            <select id="speed" title="AI 思考速度">
              <option value="220">快</option>
              <option value="650" selected>正常</option>
              <option value="1100">慢</option>
            </select>
            <button class="btn" id="btn-replay" title="复盘本局 (R)">复盘</button>
            <button class="btn" id="btn-drawer" title="牌谱与记牌 (L)">记录</button>
            <button class="btn" id="btn-new">重新开局</button>
            <button class="btn btn-ghost" id="btn-rules">规则</button>
          </div>
        </header>
        <main class="table" id="table">
          ${SEAT_POS.map((_, i) => `<div class="seat" id="seat${i}"></div>`).join('')}
          <div class="table-seal">掼<br />蛋</div>
          <div class="center" id="center"></div>
        </main>
        <footer class="hand-area">
          <div class="message" id="message"></div>
          <div class="hand" id="hand"></div>
          <div class="actions">
            <button class="btn btn-primary" id="btn-play">出牌</button>
            <button class="btn" id="btn-pass">不要</button>
            <button class="btn" id="btn-hint">提示</button>
            <button class="btn" id="btn-flush" title="找出手牌里能组的同花顺 (F)">同花顺</button>
            <button class="btn" id="btn-sort">理牌</button>
            <span class="action-sep"></span>
            <button class="btn" id="btn-group" title="把选中的牌组成一组 (G)">成组</button>
            <button class="btn" id="btn-ungroup" title="拆开这一组 (U)">拆组</button>
            <button class="btn btn-ghost" id="btn-clear">重选</button>
          </div>
        </footer>
        <aside class="drawer" id="drawer" hidden>
          <div class="drawer-tabs">
            <button class="tab" data-tab="log">牌谱</button>
            <button class="tab" data-tab="count">记牌</button>
            <button class="tab" data-tab="help">操作</button>
            <span class="drawer-spacer"></span>
            <button class="btn btn-ghost" id="drawer-close" title="关闭 (L)">收起</button>
          </div>
          <div class="drawer-body" id="drawer-body"></div>
          <div class="drawer-foot">
            <label class="opt"><input type="checkbox" id="opt-sound" /> 音效</label>
            <label class="opt"><input type="checkbox" id="opt-motion" /> 动效</label>
          </div>
        </aside>
        <div class="replay-layer" id="replay-layer" hidden></div>
        <div class="modal-layer" id="modal" hidden></div>
        <div class="toast" id="toast"></div>
      </div>
    `;

    const q = <T extends HTMLElement>(id: string): T => {
      const el = root.querySelector<T>(`#${id}`);
      if (!el) throw new Error(`缺少元素 #${id}`);
      return el;
    };

    q<HTMLInputElement>('opt-sound').checked = this.settings.sound;
    q<HTMLInputElement>('opt-motion').checked = this.settings.motion;

    return {
      hud: q('hud'),
      table: q('table'),
      seats: [q('seat0'), q('seat1'), q('seat2'), q('seat3')],
      center: q('center'),
      hand: q('hand'),
      message: q('message'),
      btnPlay: q<HTMLButtonElement>('btn-play'),
      btnPass: q<HTMLButtonElement>('btn-pass'),
      btnHint: q<HTMLButtonElement>('btn-hint'),
      btnClear: q<HTMLButtonElement>('btn-clear'),
      btnSort: q<HTMLButtonElement>('btn-sort'),
      btnFlush: q<HTMLButtonElement>('btn-flush'),
      btnGroup: q<HTMLButtonElement>('btn-group'),
      btnUngroup: q<HTMLButtonElement>('btn-ungroup'),
      modal: q('modal'),
      toast: q('toast'),
      drawer: q('drawer'),
      drawerBody: q('drawer-body'),
      replayLayer: q('replay-layer'),
    };
  }

  private bind(): void {
    const unlock = (): void => {
      if (this.audioUnlocked) return;
      this.audioUnlocked = true;
      sfx.unlock();
    };
    this.root.addEventListener('pointerdown', unlock);
    this.root.addEventListener('keydown', unlock);

    this.bindHand();
    this.refs.table.addEventListener('click', () => this.onTableClick());
    this.refs.btnPlay.addEventListener('click', () => {
      sfx.play('click');
      this.onPrimary();
    });
    this.refs.btnPass.addEventListener('click', () => {
      sfx.play('click');
      this.onPass();
    });
    this.refs.btnHint.addEventListener('click', () => {
      sfx.play('click');
      this.onHint();
    });
    this.refs.btnClear.addEventListener('click', () => {
      sfx.play('click');
      this.state.selected.clear();
      this.render();
    });
    this.refs.btnSort.addEventListener('click', () => this.cycleSort());
    this.refs.btnFlush.addEventListener('click', () => {
      sfx.play('click');
      this.onFindFlush();
    });
    this.refs.btnGroup.addEventListener('click', () => {
      sfx.play('click');
      this.groupSelection();
    });
    this.refs.btnUngroup.addEventListener('click', () => {
      sfx.play('click');
      this.ungroupSelection();
    });

    const diff = this.root.querySelector<HTMLSelectElement>('#difficulty');
    diff?.addEventListener('change', () => {
      this.difficulty = diff.value as Difficulty;
      toast(this.refs, `难度：${diff.options[diff.selectedIndex].text}`);
    });
    const speed = this.root.querySelector<HTMLSelectElement>('#speed');
    speed?.addEventListener('change', () => {
      const value = Number(speed.value);
      this.game.rules.aiDelayMs = value;
      toast(this.refs, `AI 速度：${value <= 300 ? '快' : value <= 800 ? '正常' : '慢'}`);
    });

    this.root.querySelector('#btn-new')?.addEventListener('click', () => {
      sfx.play('click');
      this.newMatch();
    });
    this.root.querySelector('#btn-rules')?.addEventListener('click', () => {
      sfx.play('click');
      this.showRules();
    });
    this.root.querySelector('#btn-drawer')?.addEventListener('click', () => {
      sfx.play('toggle');
      this.toggleDrawer();
    });
    this.root.querySelector('#drawer-close')?.addEventListener('click', () => {
      sfx.play('toggle');
      this.toggleDrawer(false);
    });
    this.root.querySelector('#btn-replay')?.addEventListener('click', () => {
      sfx.play('click');
      this.openReplay();
    });
    this.refs.drawer.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        sfx.play('click');
        this.drawerTab = (tab.dataset.tab ?? 'log') as DrawerTab;
        this.refreshTabs();
        this.renderDrawer(true);
      });
    });
    this.root.querySelector('#opt-sound')?.addEventListener('change', (ev) => {
      this.settings.sound = (ev.target as HTMLInputElement).checked;
      this.applySettings();
      this.saveSettings();
      if (this.settings.sound) sfx.play('toggle');
    });
    this.root.querySelector('#opt-motion')?.addEventListener('change', (ev) => {
      this.settings.motion = (ev.target as HTMLInputElement).checked;
      this.applySettings();
      this.saveSettings();
    });

    window.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  private refreshTabs(): void {
    this.refs.drawer.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === this.drawerTab);
    });
  }

  private cycleSort(): void {
    sfx.play('toggle');
    const next =
      SORT_MODE_ORDER[(SORT_MODE_ORDER.indexOf(this.organizer.mode) + 1) % SORT_MODE_ORDER.length];
    if (!this.spectating) {
      this.organizer.setMode(next, this.game.hands[this.human], this.game.level, this.game.rules);
    }
    this.sortMode = next;
    this.customHintShown = false;
    toast(
      this.refs,
      `理牌：${SORT_MODE_LABEL[next]}${next === 'combo' ? '（可拖动自由调整）' : ''}`,
    );
    this.render();
  }

  // ------------------------------------------------------------- 手牌拖拽

  /** 手牌交互：单击选中、拖动排布、Shift 拖动框选、双击出单张、点组标签选整组 */
  private bindHand(): void {
    const hand = this.refs.hand;
    hand.addEventListener('pointerdown', (ev) => this.onHandDown(ev));
    hand.addEventListener('pointermove', (ev) => this.onHandMove(ev));
    hand.addEventListener('pointerup', (ev) => this.onHandUp(ev));
    hand.addEventListener('pointercancel', () => this.endDrag());
    window.addEventListener('pointerup', () => this.endDrag());
    hand.addEventListener('contextmenu', (ev) => {
      const labelEl = (ev.target as HTMLElement).closest('.group-label') as HTMLElement | null;
      if (!labelEl?.dataset.slotId) return;
      ev.preventDefault();
      this.startRename(labelEl.dataset.slotId);
    });
    hand.addEventListener('dblclick', (ev) => {
      if (this.state.mode === 'return') return;
      const labelEl = (ev.target as HTMLElement).closest('.group-label') as HTMLElement | null;
      if (labelEl?.dataset.slotId) {
        this.playGroup(labelEl.dataset.slotId);
        return;
      }
      const card = (ev.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card) return;
      const id = Number(card.dataset.id);
      if (!Number.isNaN(id)) this.selectSameRank(id);
    });
  }

  private slotIdOf(el: HTMLElement | null): string {
    const box = el?.closest('.group-cards') as HTMLElement | null;
    return box?.dataset.slotId ?? '';
  }

  private onHandDown(ev: PointerEvent): void {
    if (this.spectating) return;
    const target = ev.target as HTMLElement;
    const labelEl = target.closest('.group-label') as HTMLElement | null;
    const cardEl = target.closest('.card') as HTMLElement | null;

    if (this.state.mode === 'return') {
      const id = Number(cardEl?.dataset.id);
      if (!Number.isNaN(id)) this.applyReturnPick(id);
      return;
    }
    const id = cardEl ? Number(cardEl.dataset.id) : Number.NaN;
    if (cardEl && !Number.isNaN(id)) {
      if (ev.altKey) {
        ev.preventDefault();
        this.selectGroupOfCard(id);
        return;
      }
      if (ev.shiftKey && !this.drag) {
        ev.preventDefault();
        this.selectRangeTo(id);
        return;
      }
    }

    const editEl = target.closest('.label-edit') as HTMLElement | null;
    if (editEl?.dataset.slotId) {
      // 阻止 mousedown 的默认聚焦行为，否则刚插入的输入框会立刻失焦
      ev.preventDefault();
      this.startRename(editEl.dataset.slotId);
      return;
    }

    if (ev.shiftKey) {
      this.drag = {
        kind: 'lasso',
        cardId: -1,
        slotId: '',
        startX: ev.clientX,
        startY: ev.clientY,
        active: true,
        ghost: null,
        drop: null,
        slotDrop: null,
      };
      this.lassoTouch(ev.clientX, ev.clientY);
      return;
    }
    if (labelEl) {
      this.drag = {
        kind: 'slot',
        cardId: -1,
        slotId: labelEl.dataset.slotId ?? '',
        startX: ev.clientX,
        startY: ev.clientY,
        active: false,
        ghost: null,
        drop: null,
        slotDrop: null,
      };
      return;
    }
    if (cardEl) {
      const id = Number(cardEl.dataset.id);
      if (Number.isNaN(id)) return;
      this.drag = {
        kind: 'card',
        cardId: id,
        slotId: this.slotIdOf(cardEl),
        startX: ev.clientX,
        startY: ev.clientY,
        active: false,
        ghost: null,
        drop: null,
        slotDrop: null,
      };
    }
  }

  private onHandMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'lasso') {
      this.lassoTouch(ev.clientX, ev.clientY);
      return;
    }
    if (!d.active) {
      if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 7) return;
      d.active = true;
      this.beginDragVisual(d);
    }
    this.moveGhost(ev.clientX, ev.clientY);
    this.updateDropTarget(ev.clientX, ev.clientY);
  }

  private onHandUp(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      if (d.kind === 'card') this.toggleCard(d.cardId);
      else if (d.kind === 'slot') this.selectGroup(d.slotId);
    } else if (d.kind === 'card' && d.drop) {
      const moved =
        d.drop.slotId === NEW_GROUP
          ? this.organizer.createGroup(
              [d.cardId],
              this.game.hands[this.human],
              this.game.level,
              this.game.rules,
            )
          : this.organizer.moveCard(d.cardId, d.drop.slotId, d.drop.index);
      if (moved) {
        sfx.play('select');
        this.notifyCustom();
      }
    } else if (d.kind === 'slot' && d.slotDrop) {
      if (this.organizer.moveSlot(d.slotId, d.slotDrop.slotId, d.slotDrop.before)) {
        sfx.play('select');
        this.notifyCustom();
      }
    }
    void ev;
    const wasActive = d.active;
    if (wasActive) this.tableClickBlockedUntil = Date.now() + 300;
    this.endDrag();
    if (wasActive) this.render();
  }

  private notifyCustom(): void {
    if (this.customHintShown) return;
    this.customHintShown = true;
    toast(this.refs, '已记住你的排布 · 再点「理牌」恢复自动排序');
  }

  private beginDragVisual(d: NonNullable<App['drag']>): void {
    this.state.draggingCardId = d.kind === 'card' ? d.cardId : null;
    this.state.draggingSlotId = d.kind === 'slot' ? d.slotId : null;
    this.render();
    if (d.kind === 'card') {
      const src = this.refs.hand.querySelector<HTMLElement>(`.slot[data-card-id="${d.cardId}"]`);
      src?.classList.add('drag-source');
      const card = src?.querySelector('.card');
      if (card) {
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add('drag-ghost');
        document.body.appendChild(ghost);
        d.ghost = ghost;
      }
      this.refs.hand.classList.add('dragging');
    } else if (d.kind === 'slot') {
      this.refs.hand
        .querySelector<HTMLElement>(`.hand-group[data-slot-id="${d.slotId}"]`)
        ?.classList.add('drag-slot');
      this.refs.hand.classList.add('dragging');
    }
  }

  private moveGhost(x: number, y: number): void {
    const g = this.drag?.ghost;
    if (!g) return;
    g.style.left = `${x}px`;
    g.style.top = `${y}px`;
  }

  private updateDropTarget(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'card') {
      const zone = this.refs.hand.querySelector<HTMLElement>('.new-group-zone');
      if (zone) {
        const r = zone.getBoundingClientRect();
        if (x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 30 && y <= r.bottom + 30) {
          d.drop = { slotId: NEW_GROUP, index: 0 };
          this.showCaret(r.left + 4, r.top, r.height);
          return;
        }
      }
      const slots = Array.from(
        this.refs.hand.querySelectorAll<HTMLElement>('.group-cards .slot'),
      ).filter((el) => Number(el.dataset.cardId) !== d.cardId);
      if (slots.length === 0) {
        d.drop = null;
        this.hideCaret();
        return;
      }
      let best = slots[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const el of slots) {
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(x - (r.left + r.width / 2), (y - (r.top + r.height / 2)) * 1.5);
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      const r = best.getBoundingClientRect();
      const after = x > r.left + r.width / 2;
      const box = best.closest('.group-cards') as HTMLElement;
      const ids = Array.from(box.querySelectorAll<HTMLElement>('.slot')).map((el) =>
        Number(el.dataset.cardId),
      );
      const index = Math.max(0, ids.indexOf(Number(best.dataset.cardId)) + (after ? 1 : 0));
      d.drop = { slotId: this.slotIdOf(best), index };
      this.showCaret(after ? r.right : r.left, r.top, r.height);
      return;
    }
    if (d.kind === 'slot') {
      const groups = Array.from(this.refs.hand.querySelectorAll<HTMLElement>('.hand-group')).filter(
        (el) => el.dataset.slotId !== d.slotId,
      );
      if (groups.length === 0) {
        d.slotDrop = null;
        this.hideCaret();
        return;
      }
      let best = groups[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const el of groups) {
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      const r = best.getBoundingClientRect();
      const before = x < r.left + r.width / 2;
      d.slotDrop = { slotId: best.dataset.slotId ?? '', before };
      this.showCaret(before ? r.left : r.right, r.top, r.height);
    }
  }

  private showCaret(x: number, y: number, h: number): void {
    if (!this.caret) {
      this.caret = document.createElement('div');
      this.caret.className = 'drop-caret';
      document.body.appendChild(this.caret);
    }
    this.caret.style.left = `${x}px`;
    this.caret.style.top = `${y - 5}px`;
    this.caret.style.height = `${h + 10}px`;
    this.caret.style.opacity = '1';
  }

  private hideCaret(): void {
    if (this.caret) this.caret.style.opacity = '0';
  }

  private endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (this.state.draggingCardId !== null || this.state.draggingSlotId !== null) {
      this.state.draggingCardId = null;
      this.state.draggingSlotId = null;
    }
    if (!d) return;
    d.ghost?.remove();
    this.hideCaret();
    this.refs.hand.classList.remove('dragging');
    this.refs.hand
      .querySelectorAll('.drag-source, .drag-slot')
      .forEach((el) => el.classList.remove('drag-source', 'drag-slot'));
  }

  private lassoTouch(x: number, y: number): void {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const card = el?.closest('.card') as HTMLElement | null;
    if (!card) return;
    const id = Number(card.dataset.id);
    if (Number.isNaN(id) || this.state.selected.has(id)) return;
    this.state.selected.add(id);
    sfx.play('select');
    card.classList.add('selected');
  }

  /**
   * 单击组标签：选中「正好这一组」。
   * 已经是整组选中状态时再点一次则取消 —— 替换式选择比累加更符合直觉。
   */
  private selectGroup(slotId: string): void {
    const slot = this.organizer.slots.find((s) => s.id === slotId);
    if (!slot || slot.ids.length === 0) return;
    const all = slot.ids.every((id) => this.state.selected.has(id));
    this.state.selected.clear();
    if (!all) for (const id of slot.ids) this.state.selected.add(id);
    sfx.play('select');
    this.render();
  }

  /** 双击一张牌：选中所有同点数的牌（凑对子/三张/炸弹最快） */
  private selectSameRank(id: number): void {
    const card = this.game.hands[this.human].find((c) => c.id === id);
    if (!card) return;
    const same = this.game.hands[this.human].filter((c) => c.rank === card.rank);
    const allSelected = same.every((c) => this.state.selected.has(c.id));
    this.state.selected.clear();
    if (!allSelected) for (const c of same) this.state.selected.add(c.id);
    this.lastClickedId = id;
    sfx.play('select');
    this.refreshSelection();
  }

  /** 当前手牌的显示顺序（按分块、按块内顺序铺平） */
  private orderedCardIds(): number[] {
    return this.state.slots.flatMap((slot) => slot.cards.map((c) => c.id));
  }

  /** Shift + 点牌：从上一张点过的牌选到这一张（划顺子最快） */
  private selectRangeTo(id: number): void {
    const order = this.orderedCardIds();
    const to = order.indexOf(id);
    if (to < 0) return;
    const anchor = this.lastClickedId === null ? to : order.indexOf(this.lastClickedId);
    const from = anchor < 0 ? to : anchor;
    const [a, b] = from <= to ? [from, to] : [to, from];
    this.state.selected.clear();
    for (let i = a; i <= b; i++) this.state.selected.add(order[i]);
    this.lastClickedId = id;
    sfx.play('select');
    this.refreshSelection();
  }

  /** Alt + 点牌：选中这张牌所在的整组 */
  private selectGroupOfCard(id: number): void {
    const slot = this.organizer.findSlotOf(id);
    if (slot) this.selectGroup(slot.id);
  }

  /** 双击组标签：整组选中并直接打出 */
  private playGroup(slotId: string): void {
    const slot = this.organizer.slots.find((s) => s.id === slotId);
    if (!slot || slot.ids.length === 0) return;
    this.state.selected = new Set(slot.ids);
    this.lastClickedId = slot.ids[0] ?? null;
    this.render();
    this.onPrimary();
  }

  /** 点牌桌 = 出牌（选好牌之后不用再去够按钮） */
  private onTableClick(): void {
    if (this.spectating) return;
    if (!this.refs.replayLayer.hidden || !this.refs.modal.hidden) return;
    if (Date.now() < this.tableClickBlockedUntil) return;
    if (this.state.mode === 'return') {
      if (this.state.selected.size === 1) this.onPrimary();
      else toast(this.refs, '先选一张要还的牌，再点牌桌');
      return;
    }
    if (!this.state.canAct) {
      toast(this.refs, '还没轮到你出牌');
      return;
    }
    if (this.state.selected.size === 0) {
      toast(this.refs, '先选牌，再点牌桌出牌');
      return;
    }
    this.onPrimary();
  }

  /** 手动成组：选中的牌独立成一组 */
  private groupSelection(): void {
    if (this.spectating) return;
    const cards = this.selectedCards();
    if (cards.length < 2) {
      toast(this.refs, '至少选中 2 张牌才能成组');
      return;
    }
    const ok = this.organizer.createGroup(
      cards.map((c) => c.id),
      this.game.hands[this.human],
      this.game.level,
      this.game.rules,
    );
    if (!ok) return;
    sfx.play('toggle');
    toast(this.refs, `已把这 ${cards.length} 张牌组成一组`);
    this.notifyCustom();
    this.render();
  }

  /** 拆组：选中刚好一整组时，把这些牌放回「未分组」 */
  private ungroupSelection(): void {
    if (this.spectating) return;
    const selected = this.state.selected;
    const slot = this.organizer.slots.find(
      (s) => s.kind === 'group' && s.ids.length > 0 && s.ids.length === selected.size && s.ids.every((id) => selected.has(id)),
    );
    if (!slot) {
      toast(this.refs, '先点组标签选中整组，再点「拆组」');
      return;
    }
    if (!this.organizer.dissolveGroup(slot.id)) return;
    sfx.play('toggle');
    toast(this.refs, '已拆开这一组，牌进了「未分组」');
    this.render();
  }

  /** 双击组标签改名 */
  private startRename(slotId: string): void {
    const el = this.refs.hand.querySelector<HTMLElement>(
      `.group-label[data-slot-id="${slotId}"]`,
    );
    if (!el) return;
    const input = document.createElement('input');
    input.className = 'group-rename';
    input.value = el.querySelector('.label-text')?.textContent ?? '';
    input.maxLength = 12;
    el.replaceWith(input);
    let done = false;
    // 输入框刚插入时可能被浏览器的默认聚焦行为抢走焦点，先武装一帧再接受 blur 提交
    let armed = false;
    requestAnimationFrame(() => {
      armed = true;
      input.focus();
      input.select();
    });
    const commit = (save: boolean): void => {
      if (done || !armed) return;
      done = true;
      if (save) this.organizer.renameSlot(slotId, input.value);
      this.render();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('blur', () => commit(true));
  }

  private applyReturnPick(id: number): void {
    if (!this.state.returnIds.has(id)) {
      this.state.message = '这张牌不能用于还贡（须不大于 10）';
      this.state.messageKind = 'error';
      sfx.play('error');
      this.render();
      return;
    }
    this.state.selected.clear();
    this.state.selected.add(id);
    this.state.message = '点击「确认还贡」提交';
    this.state.messageKind = 'info';
    sfx.play('select');
    this.render();
  }

  private onKey(ev: KeyboardEvent): void {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = ev.key.toLowerCase();
    if (key === ' ' || key === 'spacebar' || key === 'p') {
      ev.preventDefault();
      if (!this.refs.replayLayer.hidden) {
        this.toggleReplayPlay();
        return;
      }
      if (!this.refs.modal.hidden) {
        this.dismissModal();
        return;
      }
      this.onPassKey();
      return;
    }
    if (key === 'enter') {
      ev.preventDefault();
      if (!this.refs.replayLayer.hidden) {
        this.toggleReplayPlay();
        return;
      }
      if (!this.refs.modal.hidden) {
        this.dismissModal();
        return;
      }
      this.onPrimary();
      return;
    }
    if (key === 'h') {
      this.onHint();
      return;
    }
    if (key === 'f') {
      this.onFindFlush();
      return;
    }
    if (key === 's') {
      this.cycleSort();
      return;
    }
    if (key === 'g') {
      this.groupSelection();
      return;
    }
    if (key === 'u') {
      this.ungroupSelection();
      return;
    }
    if (key === 'l') {
      this.toggleDrawer();
      return;
    }
    if (key === 'r') {
      this.openReplay();
      return;
    }
    if (key === 'm') {
      this.settings.sound = !this.settings.sound;
      this.applySettings();
      this.saveSettings();
      const box = this.root.querySelector<HTMLInputElement>('#opt-sound');
      if (box) box.checked = this.settings.sound;
      toast(this.refs, this.settings.sound ? '音效已开启' : '音效已关闭');
      return;
    }
    if (key === 'escape') {
      if (!this.refs.replayLayer.hidden) {
        this.closeReplay();
        return;
      }
      if (!this.refs.modal.hidden) {
        this.hideModal();
        return;
      }
      if (this.drawerOpen) {
        this.toggleDrawer(false);
        return;
      }
      this.state.selected.clear();
      this.render();
    }
  }

  // ------------------------------------------------------------- 抽屉

  private toggleDrawer(force?: boolean): void {
    this.drawerOpen = force ?? !this.drawerOpen;
    this.refs.drawer.hidden = !this.drawerOpen;
    this.refs.drawer.classList.toggle('open', this.drawerOpen);
    if (this.drawerOpen) {
      this.refreshTabs();
      this.renderDrawer(true);
    }
  }

  private panelContext(): PanelContext {
    return { game: this.game, human: this.human, spectating: this.spectating };
  }

  private renderDrawer(force = false): void {
    if (!this.drawerOpen) return;
    if (!force && this.drawerTab === 'log' && this.game.history.length === this.lastLogLength) {
      return;
    }
    this.lastLogLength = this.game.history.length;
    const body = this.refs.drawerBody;
    if (this.drawerTab === 'log') renderLogPanel(body, this.buildReplay(), this.panelContext());
    else if (this.drawerTab === 'count') renderCountPanel(body, this.panelContext());
    else renderHelpPanel(body);
  }

  // ------------------------------------------------------------- 复盘

  private buildReplay(): Replay | null {
    if (!this.roundInitialHands) return null;
    return new Replay(this.roundInitialHands, this.human, this.game.history);
  }

  private openReplay(): void {
    if (!this.roundInitialHands || this.game.history.length === 0) {
      toast(this.refs, '本局还没有出牌记录');
      return;
    }
    this.replay = this.buildReplay();
    this.replayIndex = 0;
    this.replayPlaying = false;
    this.refs.replayLayer.hidden = false;
    sfx.play('click');
    this.renderReplay();
  }

  private closeReplay(): void {
    this.stopReplayTimer();
    this.replayPlaying = false;
    this.refs.replayLayer.hidden = true;
    this.refs.replayLayer.innerHTML = '';
    this.replay = null;
  }

  private stopReplayTimer(): void {
    if (this.replayTimer !== null) {
      window.clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }

  private seekReplay(index: number): void {
    if (!this.replay) return;
    this.replayIndex = Math.max(0, Math.min(this.replay.length - 1, index));
    sfx.play('select');
    this.renderReplay();
  }

  private toggleReplayPlay(): void {
    if (!this.replay) return;
    this.replayPlaying = !this.replayPlaying;
    sfx.play('toggle');
    if (this.replayPlaying) this.scheduleReplayTick();
    else this.stopReplayTimer();
    this.renderReplay();
  }

  private scheduleReplayTick(): void {
    this.stopReplayTimer();
    if (!this.replayPlaying || !this.replay) return;
    this.replayTimer = window.setTimeout(() => {
      if (!this.replay) return;
      if (this.replayIndex >= this.replay.length - 1) {
        this.replayPlaying = false;
        this.stopReplayTimer();
        this.renderReplay();
        return;
      }
      this.replayIndex += 1;
      sfx.play('select');
      this.renderReplay();
      this.scheduleReplayTick();
    }, 700);
  }

  private renderReplay(): void {
    if (!this.replay) return;
    renderReplayOverlay(
      this.refs.replayLayer,
      {
        replay: this.replay,
        index: this.replayIndex,
        playing: this.replayPlaying,
        ctx: this.panelContext(),
      },
      {
        onSeek: (i) => {
          this.replayPlaying = false;
          this.stopReplayTimer();
          this.seekReplay(i);
        },
        onTogglePlay: () => this.toggleReplayPlay(),
        onClose: () => this.closeReplay(),
      },
    );
  }

  // ------------------------------------------------------------- 流程

  private get spectating(): boolean {
    return this.human < 0;
  }

  /** 启动：优先恢复上次未打完的一局 */
  private boot(): void {
    this.clearTimer();
    if (this.tryRestore()) {
      toast(this.refs, '已恢复上一局');
      this.loop();
      return;
    }
    this.newMatch();
  }

  newMatch(): void {
    this.clearTimer();
    this.closeReplay();
    this.clearSave();
    const seed = this.options.seed ?? (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    this.game = new GuandanGame(this.options.rules ?? {}, seed);
    this.startRound();
  }

  startRound(): void {
    this.clearTimer();
    this.closeReplay();
    this.game.startRound();
    this.hintPool = [];
    this.hintIndex = 0;
    this.flushPool = [];
    this.flushIndex = 0;
    this.roundInitialHands = null;
    this.lastLogLength = -1;
    this.state.selected.clear();
    this.state.mode = 'play';
    this.state.returnIds = new Set();
    this.state.showResult = false;
    this.dealPending = true;
    this.customHintShown = false;
    if (!this.spectating) {
      this.organizer.reflow(this.game.hands[this.human], this.game.level, this.game.rules);
    }
    this.hideModal();
    sfx.play('deal');
    // 有进贡 / 抗贡时先把这一步明确摆出来，再进入出牌
    const hasTribute = this.game.tributes.length > 0 || this.game.antiTributePlayers.length > 0;
    if (hasTribute && !this.spectating) {
      this.showTributeModal();
    }
    this.loop();
  }

  private clearSave(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* 隐私模式下不可用，忽略 */
    }
  }

  private persist(): void {
    if (this.options.autoStart === false) return;
    try {
      const phase = this.game.phase;
      if (phase !== 'playing' && phase !== 'returnTribute') {
        window.localStorage.removeItem(SAVE_KEY);
        return;
      }
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.game.snapshot()));
    } catch {
      /* 存储不可用时静默降级 */
    }
  }

  private tryRestore(): boolean {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw) as Record<string, unknown>;
      const restored = GuandanGame.fromSnapshot(snap);
      if (restored.phase !== 'playing' && restored.phase !== 'returnTribute') return false;
      this.game = restored;
      if (this.options.rules?.aiDelayMs !== undefined) {
        this.game.rules.aiDelayMs = this.options.rules.aiDelayMs;
      }
      return true;
    } catch {
      return false;
    }
  }

  private delay(): number {
    return this.game.rules.aiDelayMs + Math.random() * 260;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private loop(): void {
    this.clearTimer();
    this.persist();
    const g = this.game;
    // 进贡面板开着的时候，谁都先别动
    if (this.tributeModalOpen) {
      this.render();
      return;
    }
    this.state.aiThinking = false;
    this.state.canAct = false;
    this.state.canPass = false;
    this.state.dealing = this.dealPending;
    this.dealPending = false;

    if (!this.roundInitialHands && g.phase === 'playing') {
      this.roundInitialHands = g.hands.map((h) => h.slice());
      this.replay = null;
    }

    if (g.phase === 'roundEnd' || g.phase === 'matchEnd') {
      this.state.showResult = true;
      this.render();
      this.playResultSound();
      this.showResultModal();
      return;
    }

    if (g.phase === 'returnTribute') {
      const req = g.pending[0];
      if (!req) {
        this.render();
        return;
      }
      if (!this.spectating && req.player === this.human) {
        this.state.mode = 'return';
        this.state.returnIds = new Set(req.candidateIds);
        this.state.selected.clear();
        this.state.message = `还贡：请选一张牌给${nameOf(req.to, this.human)}`;
        this.state.messageKind = 'info';
        this.render();
        return;
      }
      this.state.mode = 'play';
      this.state.aiThinking = true;
      this.render();
      this.timer = window.setTimeout(() => this.aiTick(), this.delay());
      return;
    }

    if (g.phase === 'playing') {
      this.state.mode = 'play';
      if (!this.spectating && g.current === this.human) {
        this.state.canAct = true;
        this.state.canPass = g.canPass(this.human);
        this.state.message = g.target ? '轮到你跟牌' : '轮到你首出';
        this.state.messageKind = 'info';
        this.render();
        this.pulseWildCards();
        return;
      }
      this.state.aiThinking = true;
      this.render();
      this.timer = window.setTimeout(() => this.aiTick(), this.delay());
    }
  }

  private pulseWildCards(): void {
    if (!motion.enabled) return;
    this.refs.hand.querySelectorAll<HTMLElement>('.card.wild').forEach((el) => pulse(el));
  }

  private playResultSound(): void {
    const result = this.game.roundResult;
    if (!result) return;
    if (this.spectating) {
      sfx.play('place');
      return;
    }
    sfx.play(result.headTeam === this.human % 2 ? 'win' : 'lose');
  }

  private aiTick(): void {
    this.timer = null;
    try {
      aiStep(this.game, { human: this.human, difficulty: this.difficulty, rng: Math.random });
    } catch (err) {
      console.error('AI 出牌异常', err);
    }
    this.afterStep();
  }

  /** 消费引擎事件 → 音效与特效，然后推进状态 */
  private afterStep(): void {
    const events = this.game.drainEvents();
    let fly: { player: number; cards: Card[] } | null = null;
    let land = false;
    for (const e of events) {
      if (e.type === 'play') {
        fly = { player: e.player, cards: e.combo.cards };
        if (e.combo.isBomb) {
          sfx.play('bomb');
          land = true;
        } else {
          sfx.play('play');
        }
      } else if (e.type === 'pass') {
        sfx.play('pass');
        floatBubble(this.refs.table, this.refs.seats[e.player], '不要', 'pass');
      } else if (e.type === 'antiTribute') {
        sfx.play('tribute');
        toast(this.refs, `${e.players.map((p) => nameOf(p, this.human)).join('、')} 抗贡！`);
      } else if (e.type === 'tribute') {
        sfx.play('tribute');
        floatBubble(this.refs.table, this.refs.seats[e.from], `进贡 → ${nameOf(e.to, this.human)}`, 'info');
      } else if (e.type === 'return') {
        sfx.play('tribute');
      } else if (e.type === 'finish') {
        sfx.play('place');
        toast(this.refs, `${nameOf(e.player, this.human)} ${['头游', '二游', '三游'][e.place - 1]}`);
      } else if (e.type === 'trick' && e.borrowed) {
        floatBubble(this.refs.table, this.refs.seats[e.leader], '接风', 'info');
      }
    }
    if (land) bombEffect(this.refs.table);

    if (fly) this.state.hideCenterPlay = true;
    this.loop();
    if (fly) {
      this.state.hideCenterPlay = false;
      this.doFly(fly.player, fly.cards);
    }
  }

  private doFly(player: number, cards: readonly Card[]): void {
    const reveal = (): void => {
      const row = this.refs.table.querySelector<HTMLElement>('.center .play-row');
      row?.classList.remove('landing');
    };
    if (!motion.enabled) {
      reveal();
      return;
    }
    flyPlay(this.refs.table, this.refs.seats[player], cards, this.game.level, reveal);
  }

  // ------------------------------------------------------------- 渲染

  /** 只更新选中态，不重建手牌 DOM */
  private refreshSelection(): void {
    updateSelectionClasses(this.refs.hand, this.state.selected);
    renderPartial(this.refs, this.game, this.state);
    this.renderDrawer();
  }

  private render(): void {
    const prev = captureRects(this.refs.hand);
    if (!this.spectating) {
      this.organizer.sync(this.game.hands[this.human], this.game.level, this.game.rules);
      this.state.slots = this.organizer.resolve(
        this.game.hands[this.human],
        this.game.level,
        this.game.rules,
      );
      this.state.sortMode = this.organizer.mode;
    }
    renderApp(this.refs, this.game, this.state);
    playFlip(this.refs.hand, prev);
    if (this.state.dealing) stagger(this.refs.hand, '.slot', 22);
    this.renderDrawer();
  }

  // ------------------------------------------------------------- 交互

  private toggleCard(id: number): void {
    if (this.state.mode === 'return') {
      if (!this.state.returnIds.has(id)) {
        this.state.message = '这张牌不能用于还贡（须不大于 10）';
        this.state.messageKind = 'error';
        sfx.play('error');
        this.render();
        return;
      }
      this.state.selected.clear();
      this.state.selected.add(id);
      this.state.message = '点击「确认还贡」提交';
      this.state.messageKind = 'info';
      sfx.play('select');
      this.render();
      return;
    }
    if (this.state.selected.has(id)) this.state.selected.delete(id);
    else this.state.selected.add(id);
    this.lastClickedId = id;
    sfx.play('select');
    this.state.message = '';
    this.refreshSelection();
  }

  private selectedCards(): Card[] {
    const ids = this.state.selected;
    return this.game.hands[this.human].filter((c) => ids.has(c.id));
  }

  private onPrimary(): void {
    if (this.state.mode === 'return') {
      const card = this.selectedCards()[0];
      if (!card) return;
      try {
        this.game.submitReturn(this.human, card.id);
        this.state.selected.clear();
        this.state.mode = 'play';
        this.afterStep();
      } catch (err) {
        this.fail(err);
      }
      return;
    }
    if (!this.state.canAct) {
      if (this.state.canPass) this.onPass();
      return;
    }
    const cards = this.selectedCards();
    if (cards.length === 0) {
      if (this.state.canPass) this.onPass();
      return;
    }
    const level = this.game.level;
    const target = this.game.target;
    const combos = explainCards(cards, level, target, this.game.rules);
    if (combos.length === 0) {
      this.state.message = target ? `压不过上家的${target.label}` : '不是合法牌型';
      this.state.messageKind = 'error';
      sfx.play('error');
      this.render();
      return;
    }
    // 同一手牌有多种解释时，引擎会取最强的那个（牌相同，强解释不会更差）
    this.commitPlay(cards);
  }

  private commitPlay(cards: Card[], combo?: Combo): void {
    try {
      if (combo) this.game.playAs(this.human, cards, combo);
      else this.game.play(this.human, cards);
      this.state.selected.clear();
      this.hintPool = [];
      this.hintIndex = 0;
      this.flushPool = [];
      this.flushIndex = 0;
      this.state.message = '';
      this.state.messageKind = 'info';
      this.afterStep();
    } catch (err) {
      this.fail(err);
    }
  }

  /** 回车 / 空格：弹层里优先当作"继续" */
  private dismissModal(): void {
    const next =
      this.root.querySelector<HTMLButtonElement>('#tribute-go') ??
      this.root.querySelector<HTMLButtonElement>('#modal-next') ??
      this.root.querySelector<HTMLButtonElement>('#modal-close');
    next?.click();
  }

  /** 空格 / P：不要（过）。首出不能过时退化为出牌。 */
  private onPassKey(): void {
    if (this.state.canPass) {
      this.onPass();
      return;
    }
    if (this.state.canAct && this.state.selected.size > 0) {
      this.onPrimary();
      return;
    }
    toast(this.refs, '你是首出，必须出牌');
  }

  private onPass(): void {
    try {
      this.game.pass(this.human);
      this.state.selected.clear();
      this.state.message = '不要';
      this.afterStep();
    } catch (err) {
      this.fail(err);
    }
  }

  /** 找出手牌里所有能组的同花顺（含逢人配帮忙补的），循环选中 */
  private onFindFlush(): void {
    const g = this.game;
    if (this.spectating) return;
    if (this.flushPool.length === 0) {
      this.flushPool = enumeratePlays(g.hands[this.human], g.level, null, g.rules).filter(
        (o) => o.combo.type === ComboType.StraightFlush,
      );
      this.flushIndex = 0;
    }
    if (this.flushPool.length === 0) {
      this.state.message = '手里没有能组的同花顺';
      this.state.messageKind = 'error';
      sfx.play('error');
      this.render();
      return;
    }
    const opt = this.flushPool[this.flushIndex % this.flushPool.length];
    this.flushIndex += 1;
    this.state.selected = new Set(opt.cards.map((c) => c.id));
    // 说清楚是哪个花色的哪一段，否则两个同花顺看起来一模一样
    const base = opt.cards.find((c) => !isWild(c, this.game.level)) ?? opt.cards[0];
    const bottom = opt.combo.rank - 4;
    const low = bottom === 1 ? 'A' : rankText(bottom);
    const range = `${SUIT_SYMBOL[base.suit]}${low}–${rankText(opt.combo.rank)}`;
    const usedWild = opt.combo.wildAs?.length ? '（用逢人配）' : '';
    this.state.message = `同花顺 ${((this.flushIndex - 1) % this.flushPool.length) + 1}/${
      this.flushPool.length
    }：${range}${usedWild}`;
    this.state.messageKind = 'info';
    sfx.play('select');
    this.refreshSelection();
  }

  private onHint(): void {
    const g = this.game;
    if (g.current !== this.human || g.phase !== 'playing') return;
    if (this.hintPool.length === 0) {
      this.hintPool = enumeratePlays(g.hands[this.human], g.level, g.target, g.rules);
      this.hintIndex = 0;
    }
    if (this.hintPool.length === 0) {
      this.state.message = '没有能压过的牌，只能「不要」';
      this.state.messageKind = 'error';
      sfx.play('error');
      this.render();
      return;
    }
    const opt = this.hintPool[this.hintIndex % this.hintPool.length];
    this.hintIndex += 1;
    this.state.selected = new Set(opt.cards.map((c) => c.id));
    this.state.message = `提示（${((this.hintIndex - 1) % this.hintPool.length) + 1}/${
      this.hintPool.length
    }）：${opt.combo.label}`;
    this.state.messageKind = 'info';
    sfx.play('select');
    this.render();
  }

  private fail(err: unknown): void {
    const text = err instanceof Error ? err.message : String(err);
    this.state.message = text;
    this.state.messageKind = 'error';
    sfx.play('error');
    this.render();
  }

  // ------------------------------------------------------------- 弹层

  private hideModal(): void {
    this.refs.modal.hidden = true;
    this.refs.modal.innerHTML = '';
  }

  /** 进贡 / 还贡 / 抗贡 的结算面板：把这一步明确摆出来，不再只闪一句提示 */
  private showTributeModal(): void {
    const g = this.game;
    const modal = this.refs.modal;
    const anti = g.antiTributePlayers;
    const needReturn = g.pending.some((p) => p.player === this.human);

    const rows = g.tributes
      .map((t) => {
        const wrap = document.createElement('div');
        wrap.className = 'tribute-row';
        const from = document.createElement('span');
        from.className = 'who';
        from.textContent = nameOf(t.from, this.human);
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = '进贡 →';
        const to = document.createElement('span');
        to.className = 'who';
        to.textContent = nameOf(t.to, this.human);
        wrap.append(from, arrow, to);
        const cardBox = document.createElement('span');
        cardBox.className = 'tribute-card';
        cardBox.appendChild(cardEl(t.card, g.level, { small: true, interactive: false }));
        wrap.appendChild(cardBox);
        if (t.returned) {
          const back = document.createElement('span');
          back.className = 'arrow';
          back.textContent = '还贡 →';
          const backCard = document.createElement('span');
          backCard.className = 'tribute-card';
          backCard.appendChild(cardEl(t.returned, g.level, { small: true, interactive: false }));
          wrap.append(back, backCard);
        }
        return wrap;
      })
      .filter(Boolean);

    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal tribute-modal">
        <h2>${anti.length > 0 ? '抗贡' : '进贡'}</h2>
        <div class="sub">第 ${g.round} 局 · 打 ${levelText(g.level)} · 上局名次 ${g.prevFinishOrder
          .map((p) => nameOf(p, this.human))
          .join(' › ')}</div>
        <div class="tribute-list" id="tribute-list"></div>
        <div class="sub" id="tribute-note"></div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="tribute-go">${
            needReturn ? '去还贡' : '开始出牌'
          }</button>
        </div>
      </div>
    `;
    const list = modal.querySelector('#tribute-list')!;
    for (const r of rows) list.appendChild(r);
    const note = modal.querySelector('#tribute-note')!;
    if (anti.length > 0) {
      note.textContent = `${anti
        .map((p) => nameOf(p, this.human))
        .join('、')} 手上有两张大王，本局不进贡，由头游先出牌`;
    } else if (needReturn) {
      note.textContent = '你收到了进贡，需要还一张不大于 10 的牌';
    } else {
      note.textContent = '还贡须为不大于 10 的牌 · 进贡方先出牌';
    }
    this.tributeModalOpen = true;
    sfx.play('tribute');
    modal.querySelector('#tribute-go')!.addEventListener('click', () => {
      sfx.play('click');
      this.tributeModalOpen = false;
      this.hideModal();
      this.loop();
    });
  }

  private showResultModal(): void {
    const g = this.game;
    const result = g.roundResult;
    if (!result) return;
    const myTeam = this.human % 2;
    const win = result.headTeam === myTeam;
    const matchOver = g.phase === 'matchEnd';
    const modal = this.refs.modal;
    modal.hidden = false;

    const rows = result.finishOrder
      .map((p, i) => {
        const mine = this.spectating ? p % 2 === 0 : p % 2 === myTeam;
        return `<div class="rank-row ${mine ? 'mine' : ''}" style="animation-delay:${i * 70}ms">
          <span class="who">${nameOf(p, this.human)}</span>
          <span class="pos">${['头游', '二游', '三游', '末游'][i]}</span>
        </div>`;
      })
      .join('');

    const delta = result.aReset
      ? '三次不过 A，降回 2 重打'
      : `${win ? '我方' : '对方'} 升 ${result.gain} 级 → 打 ${levelText(
          result.levelsAfter[result.headTeam],
        )}`;

    const title = this.spectating
      ? matchOver
        ? `${result.matchWinner === 0 ? 'A 队' : 'B 队'}过 A 获胜`
        : '本局结束'
      : matchOver
        ? result.matchWinner === myTeam
          ? '过 A · 获胜'
          : '惜败'
        : win
          ? '本局拿下'
          : '本局失利';

    modal.innerHTML = `
      <div class="modal result-modal">
        <h2 class="result-title ${win || this.spectating ? 'good' : 'bad'}">${title}</h2>
        <div class="sub">第 ${g.round} 局 · ${
          result.wasARound ? '打 A 局' : `打 ${levelText(result.levelsBefore[result.levelTeamBefore])}`
        }</div>
        <div class="rank-list">${rows}</div>
        <div class="level-delta">${delta}</div>
        <div class="modal-actions">
          ${
            matchOver
              ? '<button class="btn btn-primary" id="modal-next">再来一场</button>'
              : '<button class="btn btn-primary" id="modal-next">下一局</button>'
          }
          <button class="btn" id="modal-view">查看牌桌</button>
        </div>
      </div>
    `;
    const advance = (): void => {
      sfx.play('click');
      if (matchOver) this.newMatch();
      else this.startRound();
    };
    modal.querySelector('#modal-next')!.addEventListener('click', advance);
    modal.querySelector('#modal-view')!.addEventListener('click', () => {
      sfx.play('click');
      this.hideModal();
    });
    if (this.spectating) window.setTimeout(advance, 2600);
  }

  private showRules(): void {
    const modal = this.refs.modal;
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal" style="text-align:left">
        <h2 style="text-align:center">规则速查</h2>
        <div class="sub" style="text-align:center">江苏 / 淮安主流规则</div>
        <ul class="rules-list">
          <li>两副牌 108 张，四人各 27 张，对家为队友，逆时针出牌。</li>
          <li>级牌大于 A、小于小王；<b>红桃级牌是逢人配</b>，可替代除大小王外的任意牌。</li>
          <li>牌型：单张 / 对子 / 三同张 / 三带二 / 顺子(5 张) / 三连对 / 钢板 / 炸弹(4~10 张) / 同花顺 / 四大天王。</li>
          <li>压制序：四大天王 &gt; 六张及以上炸弹 &gt; 同花顺 &gt; 五张及以下炸弹 &gt; 普通牌型。</li>
          <li>升级：头游+二游升 3 级，+三游升 2 级，+末游升 1 级；升级不跳过 A。</li>
          <li>进贡：末游向头游进贡最大牌（红桃级牌除外）；还贡须不大于 10；两张大王可抗贡。</li>
          <li>接风：出完牌后其余三家都不要，由对家接风出牌。</li>
          <li>过 A：打 A 时须「一人头游、另一人非末游」才算过 A；三次不过 A 降回 2。</li>
        </ul>
        <div class="modal-actions" style="margin-top:18px">
          <button class="btn btn-primary" id="modal-close">知道了</button>
        </div>
      </div>
    `;
    modal.querySelector('#modal-close')!.addEventListener('click', () => {
      sfx.play('click');
      this.hideModal();
      this.render();
    });
  }

  // ------------------------------------------------------------- 测试钩子

  /** 测试用：直接选择一个座位的手牌（按 id） */
  selectCardForTest(id: number): void {
    this.toggleCard(id);
  }

  pressPrimary(): void {
    this.onPrimary();
  }
  pressPass(): void {
    this.onPass();
  }
  pressHint(): void {
    this.onHint();
  }
  /** 深链 / 测试用：直接设定理牌方式 */
  setSortModeForTest(mode: SortMode): void {
    if (this.spectating) return;
    this.organizer.setMode(mode, this.game.hands[this.human], this.game.level, this.game.rules);
    this.sortMode = mode;
    this.render();
  }

  /** 测试用：切换抽屉 / 打开复盘 */
  toggleDrawerForTest(tab?: DrawerTab): void {
    if (tab) this.drawerTab = tab;
    this.toggleDrawer(true);
  }
  openReplayForTest(): void {
    this.openReplay();
  }
  seekReplayForTest(index: number): void {
    this.seekReplay(index);
  }
  get replayLengthForTest(): number {
    return this.replay?.length ?? 0;
  }
}

export function mount(root: HTMLElement, options: AppOptions = {}): App {
  return new App(root, options);
}
