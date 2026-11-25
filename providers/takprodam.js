'use strict';

/**
 * Takprodam publisher API — серверный адаптер.
 * Токен только из env. Не угадываем marketplace slug для Яндекс Маркета.
 * Не переключаемся на другой source_id автоматически.
 */

const DEFAULT_TIMEOUT_MS = 15000;

function nonempty(v) {
  return v != null && String(v).trim() !== '';
}

function hostFromUrl(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function createTakprodamClient({
  fetchImpl = globalThis.fetch,
  apiBase = 'https://api.takprodam.ru/v2/publisher',
  apiToken = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const token = String(apiToken || '').trim();

  function configured() {
    return !!token;
  }

  async function apiGet(path, params) {
    if (!configured()) {
      return { ok: false, status: 0, error: 'token_missing', json: null };
    }
    const u = new URL(base + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
        },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = null;
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: (json && (json.message || json.error)) || 'http_' + res.status,
          json,
        };
      }
      return { ok: true, status: res.status, error: null, json };
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        error: aborted ? 'timeout' : e.message || 'network_error',
        json: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Проверка площадки 24991: существует, approved, URL хоста совпадает.
   * Другие площадки (в т.ч. дубликат VishFind) не выбираются.
   */
  async function verifySource({ sourceId, expectedHost }) {
    const wantId = Number(sourceId);
    const wantHost = String(expectedHost || '')
      .replace(/^www\./i, '')
      .toLowerCase();
    const res = await apiGet('/source/', {});
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        status: res.status,
        source: null,
        others: [],
      };
    }
    const items = (res.json && res.json.items) || [];
    const normalized = items.map((s) => ({
      id: s.id != null ? s.id : s.source_id,
      title: s.title || null,
      status: s.status || null,
      source_url: s.source_url || null,
      created_at: s.created_at || null,
    }));
    const match = normalized.find((s) => Number(s.id) === wantId) || null;
    const others = normalized.filter((s) => Number(s.id) !== wantId);
    if (!match) {
      return {
        ok: false,
        error: 'source_not_found',
        status: res.status,
        source: null,
        others,
      };
    }
    if (String(match.status).toLowerCase() !== 'approved') {
      return {
        ok: false,
        error: 'source_not_approved',
        status: res.status,
        source: match,
        others,
      };
    }
    const host = hostFromUrl(match.source_url);
    if (wantHost && host !== wantHost) {
      return {
        ok: false,
        error: 'source_url_mismatch',
        status: res.status,
        source: match,
        others,
        expectedHost: wantHost,
        actualHost: host,
      };
    }
    return { ok: true, error: null, status: res.status, source: match, others };
  }

  async function listCategories() {
    const res = await apiGet('/product-category/', {});
    if (!res.ok) return { ok: false, error: res.error, status: res.status, items: [] };
    const items = (res.json && res.json.items) || [];
    return {
      ok: true,
      error: null,
      status: res.status,
      items: items.map((c) => ({ id: c.id, title: c.title || c.name || null })),
    };
  }

  /**
   * Одна страница товаров. marketplace — только проверенные slug (ozon|wildberries|…).
   */
  async function listProducts({ sourceId, marketplace, categoryId, page = 1, limit = 50 }) {
    // Пауза обновления (не запрет): без HTTP для приостановленных срезов.
    try {
      const { isMarketplacePaused, pauseNote } = require('../lib/takprodam-marketplace-pause');
      if (marketplace && isMarketplacePaused(marketplace)) {
        return {
          ok: false,
          error: 'marketplace_paused:' + String(marketplace).toLowerCase(),
          status: null,
          items: [],
          total_count: null,
          page: null,
          limit: null,
          pause_note: pauseNote(marketplace),
        };
      }
    } catch (_) {
      /* модуль паузы недоступен — не блокируем клиент */
    }
    const params = {
      source_id: sourceId,
      page,
      limit,
    };
    if (marketplace) params.marketplace = marketplace;
    if (categoryId != null) params.category_id = categoryId;
    const res = await apiGet('/product/', params);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        status: res.status,
        items: [],
        total_count: null,
        page: null,
        limit: null,
      };
    }
    const items = (res.json && res.json.items) || [];
    return {
      ok: true,
      error: null,
      status: res.status,
      items,
      total_count: typeof res.json.total_count === 'number' ? res.json.total_count : null,
      page: res.json.page != null ? res.json.page : page,
      limit: res.json.limit != null ? res.json.limit : limit,
    };
  }

  return {
    configured,
    verifySource,
    listCategories,
    listProducts,
    nonempty,
    hostFromUrl,
  };
}

module.exports = {
  createTakprodamClient,
  hostFromUrl,
  nonempty,
};
