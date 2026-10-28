'use strict';

/**
 * Техническая политика возможностей источника.
 * Не юридическое заключение.
 *
 * Capabilities (status: documented_allowed | restricted | basis_unset | temporarily_disabled):
 * - ordinary_link / outbound_link — показ обычного перехода
 * - search_link — шаблон поиска в выдаче
 * - web_search_display — URL из Ollama web_search в блоке уточнения
 * - search_title / search_snippet — копирование заголовка/сниппета магазина
 * - web_fetch / ollama_web_fetch — чтение страницы
 * - html_product_fetch — серверный HTML-разбор карточек
 * - api_products / product_price / product_image
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function loadRegistry() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/source-registry.json'), 'utf8')
  );
}

function policyOf(src) {
  return (src && src.usage_policy) || {};
}

function cap(src, name) {
  const p = policyOf(src);
  // Алиасы к уже используемым полям
  const aliases = {
    ordinary_link: 'outbound_link',
    ollama_web_fetch: 'web_fetch',
  };
  const key = aliases[name] || name;
  let v = p[key];
  if ((v == null || v === '') && name === 'web_fetch') v = p.ollama_web_fetch;
  if ((v == null || v === '') && name === 'ordinary_link') v = p.outbound_link;
  if (v == null || v === '') return 'basis_unset';
  return String(v);
}

function normalizeHost(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** Точное совпадение домена или поддомен зарегистрированного domain. */
function hostMatchesDomain(hostname, domain) {
  const h = normalizeHost(hostname);
  const d = normalizeHost(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith('.' + d);
}

function findById(id) {
  const reg = loadRegistry();
  return (reg.sources || []).find((s) => s.id === id) || null;
}

function findByDomain(hostname) {
  const h = normalizeHost(hostname);
  if (!h) return null;
  const reg = loadRegistry();
  let best = null;
  let bestLen = -1;
  for (const s of reg.sources || []) {
    const d = normalizeHost(s.domain);
    if (!d) continue;
    if (!hostMatchesDomain(h, d)) continue;
    if (d.length > bestLen) {
      best = s;
      bestLen = d.length;
    }
  }
  return best;
}

function hostnameFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname;
  } catch (_) {
    return '';
  }
}

/** Хост с outbound_link=restricted (напр. THE CULTT) — полный запрет показа/fetch. */
function isOutboundRestrictedHost(hostname) {
  const h = normalizeHost(hostname);
  if (!h) return true;
  const reg = loadRegistry();
  for (const s of reg.sources || []) {
    if (cap(s, 'outbound_link') !== 'restricted') continue;
    if (hostMatchesDomain(h, s.domain)) return true;
  }
  return false;
}

function connectionBlocked(src) {
  return (
    !!src
    && (src.connection_status === 'disabled'
      || src.connection_status === 'temporarily_limited')
  );
}

function htmlProductFetchAllowed(src) {
  if (!src) return false;
  if (connectionBlocked(src)) return false;
  const status = cap(src, 'html_product_fetch');
  if (status === 'restricted' || status === 'temporarily_disabled') return false;
  return status === 'documented_allowed';
}

function outboundLinkAllowed(src) {
  if (!src) return false;
  if (src.connection_status === 'disabled') return false;
  const status = cap(src, 'outbound_link');
  if (status === 'restricted' || status === 'temporarily_disabled') return false;
  if (src.connection_status === 'temporarily_limited' && status !== 'documented_allowed') {
    return false;
  }
  if (
    src.connection_status === 'search_link'
    || src.connection_status === 'products_connected'
    || src.connection_status === 'identity_checked'
  ) {
    return status !== 'restricted';
  }
  return false;
}

/**
 * Показ URL из web_search в UI.
 * Restricted outbound / temporarily_limited с restriction — нет.
 * Неизвестный домен: допускается только как нейтральная ссылка
 * после фильтра allowedDomains (вызывающая сторона); сам по себе не «approved».
 */
function webSearchDisplayAllowedForUrl(url) {
  const host = hostnameFromUrl(url);
  if (!host) return false;
  if (isOutboundRestrictedHost(host)) return false;
  const src = findByDomain(host);
  if (!src) return true; // неизвестный — не авто-запрет display, но caller режет по allowedDomains
  const disp = cap(src, 'web_search_display');
  if (disp === 'restricted' || disp === 'temporarily_disabled') return false;
  if (cap(src, 'outbound_link') === 'restricted') return false;
  if (connectionBlocked(src) && !outboundLinkAllowed(src)) return false;
  return outboundLinkAllowed(src) || disp === 'documented_allowed' || disp === 'basis_unset';
}

/** Копирование сниппета/описания магазина — только documented_allowed. */
function searchSnippetAllowed(src) {
  if (!src) return false;
  return cap(src, 'search_snippet') === 'documented_allowed';
}

function searchTitleAllowed(src) {
  if (!src) return false;
  const t = cap(src, 'search_title');
  if (t === 'documented_allowed') return true;
  if (t === 'restricted' || t === 'temporarily_disabled') return false;
  return false; // basis_unset → нейтральная подпись, не чужой title
}

/**
 * web_fetch: неизвестный домен = запрет.
 * Разрешение web_search ≠ разрешение fetch.
 */
function webFetchAllowedForUrl(url) {
  const host = hostnameFromUrl(url);
  if (!host) return false;
  if (isOutboundRestrictedHost(host)) return false;
  const src = findByDomain(host);
  if (!src) return false;
  if (connectionBlocked(src)) return false;
  const status = cap(src, 'web_fetch');
  return status === 'documented_allowed';
}

function ollamaFetchAllowedForSource(src) {
  if (!src || !src.domain) return false;
  return webFetchAllowedForUrl('https://' + String(src.domain).replace(/^https?:\/\//, ''));
}

function hostInAllowlist(hostname, allowedDomains) {
  const h = normalizeHost(hostname);
  if (!h) return false;
  const list = (allowedDomains || [])
    .map((d) => normalizeHost(d))
    .filter(Boolean);
  if (!list.length) return false;
  return list.some((d) => hostMatchesDomain(h, d));
}

/**
 * Фильтр результатов web_search (в т.ч. после кэша).
 * @param {Array<{url:string,title?:string,content?:string}>} results
 * @param {{ allowedDomains?: string[] }} opts — если список задан, URL вне списка отбрасываются
 */
function filterWebSearchResults(results, opts) {
  const allowedDomains = (opts && opts.allowedDomains) || [];
  const requireAllowlist = allowedDomains.length > 0;
  const out = [];
  for (const row of results || []) {
    if (!row || !row.url) continue;
    let host = '';
    try {
      host = new URL(row.url).hostname;
    } catch (_) {
      continue;
    }
    if (isOutboundRestrictedHost(host)) continue;
    if (requireAllowlist && !hostInAllowlist(host, allowedDomains)) continue;
    if (!webSearchDisplayAllowedForUrl(row.url)) continue;
    out.push(row);
  }
  return out;
}

/** Адаптер links: та же политика, что selectSources. */
function adapterSourceAllowed(registrySrc) {
  if (!registrySrc) return false;
  if (connectionBlocked(registrySrc)) return false;
  return outboundLinkAllowed(registrySrc);
}

function summarizePolicies() {
  const reg = loadRegistry();
  const rows = [];
  for (const s of reg.sources || []) {
    const p = policyOf(s);
    if (!Object.keys(p).length) continue;
    rows.push({
      id: s.id,
      connection_status: s.connection_status,
      outbound_link: cap(s, 'outbound_link'),
      web_search_display: cap(s, 'web_search_display'),
      web_fetch: cap(s, 'web_fetch'),
      html_product_fetch: cap(s, 'html_product_fetch'),
      search_snippet: cap(s, 'search_snippet'),
      note: p.note || null,
    });
  }
  return rows;
}

module.exports = {
  policyOf,
  cap,
  normalizeHost,
  hostMatchesDomain,
  hostInAllowlist,
  hostnameFromUrl,
  findById,
  findByDomain,
  isOutboundRestrictedHost,
  connectionBlocked,
  htmlProductFetchAllowed,
  outboundLinkAllowed,
  webSearchDisplayAllowedForUrl,
  searchSnippetAllowed,
  searchTitleAllowed,
  webFetchAllowedForUrl,
  ollamaFetchAllowedForSource,
  filterWebSearchResults,
  adapterSourceAllowed,
  summarizePolicies,
};
