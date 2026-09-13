/**
 * 打包「单文件版」：产出一个可以直接双击打开的 html，外加一份说明。
 *
 *   node scripts/build-single.mjs   （或 npm run build:single）
 *
 * 产物在 release/：
 *   index.html        单文件游戏本体（JS/CSS/图标全部内联）
 *   掼蛋.html          同一个文件的友好名字，方便直接发微信 / 拷 U 盘
 *   玩法说明.txt       给收到文件的人看的三行说明
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const release = join(root, 'release');

console.log('▶ 构建单文件版…');
execFileSync('npx', ['vite', 'build', '--config', 'vite.config.single.ts'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
});

// 单文件版不需要这些散落的静态资源
for (const f of readdirSync(release)) {
  if (f !== 'index.html') rmSync(join(release, f), { recursive: true, force: true });
}

const html = join(release, 'index.html');
copyFileSync(html, join(release, '掼蛋.html'));

writeFileSync(
  join(release, '玩法说明.txt'),
  `掼蛋 · 水墨（单文件版）

怎么玩
  1. 双击「掼蛋.html」，等浏览器打开就行 —— 不用装任何东西，断网也能玩。
  2. 手机上：把「掼蛋.html」发到微信 / QQ / 邮件里，点开选择用浏览器打开。
  3. 想发给别人：直接发这一个文件即可，它就是整个游戏。

玩法提要
  · 你坐下方，对家是队友，逆时针出牌。
  · 点手牌选中 → 点牌桌出牌；空格 = 不要；H = 提示；L = 牌谱侧栏。
  · 双击一张牌 = 选中所有同点数；Shift + 点 = 整段选；Alt + 点 = 选中整组。
  · 「理牌」切到「按牌型」会把牌拆成顺子 / 三带二 / 炸弹等区块，可以随意拖动重排。

完整规则见项目里的 docs/RULES.md。
`,
  'utf8',
);

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
console.log('✅ 完成：');
console.log(`   release/index.html    ${kb(html)}`);
console.log(`   release/掼蛋.html      ${kb(join(release, '掼蛋.html'))}`);
console.log('   双击 release/掼蛋.html 即可开玩（无需 Node、无需联网）');
