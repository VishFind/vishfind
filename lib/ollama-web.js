'use strict';

/**
 * Ollama Web Search / Web Fetch (https://docs.ollama.com/capabilities/web-search).
 * Ключ только на сервере. Без npm-зависимостей (fetch).
 * Недоверенный веб-текст не меняет правила и реестр доверия.
 */

const config = require('./config');

const SEARCH_URL = 'https://ollama.com/api/web_search';
const FETCH_URL = 'https://ollama.com/api/web_fetch';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 5;
const MAX_CONTENT = 4000;
const MAX_FETCH_PER_SEARCH = 1;

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
let inFlightSearch = 0;
const MAX_PARALLEL = 2;

function apiKey() {
  return (config.webSearch && config.webSearch.ollamaKey) || '';
}

function isConfigured() {
  return !!apiKey();
}

function isEnabled() {
  return !!(config.webSearch && config.webSearch.enabled && isConfigured());
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 64) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function sanitizeQuery(q) {
  return String(q || '')
    .replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  if (h === 'metadata.google.internal') return false;
  return true;
}

function safePublicHttpsUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!hostAllowed(u.hostname)) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function applySearchResultPolicy(results, allowedDomains) {
  try {
    const sourcePolicy = require('./source-policy');
    return sourcePolicy.filterWebSearchResults(results || [], {
      allowedDomains: allowedDomains || [],
    });
  } catch (_) {
    return [];
  }
}

async function webSearch(query, opts) {
  if (!isEnabled()) {
    return {
      ok: false,
      disabled: true,
      reason: isConfigured()
        ? 'WEB_SEARCH_ENABLED=false'
        : 'OLLAMA_API_KEY не настроен',
      results: [],
    };
  }
  const q = sanitizeQuery(query);
  if (!q) return { ok: false, error: 'empty_query', results: [] };

  const maxResults = Math.min(
    Math.max(1, Number((opts && opts.maxResults) || MAX_RESULTS) || MAX_RESULTS),
    10
  );
  const allowedDomains = (opts && opts.allowedDomains) || [];
  const cacheKey = 's:' + maxResults + ':' + q;
  const cached = cacheGet(cacheKey);
  if (cached) {
    // Повторно применяем текущую политику доменов (не статус на момент записи кэша).
    const results = applySearchResultPolicy(cached.results, allowedDomains);
    return {
      ok: true,
      results,
      provider: cached.provider || 'ollama_web_search',
      cached: true,
    };
  }

  if (inFlightSearch >= MAX_PARALLEL) {
    return { ok: false, error: 'overloaded', results: [] };
  }

  inFlightSearch += 1;
  try {
    const r = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey(),
      },
      body: JSON.stringify({ query: q, max_results: maxResults }),
      signal: AbortSignal.timeout((opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS),
    });
    if (r.status === 401 || r.status === 403) {
      return { ok: false, error: 'auth_' + r.status, results: [] };
    }
    if (r.status === 429) {
      return { ok: false, error: 'rate_limited', results: [] };
    }
    if (!r.ok) {
      return { ok: false, error: 'http_' + r.status, results: [] };
    }
    const j = await r.json();
    const raw = [];
    for (const row of j.results || []) {
      const url = safePublicHttpsUrl(row.url);
      if (!url) continue;
      raw.push({
        title: String(row.title || '').slice(0, 160),
        url,
        content: String(row.content || '').slice(0, MAX_CONTENT),
      });
    }
    // В кэш — сырые URL (безопасный https); выдача всегда через политику.
    cacheSet(cacheKey, { ok: true, results: raw, provider: 'ollama_web_search' });
    const results = applySearchResultPolicy(raw, allowedDomains);
    return { ok: true, results, provider: 'ollama_web_search' };
  } catch (e) {
    const name = e && e.name;
    return {
      ok: false,
      error: name === 'TimeoutError' ? 'timeout' : 'network',
      results: [],
    };
  } finally {
    inFlightSearch = Math.max(0, inFlightSearch - 1);
  }
}

async function webFetch(url, opts) {
  // web_search ≠ web_fetch. Неизвестный домен ≠ разрешённый.
  try {
    const sourcePolicy = require('./source-policy');
    if (!sourcePolicy.webFetchAllowedForUrl(url)) {
      return { ok: false, error: 'policy_blocked_host' };
    }
  } catch (_) {
    return { ok: false, error: 'policy_check_failed' };
  }
  if (!isEnabled()) {
    return { ok: false, disabled: true, reason: 'web_disabled' };
  }
  const safe = safePublicHttpsUrl(url);
  if (!safe) return { ok: false, error: 'url_blocked' };

  // Повторная проверка после нормализации URL (в т.ч. при чтении кэша).
  try {
    const sourcePolicy = require('./source-policy');
    if (!sourcePolicy.webFetchAllowedForUrl(safe)) {
      return { ok: false, error: 'policy_blocked_host' };
    }
  } catch (_) {
    return { ok: false, error: 'policy_check_failed' };
  }

  const cacheKey = 'f:' + safe;
  const cached = cacheGet(cacheKey);
  if (cached) {
    try {
      const sourcePolicy = require('./source-policy');
      if (!sourcePolicy.webFetchAllowedForUrl(safe)) {
        return { ok: false, error: 'policy_blocked_host' };
      }
    } catch (_) {
      return { ok: false, error: 'policy_check_failed' };
    }
    return { ...cached, cached: true };
  }

  try {
    const r = await fetch(FETCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey(),
      },
      body: JSON.stringify({ url: safe }),
      signal: AbortSignal.timeout((opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, error: 'http_' + r.status };
    const j = await r.json();
    const links = Array.isArray(j.links)
      ? j.links.map(safePublicHttpsUrl).filter(Boolean).slice(0, 20)
      : [];
    const out = {
      ok: true,
      title: String(j.title || '').slice(0, 200),
      content: String(j.content || '').slice(0, MAX_CONTENT),
      links,
      provider: 'ollama_web_fetch',
    };
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    return {
      ok: false,
      error: e && e.name === 'TimeoutError' ? 'timeout' : 'network',
    };
  }
}

/**
 * Ограниченный pipeline: поиск по бренду/фразе в известных доменах.
 * Не присваивает trust и не создаёт фейковые товары.
 * В API уходит только собранная строка запроса (бренд + фраза + site:),
 * без фото, истории, избранного и прочих полей пользователя.
 */
async function enrichBrandSearch(queryInfo, allowedDomains) {
  if (!isEnabled()) {
    return { used: false, reason: 'disabled', items: [], warnings: [] };
  }
  const info = queryInfo && typeof queryInfo === 'object' ? queryInfo : {};
  const brand = (info.brands && info.brands[0]) || info.brand || '';
  const phrase = info.search_phrase || '';
  if (!brand && !phrase) {
    return { used: false, reason: 'no_query', items: [], warnings: [] };
  }

  const sourcePolicy = require('./source-policy');
  const domains = (allowedDomains || [])
    .map((d) => String(d).toLowerCase())
    .filter(Boolean)
    .filter((d) => {
      try {
        return !sourcePolicy.isOutboundRestrictedHost(d);
      } catch (_) {
        return true;
      }
    });

  // Без allowlist не открываем «сырой» интернет в выдачу.
  if (!domains.length) {
    return {
      used: true,
      reason: 'no_allowed_domains',
      items: [],
      warnings: [],
    };
  }

  const q = [brand, phrase, 'site:' + domains[0]]
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);

  const search = await webSearch(q, { maxResults: 4, allowedDomains: domains });
  if (!search.ok) {
    return {
      used: true,
      reason: search.error || search.reason || 'search_failed',
      items: [],
      warnings: ['Веб-поиск временно недоступен — показаны обычные переходы.'],
    };
  }

  // Уже отфильтровано в webSearch; повторно на случай смены политики.
  const filtered = applySearchResultPolicy(search.results, domains);
  if (!filtered.length) {
    return {
      used: true,
      reason: 'no_policy_results',
      items: [],
      warnings: [],
    };
  }

  const items = filtered.slice(0, 3).map((r) => {
    let host = '';
    try {
      host = new URL(r.url).hostname.replace(/^www\./, '');
    } catch (_) {
      host = '';
    }
    const src = sourcePolicy.findByDomain(host);
    const useShopTitle = sourcePolicy.searchTitleAllowed(src);
    const useSnippet = sourcePolicy.searchSnippetAllowed(src);
    return {
      result_kind: 'search_link',
      title: useShopTitle && r.title
        ? String(r.title).slice(0, 160)
        : host
          ? 'Страница на ' + host
          : 'Страница в интернете',
      url: r.url,
      source: 'Интернет-поиск',
      trust_level: 'unverified',
      price: null,
      price_note: 'Цена на сайте',
      snippet: useSnippet && r.content ? String(r.content).slice(0, 180) : null,
      data_origin: 'ollama_web_search',
      obtained_at: new Date().toISOString(),
      note: 'Неподтверждённый переход; не партнёрство и не гарантия оригинала.',
    };
  });

  // Fetch только при OLLAMA_WEB_FETCH=true и documented_allowed web_fetch.
  let fetchMeta = null;
  const doFetch = String(process.env.OLLAMA_WEB_FETCH || '').toLowerCase() === 'true';
  if (doFetch && items[0]) {
    const fr = await webFetch(items[0].url);
    if (fr.ok) {
      fetchMeta = {
        title: fr.title,
        content_len: (fr.content || '').length,
        links: (fr.links || []).length,
      };
      // Не подставляем чужой title без search_title permission.
      const src = sourcePolicy.findByDomain(
        sourcePolicy.hostnameFromUrl(items[0].url)
      );
      if (fr.title && sourcePolicy.searchTitleAllowed(src)) {
        items[0].title = fr.title.slice(0, 160);
      }
    }
  }

  return {
    used: true,
    reason: null,
    items,
    fetch: fetchMeta,
    warnings: [
      'Интернет-поиск уточняет страницы; не подтверждает оригинал, наличие и цену.',
    ],
  };
}

function publicStatus() {
  return {
    configured: isConfigured(),
    enabled: isEnabled(),
    provider: isConfigured() ? 'ollama' : null,
  };
}

module.exports = {
  isConfigured,
  isEnabled,
  webSearch,
  webFetch,
  enrichBrandSearch,
  publicStatus,
  safePublicHttpsUrl,
  applySearchResultPolicy,
};
