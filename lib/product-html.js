'use strict';

/**
 * Консервативное извлечение карточек товара из публичного HTML.
 * Не обходит CAPTCHA. Не выдумывает цены. Таймаут и лимит объёма.
 */

const ALLOWED = new Set([
  'peakstore.ru',
  'www.peakstore.ru',
  'brandshop.ru',
  'www.brandshop.ru',
  'thecultt.com',
  'www.thecultt.com',
  'collect.tsum.ru',
  'spin4spin.com',
  'www.spin4spin.com',
  'limestore.com',
  'www.limestore.com',
  'maag-fashion.com',
  'www.maag-fashion.com',
]);

const MAX_HTML = 800_000;
const TIMEOUT_MS = 12_000;

function hostOk(hostname) {
  const h = String(hostname || '').toLowerCase();
  return ALLOWED.has(h);
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!hostOk(u.hostname)) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function parseRubPrices(html) {
  const text = String(html || '');
  const re = /(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d{4,7})\s*₽/g;
  const prices = [];
  let m;
  while ((m = re.exec(text))) {
    const n = Number(String(m[1]).replace(/[\s\u00a0\u202f]/g, ''));
    if (Number.isFinite(n) && n >= 100 && n <= 50_000_000) prices.push(n);
  }
  return prices;
}

/**
 * Peak Concept / похожие витрины: блоки «### Brand» + название + цена.
 */
function extractPeakLike(html, baseUrl) {
  const items = [];
  const chunk = String(html || '');
  // Markdown-подобный вывод WebFetch и сырой HTML с ценами
  const blocks = chunk.split(/\n###\s+/).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const brandLine = lines[0].replace(/^#+\s*/, '').trim();
    let title = null;
    let price = null;
    for (const line of lines.slice(1, 8)) {
      const pm = line.match(/(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d{4,7})\s*₽/);
      if (pm) {
        price = Number(String(pm[1]).replace(/[\s\u00a0\u202f]/g, ''));
        break;
      }
      if (!title && line.length > 2 && !/^Peak Concept/i.test(line) && !/^\d/.test(line)) {
        title = line.slice(0, 160);
      }
    }
    if (price == null) continue;
    items.push({
      result_kind: 'product',
      title: [brandLine, title].filter(Boolean).join(' — ').slice(0, 180),
      brand: brandLine.slice(0, 80),
      price,
      currency: 'RUB',
      url: baseUrl,
      availability: null,
      condition: 'unknown',
      data_origin: 'public_html_parse',
      obtained_at: new Date().toISOString(),
      price_note: null,
      trust_level: null,
      source: null,
    });
    if (items.length >= 8) break;
  }
  return items;
}

function absUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

function rubPrice(raw) {
  const n = Number(String(raw || '').replace(/[\s\u00a0\u202f]/g, ''));
  return Number.isFinite(n) && n >= 100 && n <= 50_000_000 ? n : null;
}

/**
 * THE CULTT: markdown-сниппет или публичный HTML лотов /product/...
 */
function extractCulttLike(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const push = (row) => {
    const key = (row.url || '') + '|' + row.price + '|' + row.title;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(row);
  };

  const md = /##\s+([^\n]+)\s*\n+(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d{4,7})\s*₽/g;
  let m;
  while ((m = md.exec(String(html || ''))) && items.length < 8) {
    const price = rubPrice(m[2]);
    if (price == null) continue;
    push({
      result_kind: 'product',
      title: String(m[1]).trim().slice(0, 180),
      brand: null,
      price,
      currency: 'RUB',
      url: baseUrl,
      availability: null,
      condition: 'pre_owned_or_unknown',
      data_origin: 'public_html_parse',
      obtained_at: new Date().toISOString(),
      price_note: null,
      trust_level: null,
      source: null,
    });
  }

  const htmlRe =
    /href="(\/product\/[^"]+|https:\/\/thecultt\.com\/product\/[^"]+)"[\s\S]{0,500}?>([^<]{5,80})<[\s\S]{0,200}?(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+)\s*₽/gi;
  while ((m = htmlRe.exec(String(html || ''))) && items.length < 8) {
    const price = rubPrice(m[3]);
    const url = absUrl(baseUrl || 'https://thecultt.com/', m[1]);
    if (price == null || !url || !hostOk(new URL(url).hostname)) continue;
    const title = String(m[2]).replace(/\s+/g, ' ').trim();
    push({
      result_kind: 'product',
      title: title.slice(0, 180),
      brand: title.split(/\s+/)[0] || null,
      price,
      currency: 'RUB',
      url,
      availability: null,
      condition: 'pre_owned_or_unknown',
      data_origin: 'public_html_parse',
      obtained_at: new Date().toISOString(),
      price_note: null,
      trust_level: null,
      source: null,
    });
  }
  return items;
}

/**
 * TSUM Collect: карточки /item/ITEM… + alt бренда + цена ₽.
 */
function extractTsumCollect(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const re =
    /href="(\/item\/ITEM[^"]+)"[\s\S]{0,600}?alt="([^"]*)"[^>]*data-brandlogo="true"[\s\S]{0,400}?>(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+)\s*₽/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && items.length < 8) {
    const price = rubPrice(m[3]);
    const url = absUrl(baseUrl || 'https://collect.tsum.ru/', m[1]);
    if (price == null || !url || !hostOk(new URL(url).hostname)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const brand = String(m[2] || '').trim() || null;
    items.push({
      result_kind: 'product',
      title: brand ? brand + ' — лот TSUM Collect' : 'Лот TSUM Collect',
      brand,
      price,
      currency: 'RUB',
      url,
      availability: null,
      condition: 'pre_owned_or_unknown',
      data_origin: 'public_html_parse',
      obtained_at: new Date().toISOString(),
      price_note: null,
      trust_level: null,
      source: null,
    });
  }
  return items;
}

async function fetchHtml(url) {
  const safe = safeUrl(url);
  if (!safe) return { ok: false, error: 'url_blocked' };
  try {
    const r = await fetch(safe, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'VishFindBot/1.0 (+local research; respectful GET)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, error: 'http_' + r.status };
    const finalUrl = safeUrl(r.url) || safe;
    const buf = Buffer.from(await r.arrayBuffer());
    const html = buf.slice(0, MAX_HTML).toString('utf8');
    return { ok: true, html, url: finalUrl };
  } catch (e) {
    return {
      ok: false,
      error: e && e.name === 'TimeoutError' ? 'timeout' : 'network',
    };
  }
}

async function loadPageText(url, opts) {
  const allowOllama = !!(opts && opts.allow_ollama_fetch);
  const direct = await fetchHtml(url);
  if (direct.ok) return { ok: true, text: direct.html, url: direct.url, via: 'direct' };
  if (!allowOllama) {
    return { ok: false, error: direct.error || 'fetch_failed' };
  }
  try {
    const ollamaWeb = require('./ollama-web');
    if (ollamaWeb.isEnabled()) {
      const fr = await ollamaWeb.webFetch(url);
      if (fr.ok) {
        return {
          ok: true,
          text: [fr.title, fr.content].filter(Boolean).join('\n'),
          url,
          via: 'ollama_web_fetch',
        };
      }
      return { ok: false, error: fr.error || direct.error || 'fetch_failed' };
    }
  } catch (_) {
    /* ignore */
  }
  return { ok: false, error: direct.error || 'fetch_failed' };
}

/**
 * @param {{ id: string, search_url_template?: string, parse?: string, name?: string, trust_level?: string, allow_ollama_fetch?: boolean }} source
 * @param {string} phrase
 */
async function searchProducts(source, phrase) {
  const q = String(phrase || '').trim().slice(0, 120);
  if (!q || !source || !source.search_url_template) {
    return { ok: false, items: [], error: 'no_template' };
  }
  // Политика реестра: без documented_allowed не ходим за HTML.
  try {
    const sourcePolicy = require('./source-policy');
    const regSrc = sourcePolicy.findById(source.id);
    if (regSrc && !sourcePolicy.htmlProductFetchAllowed(regSrc)) {
      return {
        ok: false,
        items: [],
        error: 'policy_html_product_fetch_disabled',
        note: 'Сбор карточек для этого источника отключён политикой использования.',
      };
    }
  } catch (_) {
    /* реестр недоступен — безопасный отказ от сбора */
    return { ok: false, items: [], error: 'policy_check_failed' };
  }
  const url = source.search_url_template.replace(/\{q\}/g, encodeURIComponent(q));
  const page = await loadPageText(url, {
    allow_ollama_fetch: !!source.allow_ollama_fetch,
  });
  if (!page.ok) return { ok: false, items: [], error: page.error };

  let items = [];
  const mode = source.parse || 'peak_like';
  if (mode === 'cultt_like') items = extractCulttLike(page.text, page.url);
  else if (mode === 'tsum_collect') items = extractTsumCollect(page.text, page.url);
  else items = extractPeakLike(page.text, page.url);

  if (!items.length) {
    const prices = parseRubPrices(page.text).slice(0, 3);
    if (prices.length) {
      return {
        ok: true,
        items: [],
        via: page.via,
        note: 'Цены на странице видны, но карточки товара надёжно не разобраны — только search_link.',
        sample_prices: prices,
      };
    }
    return { ok: true, items: [], via: page.via, note: 'Товары на странице не извлечены' };
  }

  items = items.map((it) => ({
    ...it,
    source: source.name || source.id,
    source_id: source.id,
    trust_level: source.trust_level || null,
    data_origin: page.via === 'ollama_web_fetch' ? 'ollama_web_fetch_parse' : 'public_html_parse',
    url: it.url || page.url,
  }));

  return { ok: true, items, url: page.url, via: page.via };
}

module.exports = {
  fetchHtml,
  loadPageText,
  searchProducts,
  extractPeakLike,
  extractCulttLike,
  extractTsumCollect,
  safeUrl,
  ALLOWED,
};
