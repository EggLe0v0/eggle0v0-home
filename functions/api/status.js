import { LINKS } from '../../assets/sites.js';

// 单次探测超时时间（毫秒）
const TIMEOUT_MS = 6_000;

/**
 * 探测一个子站点。
 * 判定规则很简单：HTTP 状态码 < 400 算在线，其余（含超时、DNS 失败）算离线。
 */
async function probe(site) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'eggle0v0-status/1.0 (+https://eggle0v0.org)',
        'cache-control': 'no-cache',
      },
      signal: controller.signal,
    });

    const status = Number(response.status) || 0;

    // 只要状态码，不需要页面内容
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        /* 忽略取消失败 */
      }
    }

    return {
      id: site.id,
      ok: status > 0 && status < 400,
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

export async function onRequestGet() {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(LINKS.map(probe));

  return new Response(JSON.stringify({ checkedAt, results }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
