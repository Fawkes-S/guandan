import { rankText } from '../core/cards';
import { teammateOf } from '../core/rules';
import type { Card } from '../core/types';
import type { GuandanGame } from '../core/engine';
import type { Replay } from './replay';
import { cardEl } from './render';
import { SFX_LABELS, type SfxName } from './sound';

export type DrawerTab = 'log' | 'count' | 'help';

export interface PanelContext {
  game: GuandanGame;
  human: number;
  spectating: boolean;
}

export function seatLabel(player: number, human: number): string {
  if (human < 0) return `${player % 2 === 0 ? 'A' : 'B'}${Math.floor(player / 2) + 1}`;
  if (player === human) return '你';
  if (player === teammateOf(human)) return '对家';
  return player === 1 ? '下家' : '上家';
}

function miniCard(card: Card, level: number): HTMLElement {
  return cardEl(card, level, { small: true, interactive: false });
}

function miniRow(cards: readonly Card[], level: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mini-row';
  for (const c of cards) row.appendChild(miniCard(c, level));
  return row;
}

// ------------------------------------------------------------------ 牌谱

export function renderLogPanel(container: HTMLElement, replay: Replay | null, ctx: PanelContext): void {
  container.innerHTML = '';
  if (!replay || replay.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = '本局还没有出牌记录';
    container.appendChild(empty);
    return;
  }
  const tricks = replay.tricks();
  const cap = 12;
  const start = Math.max(0, tricks.length - cap);
  if (start > 0) {
    const more = document.createElement('div');
    more.className = 'panel-empty';
    more.textContent = `更早的 ${start} 手已省略`;
    container.appendChild(more);
  }
  // 最新的在最上面
  for (let t = tricks.length - 1; t >= start; t--) {
    const group = tricks[t];
    const box = document.createElement('div');
    box.className = 'log-trick';
    const head = document.createElement('div');
    head.className = 'log-trick-head';
    head.textContent = `第 ${t + 1} 手`;
    box.appendChild(head);

    for (const step of group) {
      const row = document.createElement('div');
      row.className = `log-row${step.player === ctx.human ? ' me' : ''}`;
      const who = document.createElement('span');
      who.className = 'log-who';
      who.textContent = seatLabel(step.player, ctx.human);
      const body = document.createElement('span');
      body.className = 'log-cards';
      if (step.combo) {
        body.appendChild(miniRow(step.cards, ctx.game.level));
        const tag = document.createElement('em');
        tag.className = `log-tag${step.combo.isBomb ? ' bomb' : ''}`;
        tag.textContent = step.combo.label;
        body.appendChild(tag);
      } else {
        const pass = document.createElement('em');
        pass.className = 'log-tag pass';
        pass.textContent = '不要';
        body.appendChild(pass);
      }
      row.append(who, body);
      box.appendChild(row);
    }
    container.appendChild(box);
  }
}

// ------------------------------------------------------------------ 记牌

export function renderCountPanel(container: HTMLElement, ctx: PanelContext): void {
  container.innerHTML = '';
  const { game, human } = ctx;
  const ranks: number[] = [];
  for (let r = 16; r >= 2; r--) ranks.push(r);

  const tip = document.createElement('div');
  tip.className = 'panel-tip';
  tip.textContent = '显示「除我手牌与已出牌之外」还剩几张在外面';
  container.appendChild(tip);

  const grid = document.createElement('div');
  grid.className = 'count-grid';
  for (const rank of ranks) {
    const own = ctx.spectating ? 0 : game.hands[human].filter((c) => c.rank === rank).length;
    const total = rank >= 15 ? 2 : 8;
    const played = game.playedPool.filter((c) => c.rank === rank).length;
    const outside = Math.max(0, total - played - own);

    const cell = document.createElement('div');
    cell.className = 'count-cell';
    if (outside === 0) cell.classList.add('gone');
    if (rank === game.level) cell.classList.add('level');
    const name = document.createElement('b');
    name.textContent = rankText(rank);
    const num = document.createElement('span');
    num.textContent = String(outside);
    const mine = document.createElement('i');
    mine.textContent = own > 0 ? `我${own}` : '';
    cell.append(name, num, mine);
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  const summary = document.createElement('div');
  summary.className = 'panel-tip';
  const jokers = [16, 15].map((r) => game.remainingRankCount(r, ctx.spectating ? 0 : human));
  summary.innerHTML = `大王在外 <b>${game.playedPool.filter((c) => c.rank === 16).length >= 2 ? 0 : jokers[0]}</b> 张 · 小王在外 <b>${jokers[1]}</b> 张`;
  container.appendChild(summary);
}

// ------------------------------------------------------------------ 帮助

export const HELP_ITEMS: Array<[string, string]> = [
  ['点击手牌', '选中 / 取消'],
  ['双击手牌', '选中所有同点数的牌（凑对子 / 三张 / 炸弹最快）'],
  ['Shift + 点牌', '从上一张点过的牌选到这一张（划顺子最快）'],
  ['Alt + 点牌', '选中这张牌所在的整组'],
  ['Shift + 拖动', '自由框选，划过的手牌连续选中'],
  ['点牌桌', '出牌 —— 选好牌之后不用再去够按钮'],
  ['出牌 / 回车', '打出选中的牌'],
  ['不要 / 空格 / P', '过牌（首出时不可用）'],
  ['提示 / H', '循环给出所有能压过上家的出法'],
  ['同花顺 / F', '找出手牌里能组的同花顺并逐个选中（含逢人配补的）'],
  ['理牌 / S', '按大小 → 花色 → 张数 → 牌型 循环切换'],
  ['拖动牌', '拖到任意位置重排，或拖进别的组'],
  ['拖到「新建一组」', '把这张牌单独分出来，自己起一组'],
  ['点组标签', '正好选中这一组 / 再点一次取消'],
  ['双击组标签', '整组选中并直接打出'],
  ['拖组标签', '整组移动到其他位置'],
  ['成组 / G', '把选中的几张牌按自己的意思组成一组'],
  ['拆组 / U', '选中整组后拆开，牌回到「未分组」'],
  ['点 ✎ / 右键标签', '给这一组起自己的名字'],
  ['L', '打开或关闭这个侧栏'],
  ['R', '打开本局复盘'],
  ['M', '开关音效'],
  ['Esc', '清空选牌 / 关闭弹层'],
];

export interface SoundPanelOptions {
  soundOn: boolean;
  volume: number;
  onToggle: (on: boolean) => void;
  onVolume: (v: number) => void;
  onPreview: (name: SfxName) => void;
}

export function renderHelpPanel(container: HTMLElement, sound?: SoundPanelOptions): void {
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'help-list';
  for (const [key, desc] of HELP_ITEMS) {
    const row = document.createElement('div');
    row.className = 'help-row';
    const k = document.createElement('kbd');
    k.textContent = key;
    const d = document.createElement('span');
    d.textContent = desc;
    row.append(k, d);
    list.appendChild(row);
  }
  container.appendChild(list);

  if (sound) {
    const box = document.createElement('div');
    box.className = 'sound-box';

    const head = document.createElement('div');
    head.className = 'sound-head';
    const label = document.createElement('b');
    label.textContent = '音效';
    const toggle = document.createElement('button');
    toggle.className = 'btn btn-mini';
    toggle.textContent = sound.soundOn ? '开' : '关';
    toggle.addEventListener('click', () => sound.onToggle(!sound.soundOn));
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(sound.volume * 100));
    vol.className = 'sound-vol';
    vol.setAttribute('aria-label', '音量');
    vol.addEventListener('input', () => sound.onVolume(Number(vol.value) / 100));
    head.append(label, toggle, vol);
    box.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'sound-grid';
    for (const [name, text] of SFX_LABELS) {
      const b = document.createElement('button');
      b.className = 'btn btn-mini sound-try';
      b.textContent = text;
      b.addEventListener('click', () => sound.onPreview(name));
      grid.appendChild(b);
    }
    box.appendChild(grid);

    const tip = document.createElement('div');
    tip.className = 'panel-tip';
    tip.style.marginTop = '8px';
    tip.textContent = '点任意一条试听。全部为实时合成，不含任何音频文件。';
    box.appendChild(tip);

    container.appendChild(box);
  }

  const rules = document.createElement('div');
  rules.className = 'panel-tip';
  rules.style.marginTop = '14px';
  rules.innerHTML = `
    <b>进贡 / 还贡</b><br />
    每局开始若上一局有输赢，会弹出进贡面板：末游向头游进贡最大牌（红桃级牌除外），
    双下时两人都进贡、较大的那张给头游；收贡方还一张不大于 10 的牌；<br />
    需要进贡的一方合计有两张大王则<strong>抗贡</strong>，改由头游先出牌。<br /><br />
    <b>按牌型理牌</b><br />
    把 27 张拆成「顺子 / 三带二 / 炸弹 / 对子 / 散张 / 逢人配」等区块，
    组间留空隙并带标签；可以拖动牌自由调整，排布会被记住。<br /><br />
    <b>牌型压制序</b><br />
    四大天王 &gt; 六张及以上炸弹 &gt; 同花顺 &gt; 五张及以下炸弹 &gt; 普通牌型<br /><br />
    <b>升级</b><br />
    头游+二游 +3 · +三游 +2 · +末游 +1；升级不跳过 A<br /><br />
    <b>逢人配</b><br />
    两张红桃级牌，可替代除大小王外任意牌
  `;
  container.appendChild(rules);
}

// ------------------------------------------------------------------ 复盘

export interface ReplayViewOptions {
  replay: Replay;
  index: number;
  playing: boolean;
  ctx: PanelContext;
}

export function renderReplayOverlay(
  root: HTMLElement,
  opts: ReplayViewOptions,
  handlers: {
    onSeek: (index: number) => void;
    onTogglePlay: () => void;
    onClose: () => void;
  },
): void {
  const { replay, index, playing, ctx } = opts;
  const step = replay.step(index);
  root.innerHTML = '';
  if (!step) return;

  const panel = document.createElement('div');
  panel.className = 'replay-panel';

  const head = document.createElement('div');
  head.className = 'replay-head';
  head.innerHTML = `<span>本局复盘</span><span class="replay-step">${
    step.combo ? '' : '过牌 · '
  }${index + 1} / ${replay.length}</span>`;
  const close = document.createElement('button');
  close.className = 'btn btn-ghost';
  close.textContent = '退出复盘';
  close.addEventListener('click', () => handlers.onClose());
  head.appendChild(close);
  panel.appendChild(head);

  // 四家剩余张数
  const seats = document.createElement('div');
  seats.className = 'replay-seats';
  const order = [2, 3, 0, 1];
  for (const p of order) {
    const cell = document.createElement('div');
    cell.className = 'replay-seat';
    if (step.player === p) cell.classList.add('active');
    cell.innerHTML = `<span class="who">${seatLabel(p, ctx.human)}</span><span class="num">${
      step.counts[p]
    }</span>`;
    seats.appendChild(cell);
  }
  panel.appendChild(seats);

  // 这一步的出牌
  const center = document.createElement('div');
  center.className = 'replay-center';
  if (step.combo) {
    const label = document.createElement('div');
    label.className = 'center-label';
    label.textContent = `${seatLabel(step.player, ctx.human)} · ${step.combo.label}`;
    center.appendChild(label);
    center.appendChild(miniRow(step.cards, ctx.game.level));
  } else {
    const label = document.createElement('div');
    label.className = 'center-label';
    label.textContent = `${seatLabel(step.player, ctx.human)} 选择不要`;
    center.appendChild(label);
  }
  panel.appendChild(center);

  // 我的手牌
  const handBox = document.createElement('div');
  handBox.className = 'replay-hand';
  const handLabel = document.createElement('div');
  handLabel.className = 'center-label';
  handLabel.textContent = ctx.spectating ? '牌局进程' : '此刻我的手牌';
  handBox.appendChild(handLabel);
  if (!ctx.spectating) handBox.appendChild(miniRow(step.myHand, ctx.game.level));
  panel.appendChild(handBox);

  // 控制条
  const controls = document.createElement('div');
  controls.className = 'replay-controls';
  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = '上一步';
  prev.disabled = index <= 0;
  prev.addEventListener('click', () => handlers.onSeek(index - 1));

  const toggle = document.createElement('button');
  toggle.className = 'btn btn-primary';
  toggle.textContent = playing ? '暂停' : '自动播放';
  toggle.addEventListener('click', () => handlers.onTogglePlay());

  const next = document.createElement('button');
  next.className = 'btn';
  next.textContent = '下一步';
  next.disabled = index >= replay.length - 1;
  next.addEventListener('click', () => handlers.onSeek(index + 1));

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'replay-slider';
  slider.min = '0';
  slider.max = String(Math.max(0, replay.length - 1));
  slider.value = String(index);
  slider.addEventListener('input', () => handlers.onSeek(Number(slider.value)));

  controls.append(prev, toggle, next, slider);
  panel.appendChild(controls);

  root.appendChild(panel);
}
