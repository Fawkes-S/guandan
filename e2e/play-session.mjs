/**
 * 自动化对局：以真人座位连续打若干局，导出完整对局日志用于复盘分析。
 * 用法：node e2e/play-session.mjs [rounds] [difficulty]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5273';
const ROUNDS = Number(process.argv[2] ?? 3);
const DIFFICULTY = process.argv[3] ?? 'normal';

const local = join(process.cwd(), 'node_modules', 'playwright');
const require = createRequire(join(local, 'package.json'));
const { chromium } = existsSync(local)
  ? require(local)
  : require(join(process.env.PW_ROOT ?? '', 'playwright'));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ executablePath: CHROME }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const shots = [];
async function shot(name) {
  mkdirSync('e2e/out', { recursive: true });
  const p = `e2e/out/${name}.png`;
  await page.screenshot({ path: p });
  shots.push(p);
}

await page.goto(`${BASE}/?seed=2024`, { waitUntil: 'networkidle' });
await page.waitForSelector('#hand .card', { timeout: 15000 });
await page.selectOption('#difficulty', DIFFICULTY);

const state = () =>
  page.evaluate(() => {
    const g = window.__guandan.game;
    return {
      phase: g.phase,
      round: g.round,
      level: g.level,
      levels: [...g.levels],
      current: g.current,
      hands: g.hands.map((h) => h.length),
      target: g.lastPlay ? { p: g.lastPlay.player, t: g.lastPlay.combo.label, n: g.lastPlay.combo.cards.length } : null,
      history: g.history.map((h) => ({ p: h.player, combo: h.combo?.label ?? null, n: h.cards.length, ids: h.cards.map((c) => c.id) })),
      finishOrder: [...g.finishOrder],
      playedCount: g.playedPool.length,
    };
  });

const rounds = [];
for (let r = 0; r < ROUNDS; r++) {
  const t0 = Date.now();
  let actions = 0;
  const start = await state();
  if (r === 0) await shot('01-dealt');
  let shotDone = { mid: false, tribute: false };

  for (let guard = 0; guard < 900; guard++) {
    const s = await state();
    if (s.phase === 'roundEnd' || s.phase === 'matchEnd') break;
    if (s.phase === 'returnTribute') {
      if (!shotDone.tribute) {
        await shot('03-tribute');
        shotDone.tribute = true;
      }
      const btn = await page.$('#btn-play');
      const disabled = await btn.evaluate((e) => e.disabled);
      if (disabled) {
        // 选第一张可还贡的牌
        await page.click('#hand .card:not(.dim)');
      }
      await page.click('#btn-play');
      actions++;
      continue;
    }
    const isMine = await page.evaluate(() => window.__guandan.game.current === window.__guandan.human);
    if (isMine) {
      if (!shotDone.mid && actions > 24) {
        await shot('02-midgame');
        shotDone.mid = true;
      }
      await page.keyboard.press('h');
      const selected = await page.$$eval('#hand .card.selected', (e) => e.length);
      if (selected === 0) {
        await page.click('#btn-pass');
      } else {
        await page.click('#btn-play');
        const choice = await page.$('#choice-list .choice');
        if (choice) await choice.click();
      }
      actions++;
    } else {
      await page.waitForTimeout(90);
    }
  }

  // 等结算弹层
  await page.waitForTimeout(1200);
  const s2 = await state();
  if (r === 0) await shot('04-roundend');
  rounds.push({
    round: start.round,
    seconds: Math.round((Date.now() - t0) / 1000),
    humanActions: actions,
    finishOrder: s2.finishOrder,
    levelsBefore: start.levels,
    levelsAfter: s2.levels,
    level: start.level,
    totalPlays: s2.history.filter((h) => h.combo).length,
    totalPasses: s2.history.filter((h) => !h.combo).length,
    bombs: s2.history.filter((h) => h.combo && /炸弹|天王|同花顺/.test(h.combo)).length,
    history: s2.history,
    endHands: s2.hands,
  });

  // 下一局
  const next = await page.$('#modal-next');
  if (next) {
    await next.click();
    await page.waitForTimeout(1600);
  } else break;
}

mkdirSync('e2e/out', { recursive: true });
writeFileSync('e2e/out/session.json', JSON.stringify({ rounds, shots }, null, 2));
console.log(JSON.stringify(rounds.map(({ history, ...rest }) => rest), null, 2));
console.log('\n详情已写入 e2e/out/session.json');
await browser.close();
