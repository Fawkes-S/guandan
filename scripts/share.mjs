/**
 * 局域网分享：起一个静态服务器，把手机扫码就能玩的地址和二维码打到终端。
 *
 *   node scripts/share.mjs        （或 npm run share）
 *
 * 手机和电脑连同一个 Wi-Fi，扫二维码即可开玩。Ctrl+C 结束。
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';

const root = process.cwd();
const dir = existsSync(join(root, 'dist')) ? join(root, 'dist') : join(root, 'release');
if (!existsSync(join(dir, 'index.html'))) {
  console.error('找不到构建产物，请先运行：npm run build（或 npm run build:single）');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(dir, url === '/' ? 'index.html' : url));
  if (!file.startsWith(dir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const PORT = Number(process.env.PORT ?? 4173);
const lan =
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

server.listen(PORT, '0.0.0.0', () => {
  const url = `http://${lan}:${PORT}`;
  console.log('\n掼蛋 · 水墨 —— 已开始分享\n');
  console.log(`  本机：        http://localhost:${PORT}`);
  console.log(`  同一 Wi-Fi：  ${url}\n`);
  console.log('  手机扫码直接开玩：\n');
  qrcode.generate(url, { small: true });
  console.log('\n  提示：手机浏览器菜单里「添加到主屏幕」就能像 App 一样打开。');
  console.log('        想要真正离线可用，把 release/掼蛋.html 直接发给对方更省事。');
  console.log('\n  Ctrl+C 结束分享。\n');
});

process.on('SIGINT', () => {
  server.close();
  console.log('\n已停止分享。');
  process.exit(0);
});
