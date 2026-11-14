- 注：均由deepseek进行编写

# eggle0v0 · 个人入口

一个纯静态主页：极光背景 + 两个子域入口 + 绿/红在线状态。

托管在 **Cloudflare Workers**（静态资源 + 一个 Worker 入口），状态检测在 Cloudflare 边缘完成——不需要服务器，也不需要自己维护任何进程。

## 目录结构

```
public/                  静态资源，原样发布
  index.html             页面骨架
  assets/style.css       样式（背景、卡片、状态颜色）
  assets/app.js          渲染、请求状态、自动刷新
  assets/sites.js        ★ 站点配置：标题和两个子域 URL
src/index.js             Worker 入口：/api/status + 静态资源兜底
wrangler.jsonc           Worker 配置
```

## 部署（Workers Builds，已连接 Git）

1. 代码推到 GitHub 仓库，Cloudflare 的 Worker 项目会自动构建。
2. 构建命令就是 `npx wrangler deploy`，仓库根目录有 `wrangler.jsonc` 就能直接识别：
   - `main` 指向 `src/index.js`
   - `assets.directory` 指向 `./public`
3. 每次 push 到 `main` 自动重新部署。
4. 首次部署完成后，去 Worker → **Settings → Domains & Routes** → **Add** → **Custom domain**，绑定 `eggle0v0.org`。

> 不要用 `wrangler pages deploy`，这个项目已经改成 Workers 结构，`functions/` 目录不再是入口。

## 状态是怎么判断的

- 前端每 60 秒请求一次同源的 `/api/status`（页面切到后台时暂停，切回来立即重测）。
- Worker 在 Cloudflare 边缘并发请求两个子域，单次 6 秒超时。
- **HTTP 状态码 < 400 → 绿色「在线」。**
- **401 / 403 也算绿色**：服务活着，只是需要登录。
- **≥ 400 的其他状态（404、5xx）、超时、DNS 失败 → 红色「离线」。**
- **Cloudflare Access 保护**：未授权时 Access 会在到达源站前先返回登录跳转。探测不跟随这个跳转，而是直接判为离线（「缺少 Access 令牌」或「Access 拒绝」），避免把登录页的 200 当成服务在线。要探测源站真实状态，按下面的服务令牌配置。
- 状态接口本身不可用时，两张卡片显示红色「检测失败」，页脚提示接口异常，方便排查。

## 受 Cloudflare Access 保护的子域（DSH）

Access 会先于源站拦截请求，所以默认探测无法判断 DSH 是否真的在运行。给 Worker 配一个服务令牌就能穿过 Access：

1. Zero Trust → **Access → Service authentication → Service tokens → Create service token**
   - 名称：`status-probe`，期限按需
   - 创建后复制 **Client ID** 和 **Client Secret**（Secret 只显示一次）
2. Zero Trust → **Access → Applications** → 选中 `dsh.eggle0v0.org` 的应用 → **Policies**
   - **Add a policy**：Action 选 **Service Auth**，Include 选 **Service Token** → `status-probe`
   - 保存
3. Worker → **Settings → Variables and Secrets**，添加：
   - `CF_ACCESS_CLIENT_ID` = Client ID
   - `CF_ACCESS_CLIENT_SECRET` = Client Secret（设为 Secret）
4. 保存并重新部署后，探测会带着令牌请求源站：源站正常 → 绿色；源站或隧道挂了 → 502/1030 → 红色。

`public/assets/sites.js` 里 DSH 条目的 `access: true` 就是“这个站点要带令牌探测”的标记。

## 换背景

默认是 CSS 画的极光渐变，不依赖任何图片。想换成照片：

1. 把图片放到 `public/assets/bg.jpg`；
2. 打开 `public/assets/style.css`，把顶部
   ```css
   --bg-image: none;
   ```
   改成
   ```css
   --bg-image: url("bg.jpg");
   ```
3. 用 `--bg-image-opacity` 调明暗（默认 `0.5`），文字对比度不够就调低。

## 本地预览

```bash
npx wrangler dev
```

会同时跑静态资源和 `/api/status`，和线上行为一致。默认地址 `http://127.0.0.1:8787`。

## 常见问题

- **一直红色**：先 `curl -I https://你的子域`，确认不是 404/502、证书错误或 DNS 未生效。
- **`/api/status` 404**：确认 `src/index.js` 是 Worker 入口、`wrangler.jsonc` 里的 `main` 没写错，并且部署的是最新提交。
- **改了不生效**：需要一次新的部署；浏览器端强制刷新（Ctrl+F5）。
- **免费额度**：Workers 免费版每天 10 万次请求，个人站远远用不完。
