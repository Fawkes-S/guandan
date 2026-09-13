# 放到 GitHub 上：保存 · 管理 · 测试 · 发布 · 一个网址到处玩

**可以，而且这是最适合你的方案。** 一次配置好之后：

| 你想要的 | GitHub 给的 |
|---|---|
| **保存** | 代码 + 每次改动的完整历史，换电脑 `git clone` 就全回来 |
| **管理** | Issues 记待办、Projects 看板、Releases 发版本 |
| **测试** | 每次推送自动跑 136 个测试，跑挂了会发邮件告诉你 |
| **发布** | 自动构建并发布到 GitHub Pages，得到一个 HTTPS 网址 |
| **到处玩** | 手机 / 平板 / 别人的电脑，浏览器打开那个网址就能玩，还能装成 App |

最终你会拿到一个这样的地址：

```
https://<你的用户名>.github.io/guandan/
```

---

## 准备工作

- 一个 GitHub 账号（免费）
- **仓库要设为 Public** —— 免费账号的 GitHub Pages 只对公开仓库开放
  （私有仓库要用 Pages 需要 GitHub Pro）

本地仓库**已经建好了**，第一条提交也完成了。你只差"推到 GitHub"这一步。

---

## 路线 A：网页操作（不需要装任何东西，推荐）

### 第 1 步：在 GitHub 上建一个空仓库

1. 打开 <https://github.com/new>
2. **Repository name** 填 `guandan`
3. 选 **Public**
4. ⚠️ **不要**勾 "Add a README file"、不要选 .gitignore、不要选 license
   （仓库必须是空的，否则推送会冲突）
5. 点 **Create repository**

### 第 2 步：推送（在 `guandan/` 目录下执行）

GitHub 建完仓库后会显示一段命令，用这两条即可：

```bash
cd /Users/zzymima0000/Developer/dsh/guandan
git remote add origin https://github.com/<你的用户名>/guandan.git
git push -u origin main
```

> 第一次推送会让你登录。推荐用 **Personal Access Token** 当密码：
> GitHub → 头像 → Settings → Developer settings → Personal access tokens →
> Tokens (classic) → Generate new token → 勾 `repo` → 复制那串字符当密码用。
> 或者装个 `gh` 走浏览器登录（见路线 B）。

### 第 3 步：打开 Pages

1. 仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选 **GitHub Actions**
3. 完事。之后每次 `git push`，Actions 会自动跑测试 → 构建 → 发布

### 第 4 步：等一两分钟，拿到网址

仓库页面 → **Actions** 标签能看到构建进度。第一次大约 1–2 分钟。
变绿之后，网址就是：

```
https://<你的用户名>.github.io/guandan/
```

手机浏览器打开，菜单里「添加到主屏幕」，就变成一个全屏 App（HTTPS + Service Worker，
装完之后**飞行模式也能玩**）。

---

## 路线 B：命令行（装了 `gh` 之后一条命令搞定）

```bash
brew install gh          # 安装 GitHub CLI
gh auth login            # 按提示走浏览器登录，选 HTTPS
cd /Users/zzymima0000/Developer/dsh/guandan
gh repo create guandan --public --source=. --push
```

然后同样去 **Settings → Pages → Source 选 GitHub Actions**。

---

## 以后怎么更新

改完代码：

```bash
cd /Users/zzymima0000/Developer/dsh/guandan
npm test                 # 本地先跑一遍（可选，CI 也会跑）
git add -A
git commit -m "调整了 xxx"
git push
```

推送后 GitHub 会**自动**跑测试和构建，几十秒后网址上的内容就更新了。
如果测试挂了，Actions 页面会显示红色 ✗，Pages 不会更新（旧版本继续在线）。

---

## 这个仓库里已经为你配好的东西

| 文件 | 作用 |
|---|---|
| `.github/workflows/deploy-pages.yml` | 推送即测试 + 构建 + 发布 Pages |
| `.gitignore` | 已排除 `node_modules/`（155 MB）、`.npm-cache/`（232 MB）、`dist/`、`release/` |
| `vite.config.ts` 里的 `base: './'` | **关键**：所有资源用相对路径，所以子路径 `/<仓库名>/` 下也能正常工作 |

工作流跑的就是你本地验证过的三条命令：

```yaml
- run: npm ci      # 按 lock 文件精确安装
- run: npm test    # 136 个单元/集成测试
- run: npm run build   # 产出 dist/
```

> 注意：真实浏览器 E2E（`npm run e2e`）需要 Playwright 和系统 Chrome，
> 没有放进 CI —— 它在本地跑就够了。

---

## 我已经本地验证过的（你可以放心）

在干净克隆里完整模拟了一遍 CI：

```
npm ci        → 408 个包装好
npm test      → 10 个文件 / 136 个测试全过
npm run build → PWA 构建成功，dist/ 13 项预缓存
```

并且把 `dist/` 挂在**子路径**下（模拟 `https://user.github.io/guandan/`）实测：

```
手牌张数：27          页面标题：掼蛋 · 水墨
manifest.webmanifest → 200      sw.js → 200
Service Worker：{"scope":".../guandan/","active":true}   页面错误：无
```

也就是说：**子路径部署、PWA 安装、离线缓存，全都是通的。**

---

## 常见问题

**Q：网址上的版本我更新了代码但没变？**
等 Actions 跑完（Actions 页签变绿），然后手机上下拉刷新；PWA 有缓存，可能要
清一下站点数据或重开一次。

**Q：一定要 Public 吗？**
免费账号是。私有仓库 + Pages 需要 Pro。如果不想公开代码，就用 `npm run share`
（局域网）或把 `release/掼蛋.html` 直接发人。

**Q：仓库名可以不叫 guandan 吗？**
可以，网址会跟着变成 `https://<用户名>.github.io/<仓库名>/`，相对路径下都能跑。

**Q：构建设置在哪改？**
`.github/workflows/deploy-pages.yml`。比如想跳过测试直接发布，删掉 `run: npm test` 那行。
