# 把游戏带走 / 分享给别人

三种方式，按「方便程度」从高到低排。**玩法本身完全一样**，区别只在于对方怎么拿到它。

---

## 方式一：一个文件，双击就玩（最省事）

```bash
npm run build:single
```

产物在 `release/`：

| 文件 | 说明 |
|---|---|
| `掼蛋.html` | **整个游戏就这一个文件**，122 KB |
| `index.html` | 同上（换个名字，某些场景更好用） |
| `掼蛋单机版.zip` | 上面那个文件 + 玩法说明，38 KB，适合直接发人 |
| `玩法说明.txt` | 给收到文件的人看的三行说明 |

**怎么用**

- **自己换电脑玩**：把 `掼蛋.html` 拷到 U 盘 / 网盘，在新电脑上**双击**即可。
  不需要装 Node、不需要联网、不需要服务器 —— 双击就用默认浏览器打开开玩。
- **发给别人**：微信 / QQ / 邮件直接发 `掼蛋单机版.zip`（或那个 html）。
  对方解压后双击，或者手机上点开选择「用浏览器打开」。
- **手机上玩**：微信里点开 html 文件 → 右上角「⋯」→「在浏览器打开」。
  iOS 也可以用「文件」App 点开，或用 Safari 打开分享链接。

> 为什么能双击就用：单文件版把 JS、CSS、图标全部内联进了一个 html，
> 没有任何外部请求，所以 `file://` 协议下也能跑。
> 代价是没有 Service Worker（`file://` 下浏览器不允许注册），
> 也就是**没有 PWA 的离线缓存和安装图标** —— 但它本来就是本地文件，天然离线。

---

## 方式二：同一 Wi-Fi 下手机扫码玩（体验最好）

```bash
npm run share
```

终端会打印：

```
掼蛋 · 水墨 —— 已开始分享
  本机：        http://localhost:4173
  同一 Wi-Fi：  http://192.168.3.168:4173
  手机扫码直接开玩：
  ██▀▀▀▀▀▀▀█ ... （二维码）
```

手机连**同一个 Wi-Fi**，扫码就能玩。`Ctrl+C` 结束分享。

- **电脑和手机都要开着**，电脑关了就不能玩了。
- 想换端口：`PORT=8080 npm run share`。
- 手机浏览器菜单里选「添加到主屏幕」，以后能像 App 一样从桌面点开。
- ⚠️ 这种方式走的是普通 HTTP，浏览器**不会**注册 Service Worker
  （Service Worker 要求 HTTPS 或 localhost），所以「添加到主屏幕」得到的是
  一个快捷方式，而不是完整的可离线 PWA。想要完整 PWA 用方式三。

---

## 方式三：部署到网上，谁都能开（HTTPS + 完整 PWA）

`npm run build` 产出的 `dist/` 是一个标准静态站点，**并且用的是相对路径**
（`base: './'`），所以放在任何子目录下都能正常工作。挑一个：

### 3.1 Netlify Drop（最快，不用命令行）

1. `npm run build`
2. 打开 <https://app.netlify.com/drop>
3. 把 **`dist` 整个文件夹拖进去**
4. 立刻得到一个 `https://xxx.netlify.app` 链接，发给谁都能开

登录后可以改名、绑定自己的域名。这是 HTTPS，所以**手机上能真正装成 PWA**：
Android Chrome 会弹出「安装应用」，iOS Safari「添加到主屏幕」后是全屏无地址栏的独立 App，
且装过之后**飞行模式也能玩**（Service Worker 已经缓存了全部资源）。

### 3.2 Vercel

```bash
npm i -g vercel
npm run build
vercel deploy --prod dist
```

### 3.3 GitHub Pages（仓库里已备好工作流）

把项目推到 GitHub，然后在仓库 **Settings → Pages → Source** 选 **GitHub Actions**，
之后每次推 `main` 分支都会自动构建并发布。工作流文件：
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)

访问地址形如 `https://<用户名>.github.io/<仓库名>/` —— 因为用的是相对路径，子目录下也能正常跑。

### 3.4 Cloudflare Pages

在 Cloudflare Pages 里连上仓库，构建命令 `npm run build`，输出目录 `dist`。

---

## 到底该选哪个？

| 你想要 | 用哪个 |
|---|---|
| 换台电脑自己玩 | **方式一**，拷 `掼蛋.html` 双击 |
| 发给一个朋友，他也想离线玩 | **方式一**，发 `掼蛋单机版.zip` |
| 几个人在同一间屋里，各自用手机玩 | **方式二**，`npm run share` 扫码 |
| 发给很多人 / 想装成手机 App / 想随时打开 | **方式三**，Netlify Drop 拖一下 |

---

## 复制文件夹到别的电脑：哪些要带、哪些别带

`guandan/` **就是整个项目**，没有别的地方藏东西。但里面有两坨是开发用的，可以不拷：

| 目录 | 大小 | 要不要拷 |
|---|---|---|
| `node_modules/` | ~155 MB | ❌ 别拷，新电脑上 `npm install` 会重建 |
| `.npm-cache/` | ~232 MB | ❌ 别拷，这是本机 npm 缓存 |
| `dist/` | 192 KB | ✅ 想直接发布就带 |
| `release/` | 292 KB | ✅ 只想玩就带这个 |
| `src/` `docs/` `e2e/` `scripts/` `public/` | ~1.5 MB | ✅ 源码与文档 |
| `package.json` `tsconfig.json` `vite.config*.ts` `index.html` | 很小 | ✅ 要改代码就得带 |

**只想玩**：拷 `release/掼蛋.html` 一个文件就够了。
**想继续改代码**：拷整个 `guandan/`（可以先删掉 `node_modules/` 和 `.npm-cache/`），
在新电脑上装好 Node 18+，然后：

```bash
cd guandan
npm install          # 装依赖（若报 npm 缓存权限错误：npm install --cache ./.npm-cache）
npm run dev          # 开发模式，改代码即时热更新
npm test             # 跑 136 个测试
npm run build        # 产出可部署的 dist/
npm run build:single # 产出单文件版 release/
npm run share        # 局域网分享
```
