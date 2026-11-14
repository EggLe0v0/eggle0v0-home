import { SITE, LINKS } from './sites.js';

const API_URL = '/api/status';
const REFRESH_MS = Number(SITE.refreshMs) > 1000 ? Number(SITE.refreshMs) : 60_000;
const API_TIMEOUT_MS = 9_000;

const els = {
  links: document.getElementById('links'),
  wordmark: document.getElementById('wordmark'),
  eyebrow: document.getElementById('eyebrow'),
  tagline: document.getElementById('tagline'),
  lastCheck: document.getElementById('last-check'),
  mode: document.getElementById('mode-label'),
  refresh: document.getElementById('refresh'),
  announcer: document.getElementById('announcer'),
};

const cards = new Map();
const previousStates = new Map();
let busy = false;
let timerId = 0;

/* ---------- 工具 ---------- */

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);

const accentOf = (site) =>
  /^#[0-9a-f]{3,8}$/i.test(site.accent ?? '') ? site.accent : '#7c8cff';

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  return Number.isNaN(date.getTime()) ? '刚刚' : timeFormatter.format(date);
}

/* ---------- 渲染 ---------- */

function render() {
  document.title = SITE.title;
  els.wordmark.textContent = SITE.title;
  els.eyebrow.textContent = SITE.eyebrow;
  els.tagline.textContent = SITE.tagline;

  els.links.innerHTML = LINKS.map((site, index) => {
    const accent = accentOf(site);
    const glyph = escapeHtml(site.glyph || String(site.name).slice(0, 1));
    return `
      <a class="card" href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer"
         data-id="${escapeHtml(site.id)}" style="--accent: ${accent}; --i: ${index}">
        <div class="card__head">
          <span class="card__glyph" aria-hidden="true">${glyph}</span>
          <span class="status" data-state="checking" title="正在检测">
            <span class="status__dot" aria-hidden="true"></span>
            <span class="status__text">检测中</span>
          </span>
        </div>
        <h2 class="card__name">${escapeHtml(site.name)}</h2>
        <p class="card__host">${escapeHtml(hostOf(site.url))}</p>
        <p class="card__desc">${escapeHtml(site.desc || '')}</p>
        <div class="card__foot">
          <span class="card__meta">—</span>
          <span class="card__go">
            打开
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4.5 11.5 11.5 4.5" />
              <path d="M6 4.5h5.5V10" />
            </svg>
          </span>
        </div>
      </a>`;
  }).join('');

  for (const site of LINKS) {
    cards.set(site.id, els.links.querySelector(`[data-id="${CSS.escape(site.id)}"]`));
  }
}

/* ---------- 状态展示 ---------- */

function setPill(card, state, label, title) {
  const pill = card.querySelector('.status');
  pill.dataset.state = state;
  pill.querySelector('.status__text').textContent = label;
  pill.title = title;
}

function setMeta(card, text, tone = null) {
  const meta = card.querySelector('.card__meta');
  meta.textContent = text;
  meta.classList.toggle('is-bad', tone === 'bad');
  meta.classList.toggle('is-warn', tone === 'warn');
}

function applyResult(site, result) {
  const card = cards.get(site.id);
  if (!card) return;

  if (!result) {
    setPill(card, 'checking', '检测中', '正在检测');
    setMeta(card, '—');
    return;
  }

  if (result.restricted) {
    setPill(card, 'warn', '仅本地', '公网访问被 DSH 拒绝（HTTP 403）');
    setMeta(card, '公网 403', 'warn');
    return;
  }

  if (result.ok) {
    const status = result.status || 200;
    setPill(card, 'online', '在线', `HTTP ${status} · ${result.ms} ms`);
    setMeta(card, `${result.ms} ms`);
    return;
  }

  const reason = result.error
    ? {
        timeout: '连接超时',
        unreachable: '无法连接',
        'mixed-content': '需要 HTTPS',
        'access-denied': 'Access 拒绝',
        'access-token-missing': '缺少 Access 令牌',
        'probe-blocked': '探测被 Basic Auth 拦截',
        'probe-cookie-missing': '缺少探测 Cookie',
      }[result.error] ?? '检测失败'
    : `HTTP ${result.status}`;

  setPill(card, 'offline', '离线', reason);
  setMeta(card, reason, 'bad');
}

function applyApiFailure(message) {
  for (const site of LINKS) {
    const card = cards.get(site.id);
    if (!card) continue;
    setPill(card, 'error', '检测失败', message);
    setMeta(card, '接口不可用', 'bad');
  }
  els.lastCheck.textContent = '状态接口不可用';
  els.mode.textContent = '接口异常';
}

function announce(results) {
  const changes = [];
  for (const site of LINKS) {
    const result = results.get(site.id);
    const next = result?.restricted ? 'restricted' : result?.ok ? 'online' : 'offline';
    if (previousStates.get(site.id) !== next) {
      previousStates.set(site.id, next);
      const label = next === 'restricted' ? '仅本地' : next === 'online' ? '在线' : '离线';
      changes.push(`${site.name} ${label}`);
    }
  }
  if (changes.length) {
    els.announcer.textContent = `状态更新：${changes.join('，')}`;
  }
}

/* ---------- 请求 ---------- */

async function fetchStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`状态接口返回 HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.results)) {
      throw new Error('状态接口返回格式不正确');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  if (busy) return;
  busy = true;
  els.refresh.classList.add('is-busy');
  els.refresh.disabled = true;

  try {
    const data = await fetchStatus();
    const byId = new Map(data.results.map((item) => [item.id, item]));
    const results = new Map();

    for (const site of LINKS) {
      const result = byId.get(site.id) ?? {
        id: site.id,
        ok: false,
        status: 0,
        ms: 0,
        error: 'unreachable',
      };
      results.set(site.id, result);
      applyResult(site, result);
    }

    announce(results);
    els.lastCheck.textContent = `检测于 ${formatTime(data.checkedAt)}`;
    els.mode.textContent = '边缘检测';
    els.mode.removeAttribute('title');
  } catch (error) {
    console.error('[eggle0v0] 状态检测失败：', error);
    applyApiFailure(String(error?.message ?? error));
  } finally {
    busy = false;
    els.refresh.classList.remove('is-busy');
    els.refresh.disabled = false;
    schedule();
  }
}

/* ---------- 自动刷新 ---------- */

function schedule() {
  clearTimeout(timerId);
  if (document.hidden) return;
  timerId = setTimeout(refresh, REFRESH_MS);
}

/* ---------- 交互 ---------- */

els.refresh.addEventListener('click', () => refresh());

document.addEventListener('visibilitychange', () => {
  clearTimeout(timerId);
  if (!document.hidden) refresh();
});

window.addEventListener('online', () => refresh());

let rafId = 0;
let pointer = null;

document.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  const card = event.target.closest?.('.card');
  if (!card) return;

  pointer = { card, x: event.clientX, y: event.clientY };
  if (rafId) return;

  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!pointer) return;
    const rect = pointer.card.getBoundingClientRect();
    pointer.card.style.setProperty('--mx', `${pointer.x - rect.left}px`);
    pointer.card.style.setProperty('--my', `${pointer.y - rect.top}px`);
    pointer = null;
  });
});

/* ---------- 启动 ---------- */

render();
refresh();
