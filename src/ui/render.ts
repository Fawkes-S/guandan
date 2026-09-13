import { levelText, rankText } from '../core/cards';
import { teammateOf } from '../core/rules';
import { SUIT_SYMBOL, isWild, type Card, type Combo } from '../core/types';
import type { GuandanGame, PlayRecord } from '../core/engine';
import type { ResolvedSlot, SortMode } from './handOrganizer';

export type MessageKind = 'info' | 'error';
export type { SortMode };

export interface ViewState {
  human: number;
  /** 当前选中的牌 id（渲染层只读） */
  selected: Set<number>;
  message: string;
  messageKind: MessageKind;
  mode: 'play' | 'return';
  /** 还贡时可选牌的 id */
  returnIds: Set<number>;
  canAct: boolean;
  canPass: boolean;
  showResult: boolean;
  aiThinking: boolean;
  /** 观战模式：不显示手牌与操作按钮 */
  spectating: boolean;
  /** 理牌方式 */
  sortMode: SortMode;
  /** 手牌分块（平铺模式只有一块） */
  slots: ResolvedSlot[];
  /** 正在被拖动的牌 */
  draggingCardId: number | null;
  /** 正在被拖动的整组 */
  draggingSlotId: string | null;
  /** 正在发牌（触发错峰入场动画） */
  dealing: boolean;
  /** 中央出牌区暂时隐藏（等飞牌动画落位） */
  hideCenterPlay: boolean;
}

export interface Refs {
  hud: HTMLElement;
  table: HTMLElement;
  seats: HTMLElement[];
  center: HTMLElement;
  hand: HTMLElement;
  message: HTMLElement;
  btnPlay: HTMLButtonElement;
  btnPass: HTMLButtonElement;
  btnHint: HTMLButtonElement;
  btnClear: HTMLButtonElement;
  btnSort: HTMLButtonElement;
  btnGroup: HTMLButtonElement;
  btnUngroup: HTMLButtonElement;
  modal: HTMLElement;
  toast: HTMLElement;
  drawer: HTMLElement;
  drawerBody: HTMLElement;
  replayLayer: HTMLElement;
}

export interface CardOptions {
  selected?: boolean;
  small?: boolean;
  dim?: boolean;
  interactive?: boolean;
}

export function cardEl(card: Card, level: number, opts: CardOptions = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  if (!opts.interactive) el.classList.add('static');
  if (opts.small) el.classList.add('small');
  if (opts.selected) el.classList.add('selected');
  if (opts.dim) el.classList.add('dim');
  if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
  if (card.rank === level) el.classList.add('level');
  if (isWild(card, level)) el.classList.add('wild');
  el.dataset.id = String(card.id);

  const corner = document.createElement('span');
  corner.className = 'corner';
  const pip = document.createElement('span');
  pip.className = 'pip';

  if (card.rank >= 15) {
    const isBig = card.rank === 16;
    el.classList.add('joker', isBig ? 'big' : 'small');
    if (isBig) el.classList.add('red');
    corner.innerHTML = `<b>${isBig ? '大' : '小'}</b><i>王</i>`;
    pip.textContent = '★';
  } else {
    corner.innerHTML = `<b>${rankText(card.rank)}</b><i>${SUIT_SYMBOL[card.suit]}</i>`;
    pip.textContent = SUIT_SYMBOL[card.suit];
  }
  el.append(corner, pip);

  if (isWild(card, level)) {
    const seal = document.createElement('span');
    seal.className = 'seal';
    seal.textContent = '配';
    el.appendChild(seal);
  }
  return el;
}

function playRow(cards: readonly Card[], level: number, small = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'play-row';
  for (const c of cards) row.appendChild(cardEl(c, level, { small, interactive: false }));
  return row;
}

export function comboSummary(combo: Combo): string {
  const wild = combo.wildAs && combo.wildAs.length > 0 ? ' · 含配' : '';
  return `${combo.label}${wild}`;
}

export function renderApp(refs: Refs, game: GuandanGame, state: ViewState): void {
  renderPartial(refs, game, state);
  renderHand(refs.hand, game, state);
}

function markReturning(refs: Refs, state: ViewState): void {
  const area = refs.hand.parentElement;
  area?.classList.toggle('returning', state.mode === 'return');
}

/**
 * 只刷新「除手牌之外」的部分。
 * 单纯点选一张牌时用它 —— 不重建手牌 DOM，既快又不会打断浏览器的双击手势。
 */
export function renderPartial(refs: Refs, game: GuandanGame, state: ViewState): void {
  refs.table.classList.toggle('armed', state.canAct && state.selected.size > 0);
  renderHud(refs.hud, game, state);
  renderSeats(refs.seats, game, state);
  renderCenter(refs.center, game, state);
  renderActions(refs, game, state);
  refs.message.textContent = state.message;
  refs.message.className = `message ${state.messageKind === 'error' ? 'err' : ''}`;
  markReturning(refs, state);
}

/** 只切换选中样式，连中央区都不动 */
export function updateSelectionClasses(hand: HTMLElement, selected: ReadonlySet<number>): void {
  hand.querySelectorAll<HTMLElement>('.slot').forEach((slot) => {
    const id = Number(slot.dataset.cardId);
    slot.querySelector('.card')?.classList.toggle('selected', selected.has(id));
  });
}

function renderHud(hud: HTMLElement, game: GuandanGame, state: ViewState): void {
  const myTeam = state.spectating ? 0 : state.human % 2;
  const oppTeam = 1 - myTeam;
  const myLabel = state.spectating ? 'A 队' : '我方';
  const oppLabel = state.spectating ? 'B 队' : '对方';
  const atA = game.levels[game.levelTeam] === 14;
  hud.innerHTML = `
    <span class="seal-badge">打 <b>${levelText(game.level)}</b></span>
    <span>第 <b>${game.round}</b> 局</span>
    <span>${myLabel} <b>${levelText(game.levels[myTeam])}</b></span>
    <span>${oppLabel} <b>${levelText(game.levels[oppTeam])}</b></span>
    ${
      atA
        ? `<span class="seal-badge">${
            game.aAttempts[game.levelTeam] > 0 ? `过A ${game.aAttempts[game.levelTeam]}/3` : '打A局'
          }</span>`
        : ''
    }
  `;
}

function renderSeats(seats: HTMLElement[], game: GuandanGame, state: ViewState): void {
  const trick = game.trickPlays.length > 0 ? game.trickPlays : game.lastTrickPlays;
  const byPlayer = new Map<number, PlayRecord>();
  for (const r of trick) byPlayer.set(r.player, r);

  for (let p = 0; p < 4; p++) {
    const el = seats[p];
    const isActive = game.phase === 'playing' && game.current === p;
    const finished = game.hands[p].length === 0;
    const place = game.finishOrder.indexOf(p);
    const isPartner = !state.spectating && teammateOf(state.human) === p;
    const name = state.spectating
      ? `${p % 2 === 0 ? 'A' : 'B'}${Math.floor(p / 2) + 1}`
      : p === state.human
        ? '你'
        : isPartner
          ? '对家'
          : p === 1
            ? '下家'
            : '上家';

    el.className = `seat seat-${SEAT_DIR[p]}`;
    el.style.setProperty('--accent', accentOf(p, state));
    if (isActive) el.classList.add('active');
    if (finished) el.classList.add('done');
    // 牌桌上现在摆的是谁出的牌
    if (game.lastPlay?.player === p) el.classList.add('from');

    const record = byPlayer.get(p);
    let chip = '';
    let chipClass = 'chip';
    if (record) {
      if (record.combo) {
        chip = comboSummary(record.combo) + ` ×${record.cards.length}`;
        if (record.combo.isBomb) chipClass += ' bomb';
        else if (p === game.lastPlay?.player) chipClass += ' lead';
      } else {
        chip = '不要';
        chipClass += ' pass';
      }
    }

    el.innerHTML = `
      <div class="avatar"><span class="glyph">${
        state.spectating ? (p % 2 === 0 ? '甲' : '乙') : p === state.human ? '我' : isPartner ? '伴' : '敌'
      }</span></div>
      <div class="name">${name}</div>
      <div class="deck${finished ? ' empty' : ''}"><span>${game.hands[p].length}</span></div>
      ${place >= 0 ? `<div class="place">${['头游', '二游', '三游', '末游'][place]}</div>` : ''}
      ${chip ? `<div class="${chipClass}">${chip}</div>` : ''}
    `;
  }
}

/** 座位配色：我 / 队友 / 对手 三色区分 */
const ACCENT_ME = '#b23a2f';
const ACCENT_PARTNER = '#3f6b52';
const ACCENT_OPP = '#5b5b66';
const SEAT_DIR = ['bottom', 'right', 'top', 'left'] as const;

function accentOf(player: number, state: ViewState): string {
  if (state.spectating) return player % 2 === 0 ? ACCENT_ME : ACCENT_PARTNER;
  if (player === state.human) return ACCENT_ME;
  if (player === teammateOf(state.human)) return ACCENT_PARTNER;
  return ACCENT_OPP;
}

function seatName(player: number, state: ViewState): string {
  if (state.spectating) return `${player % 2 === 0 ? 'A' : 'B'}${Math.floor(player / 2) + 1}`;
  if (player === state.human) return '你';
  if (player === teammateOf(state.human)) return '对家';
  return player === 1 ? '下家' : '上家';
}

function renderCenter(center: HTMLElement, game: GuandanGame, state: ViewState): void {
  center.innerHTML = '';
  const target = game.lastPlay;
  if (target) {
    center.style.setProperty('--accent', accentOf(target.player, state));
    const label = document.createElement('div');
    label.className = 'center-label';
    const dot = document.createElement('span');
    dot.className = 'who-dot';
    const who = document.createElement('b');
    who.textContent = seatName(target.player, state);
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '出';
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = comboSummary(target.combo);
    label.append(dot, who, sep, what);
    center.appendChild(label);

    const arrow = document.createElement('div');
    arrow.className = `from-arrow from-${SEAT_DIR[target.player]}`;
    center.appendChild(arrow);

    const row = playRow(target.combo.cards, game.level, true);
    if (state.hideCenterPlay) row.classList.add('landing');
    center.appendChild(row);
  } else {
    center.style.removeProperty('--accent');
    const label = document.createElement('div');
    label.className = 'center-label lead-empty';
    label.textContent = game.phase === 'playing' ? '新的一手' : '　';
    center.appendChild(label);
  }

  const status = document.createElement('div');
  status.className = 'trick-status';
  const armed = state.canAct && state.selected.size > 0;
  center.classList.toggle('armed', armed);
  if (game.phase === 'playing') {
    const who = seatName(game.current, state);
    if (armed) {
      status.classList.add('armed');
      status.textContent = `已选 ${state.selected.size} 张 · 点牌桌即可出牌`;
    } else if (state.canAct && state.mode === 'return') {
      status.textContent = '选一张要还的牌';
    } else if (state.aiThinking) {
      status.innerHTML = `${who} 思考中<i class="dots"><b></b><b></b><b></b></i>`;
    } else {
      status.textContent = `轮到 ${who}`;
    }
  } else if (game.phase === 'returnTribute') {
    status.textContent = '还贡中…';
  } else {
    status.textContent = '';
  }
  center.appendChild(status);
}

// ------------------------------------------------------------------ 手牌

/** 手牌排版：平铺时排成扇形弧线并自动收紧重叠；分组时按块换行、块内紧凑。 */
function layoutHand(hand: HTMLElement): void {
  const rootStyle = getComputedStyle(document.documentElement);
  const cw = parseFloat(rootStyle.getPropertyValue('--cw')) || 62;
  const parentWidth = hand.parentElement?.clientWidth ?? 0;
  const avail = (parentWidth > 40 ? parentWidth - 40 : hand.clientWidth || 900) - 8;
  const grouped = hand.classList.contains('grouped');

  if (grouped) {
    hand.style.removeProperty('--overlap');
    for (const box of hand.querySelectorAll<HTMLElement>('.group-cards')) {
      const slots = box.querySelectorAll<HTMLElement>('.slot');
      const n = slots.length;
      let step = cw + 3;
      if (n > 1) step = Math.min(step, (avail - cw) / (n - 1));
      step = Math.max(step, 13);
      box.style.setProperty('--overlap', `${Math.round(step - cw)}px`);
      slots.forEach((slot, i) => {
        slot.style.setProperty('--rot', '0deg');
        slot.style.setProperty('--ty', '0px');
        slot.style.zIndex = String(i + 1);
      });
    }
    return;
  }

  const gap = 6;
  const maxStep = Math.min(cw + gap, 46);
  let step = maxStep;
  let wrap = false;
  const count = hand.querySelectorAll('.slot').length;
  if (count > 1) {
    step = Math.min(maxStep, (avail - cw) / (count - 1));
    if (step < 20 && count > 10) {
      wrap = true;
      let rows = 2;
      while (rows < 4 && (avail - cw) / Math.max(1, Math.ceil(count / rows) - 1) < 13) rows += 1;
      const perRow = Math.ceil(count / rows);
      step = Math.min(maxStep, (avail - cw) / Math.max(1, perRow - 1));
      step = Math.max(step, 11);
    }
  }
  hand.classList.toggle('wrap', wrap);
  hand.style.setProperty('--overlap', `${Math.round(step - cw)}px`);

  const slots = hand.querySelectorAll<HTMLElement>('.slot');
  const n = slots.length;
  const mid = (n - 1) / 2;
  const spread = wrap ? 0 : Math.min(1.1, 22 / Math.max(1, n));
  const lift = wrap ? 0 : 9;
  slots.forEach((slot, i) => {
    const t = mid === 0 ? 0 : (i - mid) / mid;
    slot.style.setProperty('--rot', `${(t * spread).toFixed(2)}deg`);
    slot.style.setProperty('--ty', `${(t * t * lift).toFixed(1)}px`);
    slot.style.zIndex = String(i + 1);
  });
}

function cardSlot(card: Card, game: GuandanGame, state: ViewState): HTMLElement {
  // 随时都能选牌理牌；能不能「出牌」由按钮的禁用态把关
  const selectable = state.mode === 'return' ? state.returnIds.has(card.id) : true;
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.dataset.flip = `c${card.id}`;
  slot.dataset.cardId = String(card.id);
  if (state.draggingCardId === card.id) slot.classList.add('drag-source');
  slot.appendChild(
    cardEl(card, game.level, {
      selected: state.selected.has(card.id),
      dim: state.mode === 'return' && !state.returnIds.has(card.id),
      interactive: selectable,
    }),
  );
  return slot;
}

function renderHand(hand: HTMLElement, game: GuandanGame, state: ViewState): void {
  hand.innerHTML = '';
  if (state.spectating) {
    hand.classList.remove('grouped');
    const tip = document.createElement('div');
    tip.className = 'message';
    tip.textContent = '观战中 · 四家均由 AI 出牌';
    hand.appendChild(tip);
    return;
  }
  const grouped = state.slots.some((s) => s.kind === 'group');
  hand.classList.toggle('grouped', grouped);
  if (grouped) hand.classList.remove('wrap');

  for (const slot of state.slots) {
    let outer: HTMLElement;
    if (slot.kind === 'group') {
      outer = document.createElement('div');
      outer.className = 'hand-group';
      if (state.draggingSlotId === slot.id) outer.classList.add('drag-slot');
      outer.dataset.slotId = slot.id;
      const label = document.createElement('div');
      label.className = `group-label${slot.custom ? ' custom' : ''}`;
      label.dataset.slotId = slot.id;
      label.title = '单击选中整组 · 拖动移动整组 · 右键或点 ✎ 改名';
      const text = document.createElement('span');
      text.className = 'label-text';
      text.textContent = slot.label;
      const edit = document.createElement('button');
      edit.className = 'label-edit';
      edit.dataset.slotId = slot.id;
      edit.textContent = '✎';
      edit.title = '给这组改名';
      label.append(text, edit);
      outer.appendChild(label);
    } else {
      outer = document.createElement('div');
      outer.className = 'group-cards flat-cards';
      outer.dataset.slotId = slot.id;
    }
    const cardsBox = document.createElement('div');
    cardsBox.className = 'group-cards';
    cardsBox.dataset.slotId = slot.id;
    for (const card of slot.cards) cardsBox.appendChild(cardSlot(card, game, state));
    if (slot.kind === 'group') outer.appendChild(cardsBox);
    else outer = cardsBox;
    hand.appendChild(outer);
  }

  // 拖拽时在末尾给一个「新建一组」的落点
  if (state.draggingCardId !== null || state.draggingSlotId !== null) {
    const zone = document.createElement('div');
    zone.className = 'new-group-zone';
    zone.dataset.slotId = '__new__';
    zone.textContent = '拖到这里新建一组';
    hand.appendChild(zone);
  }

  if (state.dealing) {
    let i = 0;
    hand.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      el.classList.add('deal-in');
      el.style.animationDelay = `${i++ * 22}ms`;
    });
  }
  layoutHand(hand);
}

function renderActions(refs: Refs, game: GuandanGame, state: ViewState): void {
  if (state.spectating) {
    refs.btnPlay.hidden = true;
    refs.btnPass.hidden = true;
    refs.btnHint.hidden = true;
    refs.btnClear.hidden = true;
    refs.btnSort.hidden = true;
    refs.btnGroup.hidden = true;
    refs.btnUngroup.hidden = true;
    return;
  }
  refs.btnPlay.hidden = false;
  refs.btnClear.hidden = false;
  refs.btnSort.hidden = false;
  refs.btnGroup.hidden = false;
  refs.btnUngroup.hidden = false;
  const returning = state.mode === 'return';
  refs.btnGroup.disabled = returning || state.selected.size < 2;
  refs.btnUngroup.disabled = returning;
  refs.btnPlay.textContent = returning ? '确认还贡' : '出牌';
  refs.btnPlay.disabled = returning ? state.selected.size !== 1 : !state.canAct || state.selected.size === 0;
  refs.btnPass.hidden = returning;
  refs.btnPass.disabled = !state.canPass;
  refs.btnHint.hidden = returning;
  refs.btnHint.disabled = !state.canAct;
  refs.btnClear.hidden = returning;
  refs.btnClear.disabled = state.selected.size === 0;
  void game;
}

/** 简单的顶部提示条 */
let toastTimer: number | null = null;
export function toast(refs: Refs, text: string): void {
  refs.toast.textContent = text;
  refs.toast.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.remove('show'), 1600);
}
