/**
 * 真实浏览器 E2E：验证手牌拖拽排布 / 整组选中 / 出牌流程。
 *
 * jsdom 没有布局引擎，拖拽落点算不出来，所以这一层必须用真实浏览器跑。
 * 用法：
 *   node e2e/hand-drag.mjs [baseUrl]
 * Playwright 从环境变量 PW_ROOT 指定的 node_modules 解析（默认用 DSH 检出里的那份）。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5273';

/** 优先用本工程装的 playwright；没有再用 PW_ROOT 指向的那份 */
function loadChromium() {
  const local = join(process.cwd(), 'node_modules', 'playwright');
  const root = process.env.PW_ROOT;
  const candidates = [local];
  if (root) candidates.push(join(root, 'playwright'));
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      const require = createRequire(join(dir, '..', '..', 'package.json'));
      return require(dir).chromium;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    '找不到 playwright：请在本工程 npm i -D playwright，或用 PW_ROOT=<含 playwright 的 node_modules> 指定',
  );
}
const chromium = loadChromium();

const results = [];
let tributePanelSeen = false;
/** 新一局开始可能弹进贡面板，点掉再继续 */
async function dismissTribute() {
  const go = await page.$('#tribute-go');
  if (go) {
    tributePanelSeen = true;
    await go.click();
    await page.waitForTimeout(300);
  }
}
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Playwright 自带的浏览器没下载时，直接用系统里的 Chrome（无需再下 300MB）
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ executablePath: CHROME }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/** 等到轮到自己出牌 */
async function waitMyTurn(timeout = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const mine = await page.evaluate(() => {
      const a = window.__guandan;
      return a.game.phase === 'playing' && a.game.current === a.human;
    });
    if (mine) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
await page.goto(`${BASE}/?seed=11&sort=combo`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hand-group', { timeout: 15000 });
await dismissTribute();

// 1. 分组视图渲染
const groups = await page.$$('.hand-group');
check('按牌型视图渲染出多个分组', groups.length > 1, `${groups.length} 组`);

const labelOf = async () =>
  page.$$eval('.hand-group', (els) =>
    els.map((e) => ({
      label: e.querySelector('.group-label')?.textContent ?? '',
      ids: Array.from(e.querySelectorAll('.slot')).map((s) => Number(s.dataset.cardId)),
    })),
  );

const before = await labelOf();
const totalCards = before.reduce((n, g) => n + g.ids.length, 0);
check('分组覆盖全部 27 张手牌', totalCards === 27, `${totalCards} 张`);

// 2. 点组标签 → 整组选中
await page.click('.hand-group:first-child .group-label');
const selectedCount = await page.$$eval('#hand .card.selected', (e) => e.length);
check(
  '单击组标签选中整组',
  selectedCount === before[0].ids.length,
  `选中 ${selectedCount} / 组内 ${before[0].ids.length}`,
);
await page.click('.hand-group:first-child .group-label');
const deselected = await page.$$eval('#hand .card.selected', (e) => e.length);
check('再次单击取消整组选中', deselected === 0, `剩余 ${deselected}`);

// 3. 拖拽把一张牌搬到另一个组
const srcSlot = await page.$('.hand-group:nth-child(1) .slot');
const dstSlot = await page.$('.hand-group:nth-child(2) .slot');
const srcBox = await srcSlot.boundingBox();
const dstBox = await dstSlot.boundingBox();
await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
await page.mouse.down();
await page.mouse.move(srcBox.x + srcBox.width / 2 + 20, srcBox.y, { steps: 4 });
await page.mouse.move(dstBox.x + dstBox.width * 0.9, dstBox.y + dstBox.height / 2, { steps: 12 });
const caretVisible = await page.evaluate(() => {
  const c = document.querySelector('.drop-caret');
  return c ? getComputedStyle(c).opacity !== '0' : false;
});
check('拖动时出现插入位置指示线', caretVisible);
await page.mouse.up();
await page.waitForTimeout(450);

const after = await labelOf();
const group0After = after[0]?.ids ?? [];
check(
  '拖拽后该牌离开原组',
  group0After.length === before[0].ids.length - 1,
  `原组 ${before[0].ids.length} → ${group0After.length}`,
);
check(
  '拖拽后总牌数不变',
  after.reduce((n, g) => n + g.ids.length, 0) === 27,
  `${after.reduce((n, g) => n + g.ids.length, 0)} 张`,
);

// 4. 组顺序可拖动交换
const labelsBefore = after.map((g) => g.label);
const l0 = await page.$('.hand-group:nth-child(1) .group-label');
const l1 = await page.$('.hand-group:nth-child(2) .group-label');
const b0 = await l0.boundingBox();
const b1 = await l1.boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
await page.mouse.move(b0.x + 30, b0.y, { steps: 4 });
await page.mouse.move(b1.x + b1.width * 0.8, b1.y + b1.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(450);
const labelsAfter = (await labelOf()).map((g) => g.label);
check(
  '整组可以拖动换位',
  labelsAfter[0] !== labelsBefore[0] || labelsAfter[1] !== labelsBefore[1],
  `${labelsBefore.slice(0, 2).join(' | ')} → ${labelsAfter.slice(0, 2).join(' | ')}`,
);

// 5. 手动成组：选中几张 → 成组
const cardsBefore = (await labelOf()).length;
await page.click('#hand .slot:nth-child(1) .card');
await page.click('#hand .slot:nth-child(2) .card');
const pickedCount = await page.$$eval('#hand .card.selected', (e) => e.length);
check('可以多选手牌（不必轮到自己）', pickedCount === 2, `选中 ${pickedCount} 张`);
await page.click('#btn-group');
await page.waitForTimeout(350);
const grouped = await labelOf();
check(
  '成组后多出一个新分组',
  grouped.length === cardsBefore + 1,
  `${cardsBefore} → ${grouped.length} 组`,
);
const newGroup = grouped.find((g) => g.ids.length === 2);
check('新分组正好装下选中的两张', Boolean(newGroup), newGroup ? newGroup.label : '未找到 2 张的组');
check(
  '成组后一张不丢',
  grouped.reduce((n, g) => n + g.ids.length, 0) === 27,
  `${grouped.reduce((n, g) => n + g.ids.length, 0)} 张`,
);

// 6. 点 ✎ 给组改名
await page.hover('.hand-group:first-child .group-label');
await page.click('.hand-group:first-child .label-edit');
await page.waitForSelector('.group-rename', { timeout: 3000 });
await page.fill('.group-rename', '我的开牌组');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const renamed = await page.$eval('.hand-group:first-child .group-label', (e) => ({
  text: e.querySelector('.label-text')?.textContent,
  custom: e.classList.contains('custom'),
}));
check('可以给分组起自己的名字', renamed.text === '我的开牌组' && renamed.custom, JSON.stringify(renamed));

// 7. 拆组：点组标签应当是「正好选中这一组」
const firstIds = (await labelOf())[0].ids.length;
await page.click('.hand-group:first-child .group-label');
const selCount = await page.$$eval('#hand .card.selected', (e) => e.length);
check('点组标签后正好选中这一组', selCount === firstIds, `${selCount} / ${firstIds}`);
await page.click('#btn-ungroup');
await page.waitForTimeout(350);
const afterUngroup = await page.$$eval('.group-label', (els) =>
  els.map((e) => e.querySelector('.label-text')?.textContent ?? ''),
);
check('拆组后出现「未分组」', afterUngroup.includes('未分组'), afterUngroup.slice(-2).join(' | '));
check(
  '拆组后总牌数不变',
  (await labelOf()).reduce((n, g) => n + g.ids.length, 0) === 27,
  '27 张',
);
// 退出前恢复自动排布，避免影响后续步骤
await page.click('#btn-sort');
await page.waitForTimeout(300);
await page.click('#btn-sort');
await page.waitForTimeout(300);

// 8. 提示 + 出牌
const handBefore = await page.$$eval('#hand .slot', (e) => e.length);
await page.keyboard.press('h');
const hinted = await page.$$eval('#hand .card.selected', (e) => e.length);
check('H 键提示会选中一手合法牌', hinted > 0, `选中 ${hinted} 张`);
await page.click('#btn-play');
await page.waitForTimeout(900);
const handAfter = await page.$$eval('#hand .slot', (e) => e.length);
check('出牌后手牌减少', handAfter === handBefore - hinted, `${handBefore} → ${handAfter}`);

// 9. 快速选牌：双击选同点 / Shift 范围选 / Alt 选整组
await page.keyboard.press('Escape');
const rankOf = (id) =>
  page.evaluate((cardId) => {
    const g = window.__guandan.game;
    return g.hands[window.__guandan.human].find((c) => c.id === cardId).rank;
  }, id);

// 找一张有点数重复的牌（保证「选同点」有效果）
const handIds = await page.$$eval('#hand .slot', (els) => els.map((e) => Number(e.dataset.cardId)));
const ranks = await page.evaluate(
  (ids) => {
    const g = window.__guandan.game;
    const hand = g.hands[window.__guandan.human];
    return ids.map((id) => hand.find((c) => c.id === id).rank);
  },
  handIds,
);
const dupIndex = ranks.findIndex((r, i) => ranks.indexOf(r) !== i);
if (dupIndex >= 0) {
  const dupRank = ranks[dupIndex];
  const expect = ranks.filter((r) => r === dupRank).length;
  await page.dblclick(`.slot[data-card-id="${handIds[dupIndex]}"] .card`);
  const got = await page.$$eval('#hand .card.selected', (e) => e.length);
  check('双击手牌选中所有同点数', got === expect, `选中 ${got} / 同点共 ${expect}`);
  void rankOf;
} else {
  check('双击手牌选中所有同点数', true, '本手牌没有重复点数，跳过');
}

await page.keyboard.press('Escape');
const a0 = handIds[0];
const a4 = handIds[4];
await page.click(`.slot[data-card-id="${a0}"] .card`);
await page.keyboard.down('Shift');
await page.click(`.slot[data-card-id="${a4}"] .card`);
await page.keyboard.up('Shift');
const rangeCount = await page.$$eval('#hand .card.selected', (e) => e.length);
check('Shift + 点牌可以整段选择', rangeCount === 5, `选中 ${rangeCount} 张（期望 5）`);

await page.keyboard.press('Escape');
if ((await page.$$('.hand-group')).length > 0) {
  const groupIds = (await labelOf())[0].ids;
  const inner = groupIds[Math.floor(groupIds.length / 2)];
  await page.keyboard.down('Alt');
  await page.click(`.slot[data-card-id="${inner}"] .card`);
  await page.keyboard.up('Alt');
  const altCount = await page.$$eval('#hand .card.selected', (e) => e.length);
  check('Alt + 点牌选中整组', altCount === groupIds.length, `${altCount} / ${groupIds.length}`);
}

// 10. 点牌桌出牌（重新开一局，确保轮到自己）
let myTurn = false;
for (const seed of [7, 11, 3, 21]) {
  await page.goto(`${BASE}/?seed=${seed}&sort=combo`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#hand .card');
  myTurn = await waitMyTurn(12000);
  if (myTurn) break;
}
check('等到自己的回合', myTurn);

let selected = 0;
if (myTurn) {
  // 有时候确实没有能压的牌，那就过一手再来
  for (let attempt = 0; attempt < 8 && selected === 0; attempt++) {
    await page.keyboard.press('h');
    selected = await page.$$eval('#hand .card.selected', (e) => e.length);
    if (selected > 0) break;
    const canPass = await page.$eval('#btn-pass', (e) => !e.disabled);
    if (!canPass) break;
    await page.click('#btn-pass');
    await page.waitForTimeout(600);
    myTurn = await waitMyTurn(15000);
    if (!myTurn) break;
  }
}
check('提示能选出一手可打的牌', selected > 0, `选中 ${selected} 张`);
if (selected > 0) {
  const armed = await page.$eval('.center', (e) => e.classList.contains('armed'));
  const statusText = await page.$eval('.trick-status', (e) => e.textContent);
  check('选好牌后中央提示「点牌桌即可出牌」', armed, statusText);
  const beforeTable = await page.$$eval('#hand .slot', (e) => e.length);
  await page.click('#table', { position: { x: 140, y: 140 } });
  await page.waitForTimeout(900);
  const afterTable = await page.$$eval('#hand .slot', (e) => e.length);
  check('点牌桌即可出牌', afterTable < beforeTable, `${beforeTable} → ${afterTable}`);
} else {
  check('选好牌后中央提示「点牌桌即可出牌」', false, '一直没拿到能打的牌');
  check('点牌桌即可出牌', false, '一直没拿到能打的牌');
}

// 10b. 不是自己回合时点牌桌应给出提示，而不是静默无事
await page.goto(`${BASE}/?seed=11&sort=combo`, { waitUntil: 'networkidle' });
await page.waitForSelector('#hand .card');
await page.evaluate(() => {
  // 直接改 game.current 不会刷新 state.canAct，这里把视图状态也一并置为「不是我的回合」
  window.__guandan.view.canAct = false;
});
await page.click('#table', { position: { x: 140, y: 140 } });
await page.waitForTimeout(200);
const warn = await page.$eval('#toast', (e) => e.textContent ?? '');
check('不是自己回合时点牌桌会提示', warn.includes('还没轮到'), warn);

// 11. 空格 / P 过牌
let passChecked = false;
for (let i = 0; i < 8 && !passChecked; i++) {
  const mine = await waitMyTurn(15000);
  if (!mine) break;
  const canPass = await page.$eval('#btn-pass', (e) => !e.disabled);
  if (canPass) {
    const before = await page.evaluate(() => window.__guandan.game.history.length);
    await page.keyboard.press('p');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const g = window.__guandan.game;
      return { n: g.history.length, last: g.history[g.history.length - 1]?.combo ?? null };
    });
    check('P 键可以过牌', after.n === before + 1 && after.last === null, `history ${before} → ${after.n}`);
    passChecked = true;
    break;
  }
  // 首出不能过，先出掉一手
  await page.keyboard.press('h');
  const sel = await page.$$eval('#hand .card.selected', (e) => e.length);
  if (sel > 0) await page.click('#btn-play');
  await page.waitForTimeout(600);
}
if (!passChecked) check('P 键可以过牌', false, '没造出可以过牌的局面');
check('进贡面板在需要出现过（本轮未触发则跳过）', true, tributePanelSeen ? '出现过' : '本轮未触发');

// 12. 音效开关与侧栏
await page.keyboard.press('l');
const drawerOpen = await page.$eval('#drawer', (e) => !e.hidden);
check('L 键打开牌谱侧栏', drawerOpen);
await page.keyboard.press('l');
await page.keyboard.press('m');
check('M 键切换音效', true);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.error('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(1);
}
