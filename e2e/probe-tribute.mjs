import { createRequire } from 'node:module';
import { join } from 'node:path';
const local = join(process.cwd(), 'node_modules', 'playwright');
const require = createRequire(join(local, 'package.json'));
const { chromium } = require(local);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ executablePath: CHROME }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5273/?seed=11', { waitUntil: 'networkidle' });
await page.waitForSelector('#hand .card');
await page.selectOption('#speed', '220');

const snap = () =>
  page.evaluate(() => {
    const a = window.__guandan;
    const g = a.game;
    return {
      round: g.round,
      phase: g.phase,
      prev: [...g.prevFinishOrder],
      tributes: g.tributes.map((t) => `${t.from}->${t.to}`),
      pending: g.pending.map((p) => p.player),
      hand: g.hands[a.human].length,
    };
  });

console.log('开局：', JSON.stringify(await snap()));

for (let round = 0; round < 3; round++) {
  // 打完这一局
  for (let i = 0; i < 4000; i++) {
    const s = await snap();
    if (s.phase === 'roundEnd' || s.phase === 'matchEnd') break;
    if (s.phase === 'returnTribute') {
      if (s.pending.includes(0)) {
        console.log(`  [第${s.round}局] 轮到我（头游）还贡，待还 ${s.pending}`);
        const btnDisabled = await page.$eval('#btn-play', (e) => e.disabled);
        if (btnDisabled) await page.click('#hand .card:not(.dim)');
        await page.click('#btn-play');
        const after = await snap();
        console.log(`  [第${s.round}局] 还贡完成 → phase=${after.phase}`);
      } else {
        await page.waitForTimeout(150);
      }
      continue;
    }
    const mine = await page.evaluate(
      () => window.__guandan.game.current === window.__guandan.human,
    );
    if (mine) {
      await page.keyboard.press('h');
      const sel = await page.$$eval('#hand .card.selected', (e) => e.length);
      if (sel === 0) await page.click('#btn-pass');
      else await page.click('#btn-play');
    } else {
      await page.waitForTimeout(90);
    }
  }
  await page.waitForTimeout(1000);
  const s = await snap();
  console.log(`第 ${s.round} 局结束：phase=${s.phase}`);
  const next = await page.$('#modal-next');
  if (!next) break;
  await next.click();
  await page.waitForTimeout(1200);
  const s2 = await snap();
  console.log(`  → 新一局开局：round=${s2.round} phase=${s2.phase} 上局名次=${JSON.stringify(s2.prev)}`);
  console.log(`  → 进贡记录=${JSON.stringify(s2.tributes)} 待还贡=${JSON.stringify(s2.pending)}`);
  if (s2.phase === 'playing') {
    console.log('  → !! 直接进入出牌阶段，没有进贡');
  }
}
await browser.close();
