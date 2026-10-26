'use strict';

/**
 * eBay Browse API (client credentials flow) — серверный провайдер реальных предложений.
 *
 * Только серверные вызовы; ошибки наружу НЕ выбрасываются.
 * При любой ошибке search() возвращает { ok:false, items:[], error } — поиск продолжает
 * работать с локальными демо-предложениями и sources.
 *
 * Секреты — из .env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (в браузер не попадают).
 */

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const EBAY_LIMIT = 30; // 20–50 по заданию
const TOKEN_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 10000;
// Не запрашивать токен чаще, чем раз в 5 минут (даже при коротких expires_in).
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
// Кэш результатов: 10 минут (задача допускает 5–15).
const RESULTS_TTL_MS = 10 * 60 * 1000;

/**
 * Нормализация одного itemSummary в формат offers (поля data/demo-offers.json + is_demo).
 * category/color/size/brand = null: у Browse API нет данных, английские названия
 * категорий пользователю не показываем и ничего не угадываем.
 * @param {object|null} raw
 * @returns {object|null}
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.itemId == null ? '' : raw.itemId);
  const title = String(raw.title == null ? '' : raw.title).trim().slice(0, 200);
  const price = Number(raw.price && raw.price.value);
  const currency = String((raw.price && raw.price.currency) || '').toUpperCase();
  const url = String(raw.itemWebUrl || '');
  if (!id || !title || !Number.isFinite(price) || !/^https?:\/\//i.test(url)) return null;

  const thumbnail = Array.isArray(raw.thumbnailImages) && raw.thumbnailImages[0]
    ? raw.thumbnailImages[0].imageUrl || null
    : null;

  return {
    id,
    source: 'eBay',
    title,
    brand: null,
    category: null,
    color: null,
    size: null,
    price,
    currency,
    condition: String(raw.condition || '').trim() || null,
    url,
    image_url: thumbnail,
    in_stock: true,
    updated_at: String(raw.itemCreationDate || '').slice(0, 10),
    is_demo: false,
  };
}

/** Нормализация списка с ограничением EBAY_LIMIT. */
function normalizeItems(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    const n = normalizeItem(raw);
    if (n) out.push(n);
    if (out.length >= EBAY_LIMIT) break;
  }
  return out;
}

/**
 * Создание провайдера (fetch инжектится для тестов).
 * @param {object} opts
 * @param {typeof fetch} [opts.fetchImpl=globalThis.fetch]
 * @param {string|null} [opts.clientId]
 * @param {string|null} [opts.clientSecret]
 * @param {string} [opts.marketplace='EBAY_US']
 */
function createEbayProvider({
  fetchImpl = globalThis.fetch,
  clientId = null,
  clientSecret = null,
  marketplace = 'EBAY_US',
} = {}) {
  let token = null; // { value, expiresAt }
  const resultsCache = new Map(); // phrase -> { ts, items }

  function isConfigured() {
    return !!(clientId && clientSecret);
  }

  async function getAccessToken() {
    if (token && Date.now() < token.expiresAt) {
      return { ok: true, token: token.value };
    }
    if (!isConfigured()) {
      return { ok: false, error: 'eBay не настроен (нет ключей в .env)' };
    }
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TOKEN_TIMEOUT_MS);
      try {
        const r = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials&scope=' + encodeURIComponent(SCOPE),
          signal: ac.signal,
        });
        const text = await r.text();
        const j = JSON.parse(text);
        if (!r.ok) return { ok: false, error: `eBay token ${r.status}: ${text.slice(0, 120)}` };
        if (!j.access_token) return { ok: false, error: 'eBay: токен отсутствует в ответе' };
        const expiresInMs = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : TOKEN_MIN_TTL_MS;
        token = { value: String(j.access_token), expiresAt: Date.now() + expiresInMs - 30_000 };
        return { ok: true, token: token.value };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return { ok: false, error: `eBay: не удалось получить токен (${e.message})` };
    }
  }

  async function searchItems(tokenValue, phrase) {
    try {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(phrase)}&limit=${EBAY_LIMIT}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);
      try {
        const r = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${tokenValue}`,
            'X-EBAY-C-MARKETPLACE-ID': marketplace,
          },
          signal: ac.signal,
        });
        const text = await r.text();
        const j = JSON.parse(text);
        if (!r.ok) return { ok: false, error: `eBay search ${r.status}: ${text.slice(0, 120)}` };
        return { ok: true, items: normalizeItems(j.itemSummaries) };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return { ok: false, error: `eBay: поиск не удался (${e.message})` };
    }
  }

  /**
   * Поиск по фразе с кэшем результатов.
   * @param {string} phrase
   * @returns {Promise<{provider:'ebay', ok:true, items:object[], source:'eBay', cached?:boolean} |
   *                   {provider:'ebay', ok:false, items:[], source:'eBay', error:string}>}
   */
  async function search(phrase) {
    const key = String(phrase || '').trim().toLowerCase();
    if (!key) return { provider: 'ebay', ok: false, items: [], source: 'eBay', error: 'eBay: пустая фраза' };

    const cached = resultsCache.get(key);
    if (cached && Date.now() - cached.ts < RESULTS_TTL_MS) {
      return { provider: 'ebay', ok: true, items: cached.items, source: 'eBay', cached: true };
    }

    const t = await getAccessToken();
    if (!t.ok) return { provider: 'ebay', ok: false, items: [], source: 'eBay', error: t.error };

    const s = await searchItems(t.token, key);
    if (!s.ok) return { provider: 'ebay', ok: false, items: [], source: 'eBay', error: s.error };

    resultsCache.set(key, { ts: Date.now(), items: s.items });
    return { provider: 'ebay', ok: true, items: s.items, source: 'eBay' };
  }

  function clearCache() {
    token = null;
    resultsCache.clear();
  }

  return { id: 'ebay', isConfigured, search, clearCache };
}

module.exports = {
  createEbayProvider,
  normalizeItem,
  normalizeItems,
  EBAY_LIMIT,
  RESULTS_TTL_MS,
  TOKEN_MIN_TTL_MS,
};