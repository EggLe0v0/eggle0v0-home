// ============================================================
// 站点配置：改这个文件就能改页面内容和两个子域名
// 浏览器和 Cloudflare Worker 共用这一份配置
// ============================================================

export const SITE = {
  title: 'eggle0v0',
  eyebrow: 'PERSONAL GATEWAY',
  tagline: "Lok's personal website",
  // 自动检测间隔（毫秒）
  refreshMs: 60_000,
};

export const LINKS = [
  {
    id: 'blog',
    name: 'Blog',
    // ↓↓↓ 换成你的第一个子域名 ↓↓↓
    url: 'https://blog.eggle0v0.org',
    desc: '随缘更新',
    glyph: 'B',
    accent: '#7c8cff',
  },
  {
    id: 'DSH',
    name: 'DSH',
    // ↓↓↓ 换成你的第二个子域名 ↓↓↓
    url: 'https://dsh.eggle0v0.org',
    desc: '大肥鱼',
    glyph: 'D',
    accent: '#35d6b8',
    // 这个子域在 Cloudflare Access 后面，探测需要走服务令牌
    access: true,
    // DSH 前面还有一层 Caddy Basic Auth，需要带 remember Cookie 才能看到后端
    probeCookie: true,
  },
];
