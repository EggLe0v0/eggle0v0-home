import { LINKS } from '../public/assets/sites.js';

// 单次探测超时时间（毫秒）
const TIMEOUT_MS = 6_000;

/**
 * 探测一个子站点。
 *
 * 判定规则：
 * - HTTP 状态码 < 400 算在线；
 * - 401/403 说明服务活着、只是要登录，也算在线；
 * - 其余（404/5xx、超时、DNS 失败）算离线。
 *
 * Cloudflare Access 保护的站点比较特殊：未授权时 Access 会在请求到达源站前
 * 就返回 302 跳到登录页。这里不跟随跳转，识别出 Access 登录地址后直接判离线，
 * 避免把“登录页 200”误当成服务在线。
 * 如果配置了 Access 服务令牌（Worker 环境变量 CF_ACCESS_CLIENT_ID/SECRET），
 * 探测会带上令牌穿过 Access，拿到源站真实的响应。
 */
async function probe(site, env) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = {
    'user-agent': 'eggle0v0-status/1.0 (+https://eggle0v0.org)',
    'cache-control': 'no-cache',
  };

  const hasAccessToken = Boolean(env?.CF_ACCESS_CLIENT_ID && env?.CF_ACCESS_CLIENT_SECRET);
  if (site.access && hasAccessToken) {
    headers['cf-access-client-id'] = env.CF_ACCESS_CLIENT_ID;
    headers['cf-access-client-secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }

  // DSH 前面有一层 Caddy 做 Basic Auth，不带凭据时请求会被 Caddy 拦住，
  // 永远看不到后端死活。带上 Caddy 的 remember Cookie 可以让它直接转发。
  const hasProbeCookie = Boolean(site.probeCookie && env?.DSH_PROBE_COOKIE);
  if (hasProbeCookie) {
    headers.cookie = env.DSH_PROBE_COOKIE;
  }

  try {
    const target = site.probePath ? new URL(site.probePath, site.url).toString() : site.url;
    const response = await fetch(target, {
      method: 'GET',
      // 不跟随跳转：Access 的登录跳转要单独识别，不能拿登录页当源站
      redirect: 'manual',
      headers,
      signal: controller.signal,
    });

    const status = Number(response.status) || 0;
    const location = response.headers.get('location') || '';
    const blockedByAccess =
      status >= 300 && status < 400 && location.includes('cloudflareaccess.com');

    // Access 在 strict 模式下拒绝令牌时返回 401/403，并带有 cf-access-* 头；
    // 源站自己的 401 不会有这些头，需要区分开，否则会误判为在线。
    const accessRejected =
      (status === 401 || status === 403) &&
      (response.headers.has('cf-access-domain') || response.headers.has('cf-access-aud'));

    // 被 Caddy 的 Basic Auth 拦住：请求根本没到 DSH，不能算在线。
    const basicChallenge = /^Basic\b/i.test(response.headers.get('www-authenticate') || '');
    const probeBlocked = Boolean(site.probeCookie) && basicChallenge;

    // 只要状态码，不需要页面内容
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        /* 忽略取消失败 */
      }
    }

    if (blockedByAccess || accessRejected || probeBlocked) {
      let error = null;
      if (blockedByAccess || accessRejected) {
        error = hasAccessToken ? 'access-denied' : 'access-token-missing';
      } else {
        error = hasProbeCookie ? 'probe-blocked' : 'probe-cookie-missing';
      }

      return {
        id: site.id,
        ok: false,
        status,
        ms: Date.now() - startedAt,
        error,
      };
    }

    // DSH 的 Host 白名单：不带 --trusted-host 启动时，公网 Host 会在 /api 上返回 403。
    // 放行之后，普通 GET（非 WebSocket）访问这个路径会得到 404/401，都算正常在线。
    if (site.probePath) {
      if (status === 403) {
        return {
          id: site.id,
          ok: false,
          restricted: true,
          status,
          ms: Date.now() - startedAt,
          error: 'restricted',
        };
      }

      return {
        id: site.id,
        ok: status > 0 && status < 500,
        status,
        ms: Date.now() - startedAt,
        error: null,
      };
    }

    return {
      id: site.id,
      ok: status > 0 && (status < 400 || status === 401 || status === 403),
      status,
      ms: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      id: site.id,
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: error?.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleStatus(env) {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(LINKS.map((site) => probe(site, env)));

  return new Response(JSON.stringify({ checkedAt, results }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/status') {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { allow: 'GET' },
        });
      }
      return handleStatus(env);
    }

    return env.ASSETS.fetch(request);
  },
};
