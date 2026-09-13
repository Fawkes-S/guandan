/** 把单文件版打成一个 zip，方便直接发给别人。（需要系统里有 zip 命令） */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const release = join(process.cwd(), 'release');
const zip = join(release, '掼蛋单机版.zip');
if (!existsSync(join(release, '掼蛋.html'))) {
  console.error('请先运行 npm run build:single');
  process.exit(1);
}
rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-q', '-j', zip, '掼蛋.html', '玩法说明.txt'], { cwd: release });
  console.log(`✅ 已打包：release/掼蛋单机版.zip（${(statSync(zip).size / 1024).toFixed(0)} KB）`);
} catch {
  console.log('系统里没有 zip 命令，跳过打包 —— 直接发 release/掼蛋.html 也一样。');
}
