- 注：均由deepseek进行编写

# eggle0v0 · 个人入口

一个纯静态主页：极光背景 + 两个子域入口 + 绿/红在线状态。

托管在 **Cloudflare Pages**，状态检测由同项目的 **Pages Functions** 在边缘完成——不需要服务器，也不需要自己维护任何进程。

## 目录结构

```
index.html                页面骨架
assets/style.css          样式（背景、卡片、状态颜色）
assets/app.js             渲染、请求状态、自动刷新
assets/sites.js           ★ 站点配置：标题和两个子域 URL
functions/api/status.js   /api/status 状态接口
```

## 部署

1. 把整个目录推到 GitHub 仓库。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选中该仓库。
3. 构建配置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：`/`
4. 部署完成后先访问 `xxx.pages.dev` 确认页面正常。
5. **Custom domains** 里绑定 `eggle0v0.org`（域名已托管在 Cloudflare 时会自动加记录）。
6. 打开 `assets/sites.js`，把两个 `url` 改成实际子域，提交后自动重新部署。

## 状态是怎么判断的

- 前端每 60 秒请求一次同源的 `/api/status`（页面切到后台时暂停，切回来立即重测）。
- 函数在 Cloudflare 边缘并发请求两个子域，单次 6 秒超时。
- **HTTP 状态码 < 400 → 绿色「在线」；≥ 400、超时、DNS 失败 → 红色「离线」。**
- 返回 401/403（登录保护）也会显示红色。如果希望「能连上就算在线」，把 `functions/api/status.js` 里的 `< 400` 改成 `< 500`。
- 状态接口本身不可用时，两张卡片显示红色「检测失败」，页脚提示接口异常，方便排查。

## 换背景

默认是 CSS 画的极光渐变，不依赖任何图片。想换成照片：

1. 把图片放到 `assets/bg.jpg`；
2. 打开 `assets/style.css`，把顶部
   ```css
   --bg-image: none;
   ```
   改成
   ```css
   --bg-image: url("bg.jpg");
   ```
3. 用 `--bg-image-opacity` 调明暗（默认 `0.5`），文字对比度不够就调低。

## 本地预览

完整预览（含状态接口）：

```bash
npx wrangler pages dev . --port 8788
```

只看页面、不跑函数：

```bash
python3 -m http.server 8080
```

后者访问 `/api/status` 会 404，卡片会显示「检测失败」，属于正常现象。

## 常见问题

- **一直红色**：先 `curl -I https://你的子域`，确认不是 401/403、证书错误或 DNS 未生效。
- **`/api/status` 404**：确认文件路径正好是 `functions/api/status.js`，并且 Pages 项目已重新部署。
- **改了不生效**：Pages 需要一次新部署；浏览器端强制刷新（Ctrl+F5）。
- **免费额度**：Functions 每天 10 万次请求、Pages 每月 500 次构建，个人站远远用不完。
