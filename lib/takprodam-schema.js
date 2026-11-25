'use strict';

/**
 * Схема каталога Takprodam v2: нормализация, дедуп, миграция, merge по marketplace.
 * Архитектура не ограничена Ozon/Lamoda: любой marketplace_title классифицируется.
 * Полный импорт общего потока сюда не входит.
 */

const SCHEMA_VERSION = 2;
const PROVIDER = 'takprodam';

/** Подписи канала/сети, не магазин продавца. */
const CHANNEL_LABEL_RE = /^(admitad|takprodam|partner|партн)/i;

function nonempty(v) {
  return v != null && String(v).trim() !== '';
}

function hostOf(url) {
  try {
    return url ? new URL(String(url)).hostname.replace(/^www\./i, '').toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

function marketplaceKeyFromTitle(title, fallbackSlug) {
  const raw = nonempty(title) ? String(title).trim() : nonempty(fallbackSlug) ? String(fallbackSlug).trim() : '';
  if (!raw) return 'unknown';
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'unknown';
}

/**
 * Продавец: store_title, если это не ярлык канала.
 * marketplace_title=Admitad сам по себе продавцом не считается.
 */
function resolveSeller(marketplaceTitle, storeTitle) {
  const mp = nonempty(marketplaceTitle) ? String(marketplaceTitle).trim() : null;
  const store = nonempty(storeTitle) ? String(storeTitle).trim() : null;
  const mpIsChannel = mp && CHANNEL_LABEL_RE.test(mp);
  if (store && !CHANNEL_LABEL_RE.test(store)) {
    return {
      seller_title: store,
      seller_known: true,
      seller_note: mpIsChannel ? 'store_title used; marketplace_title is channel label' : null,
    };
  }
  if (mp && !mpIsChannel) {
    // Не подставляем название маркетплейса как «продавца магазина» без store —
    // продавец неизвестен, маркетплейс известен отдельно.
    return { seller_title: null, seller_known: false, seller_note: 'store_title missing' };
  }
  return {
    seller_title: null,
    seller_known: false,
    seller_note: mpIsChannel ? 'marketplace_title is channel label, not seller' : 'seller unknown',
  };
}

function offerDedupeKey(entry) {
  const provider = String((entry && entry.provider) || PROVIDER);
  const mp = String((entry && entry.marketplace_key) || 'unknown');
  const recordId =
    entry && entry.source_record_id != null && String(entry.source_record_id).trim()
      ? String(entry.source_record_id).trim()
      : entry && entry.product_id != null
        ? 'pid:' + String(entry.product_id)
        : null;
  if (!recordId) return null;
  return provider + '|' + mp + '|' + recordId;
}

function catalogPublicId(entry) {
  const provider = String((entry && entry.provider) || PROVIDER)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '') || PROVIDER;
  const sid = entry && entry.source_id != null ? String(entry.source_id) : '0';
  const mp = String((entry && entry.marketplace_key) || 'unknown');
  const pid =
    entry && entry.product_id != null
      ? String(entry.product_id)
      : entry && entry.source_record_id
        ? String(entry.source_record_id)
        : 'na';
  return provider + ':' + sid + ':' + mp + ':' + pid;
}

/** Старый id без marketplace → кандидаты для сопоставления. */
function legacyPublicId(entry) {
  const sid = entry && entry.source_id != null ? String(entry.source_id) : '0';
  const pid =
    entry && entry.product_id != null
      ? String(entry.product_id)
      : entry && (entry.id || entry.source_record_id)
        ? String(entry.id || entry.source_record_id)
        : null;
  if (!pid) return null;
  return 'takprodam:' + sid + ':' + pid;
}

/**
 * Нормализация уже замапленной записи (после mapRawProduct) → v2.
 */
function normalizeEntry(mapped, extras) {
  const ex = extras || {};
  const marketplaceTitle = nonempty(mapped.marketplace)
    ? String(mapped.marketplace).trim()
    : nonempty(ex.marketplaceSlug)
      ? String(ex.marketplaceSlug).trim()
      : null;
  const marketplaceKey = marketplaceKeyFromTitle(marketplaceTitle, ex.marketplaceSlug);
  const seller = resolveSeller(marketplaceTitle, mapped.store_title);
  const sourceRecordId =
    mapped.id != null && String(mapped.id).trim() ? String(mapped.id).trim() : null;

  const entry = {
    schema_version: SCHEMA_VERSION,
    provider: PROVIDER,
    source_id: mapped.source_id,
    marketplace_key: marketplaceKey,
    marketplace_title: marketplaceTitle,
    marketplace_slug_requested: ex.marketplaceSlug || null,
    seller_title: seller.seller_title,
    seller_known: seller.seller_known,
    seller_note: seller.seller_note,
    // исходные поля продавца/магазина сохраняем
    store_title: nonempty(mapped.store_title) ? String(mapped.store_title).trim() : null,
    source_record_id: sourceRecordId,
    product_id: mapped.product_id != null ? mapped.product_id : null,
    sku: mapped.sku || null,
    // модель/вариант: без догадок — только то, что дал источник
    title: mapped.title || null,
    variant_key: null,
    image_url: mapped.image_url || null,
    price: mapped.price != null ? mapped.price : null,
    currency: mapped.currency || null,
    currency_basis: mapped.currency_basis || null,
    category_id: mapped.category_id != null ? mapped.category_id : null,
    category_title: mapped.category_title || null,
    external_link: mapped.external_link || null,
    tracking_link: mapped.tracking_link || null,
    product_url: mapped.external_link || null,
    affiliate_url: mapped.tracking_link || null,
    legal_text: mapped.legal_text || null,
    external_host: hostOf(mapped.external_link),
    image_host: hostOf(mapped.image_url),
    source_updated_at: mapped.source_updated_at || null,
    fetched_at: mapped.fetched_at || null,
    field_origin: {
      marketplace_title: 'takprodam.product.marketplace_title|request_slug',
      store_title: 'takprodam.product.store_title',
      price: 'takprodam.product.price',
      currency: mapped.currency ? 'assumed_or_source' : 'absent_in_source',
      external_link: 'takprodam.product.external_link',
      tracking_link: 'takprodam.product.tracking_link',
      legal_text: 'takprodam.product.legal_text',
      image_url: 'takprodam.product.image_url',
    },
    // совместимость со старым поиском
    source: PROVIDER,
    marketplace: marketplaceTitle,
    id: sourceRecordId,
  };

  if (mapped._commission != null) entry._commission = mapped._commission;
  return entry;
}

function emptyMarketplaceStatus(key) {
  return {
    marketplace_key: key,
    status: 'never_imported',
    last_attempt_at: null,
    last_success_at: null,
    last_error: null,
    outcome: null,
    total_count_api: null,
    total_count_scope: null,
    pages_fetched: 0,
    fetched: 0,
    admitted: 0,
    excluded: 0,
    exclusion_counts: {},
    active_items: 0,
    limit_note: null,
  };
}

function migrateCatalogToV2(raw) {
  const idAliases = {};
  if (!raw || typeof raw !== 'object') {
    return {
      catalog: {
        schema_version: SCHEMA_VERSION,
        provider: PROVIDER,
        source_id: null,
        items: [],
        marketplaces: {},
        id_aliases: {},
        fetched_at: null,
      },
      changed: true,
      idAliases,
    };
  }

  if (Number(raw.schema_version) === SCHEMA_VERSION && Array.isArray(raw.items)) {
    // уже v2 — дополним ключи у записей при необходимости
    let changed = false;
    const items = raw.items.map((it) => {
      if (it && it.marketplace_key && it.provider) return it;
      changed = true;
      const n = normalizeEntry(
        {
          ...it,
          marketplace: it.marketplace_title || it.marketplace,
          id: it.source_record_id || it.id,
        },
        { marketplaceSlug: it.marketplace_slug_requested || null }
      );
      const legacy = legacyPublicId(n);
      const next = catalogPublicId(n);
      if (legacy && legacy !== next) idAliases[legacy] = next;
      return n;
    });
    return {
      catalog: {
        ...raw,
        schema_version: SCHEMA_VERSION,
        provider: raw.provider || PROVIDER,
        items,
        marketplaces: raw.marketplaces || {},
        id_aliases: { ...(raw.id_aliases || {}), ...idAliases },
      },
      changed,
      idAliases,
    };
  }

  const items = [];
  for (const it of raw.items || []) {
    if (!it) continue;
    const n = normalizeEntry(
      {
        ...it,
        marketplace: it.marketplace_title || it.marketplace,
        id: it.id,
      },
      {}
    );
    const legacy = legacyPublicId(n);
    const next = catalogPublicId(n);
    if (legacy && legacy !== next) idAliases[legacy] = next;
    items.push(n);
  }

  const marketplaces = {};
  for (const it of items) {
    const k = it.marketplace_key || 'unknown';
    if (!marketplaces[k]) {
      marketplaces[k] = emptyMarketplaceStatus(k);
      marketplaces[k].status = 'migrated';
      marketplaces[k].last_success_at = raw.fetched_at || null;
      marketplaces[k].active_items = 0;
    }
    marketplaces[k].active_items += 1;
  }

  return {
    catalog: {
      schema_version: SCHEMA_VERSION,
      provider: PROVIDER,
      source: PROVIDER,
      source_id: raw.source_id != null ? raw.source_id : null,
      source_url: raw.source_url || null,
      status: raw.status || null,
      fetched_at: raw.fetched_at || null,
      import_note: raw.import_note || null,
      currency_policy: raw.currency_policy || null,
      counts: raw.counts || null,
      exclusion_counts: raw.exclusion_counts || null,
      marketplaces,
      id_aliases: idAliases,
      items,
    },
    changed: true,
    idAliases,
  };
}

/**
 * Решение по одному marketplace-срезу (те же исходы, что decideCatalogWrite).
 */
function decideMarketplaceWrite(input) {
  const { decideCatalogWrite } = require('./takprodam-import-policy');
  return decideCatalogWrite(input);
}

/**
 * Слить срез marketplace в каталог. При keepPreviousItems — не трогаем items этого ключа.
 */
function mergeMarketplaceIntoCatalog(catalog, marketplaceKey, slice) {
  const base = catalog && typeof catalog === 'object' ? { ...catalog } : {};
  base.schema_version = SCHEMA_VERSION;
  base.provider = PROVIDER;
  const key = String(marketplaceKey || 'unknown');
  const prevItems = Array.isArray(base.items) ? base.items.slice() : [];
  const others = prevItems.filter((it) => String(it.marketplace_key || '') !== key);
  const keptSame = prevItems.filter((it) => String(it.marketplace_key || '') === key);
  // При ошибке/validation-reject сохраняем прежние items этого marketplace.
  // При writeItems — заменяем срез (в т.ч. пустым при api_empty_success).
  const nextItems = slice.writeItems ? others.concat(slice.items || []) : others.concat(keptSame);

  const marketplaces = { ...(base.marketplaces || {}) };
  const previous = marketplaces[key] || emptyMarketplaceStatus(key);
  const incoming = { ...(slice.status || {}) };
  // Срез не записан — время прошлого успеха остаётся у сохранённых items.
  if (!slice.writeItems && previous.last_success_at && !incoming.last_success_at) {
    incoming.last_success_at = previous.last_success_at;
  }
  marketplaces[key] = {
    ...previous,
    ...incoming,
    marketplace_key: key,
    active_items: nextItems.filter((it) => String(it.marketplace_key || '') === key).length,
  };

  const successes = Object.values(marketplaces)
    .map((m) => m && m.last_success_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter(Number.isFinite);
  const fetchedAt =
    successes.length > 0
      ? new Date(Math.max.apply(null, successes)).toISOString()
      : base.fetched_at || null;

  // id aliases: legacy → new for written items
  const idAliases = { ...(base.id_aliases || {}) };
  for (const it of slice.items || []) {
    const legacy = legacyPublicId(it);
    const next = catalogPublicId(it);
    if (legacy && next) idAliases[legacy] = next;
  }

  return {
    ...base,
    items: nextItems,
    marketplaces,
    id_aliases: idAliases,
    fetched_at: fetchedAt,
    counts: {
      admitted: nextItems.length,
      by_marketplace: countByMarketplace(nextItems),
    },
  };
}

function countByMarketplace(items) {
  const out = {};
  for (const it of items || []) {
    const k = String((it && it.marketplace_key) || 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function buildCatalogStats(catalog) {
  const items = (catalog && catalog.items) || [];
  const active = items.filter((it) => it && !it.excluded);
  let noImage = 0;
  let noPrice = 0;
  let noCurrency = 0;
  let noLegal = 0;
  let noTracking = 0;
  for (const it of active) {
    if (!nonempty(it.image_url)) noImage += 1;
    if (!(typeof it.price === 'number' && Number.isFinite(it.price))) noPrice += 1;
    if (!nonempty(it.currency)) noCurrency += 1;
    if (!nonempty(it.legal_text)) noLegal += 1;
    if (!nonempty(it.tracking_link) && !nonempty(it.affiliate_url)) noTracking += 1;
  }
  return {
    schema_version: catalog && catalog.schema_version,
    provider: (catalog && catalog.provider) || PROVIDER,
    source_id: catalog && catalog.source_id,
    fetched_at: catalog && catalog.fetched_at,
    active_items: active.length,
    by_marketplace: countByMarketplace(active),
    marketplaces: catalog && catalog.marketplaces,
    gaps: {
      without_image: noImage,
      without_price: noPrice,
      without_currency: noCurrency,
      without_legal_text: noLegal,
      without_tracking: noTracking,
    },
    note: 'Not a full marketplace census. Counts reflect local limited catalog only.',
  };
}

/**
 * Реестр магазинов из небольшой выборки (не полный список).
 */
function upsertShopRegistry(registry, row) {
  const list = Array.isArray(registry) ? registry.slice() : [];
  const key = [
    String(row.marketplace_title || ''),
    String(row.store_title || ''),
    String(row.external_host || ''),
  ].join('|');
  const idx = list.findIndex((r) => r._key === key);
  const entry = {
    _key: key,
    marketplace_title: row.marketplace_title || null,
    store_title: row.store_title || null,
    seller_known: row.seller_known != null ? row.seller_known : null,
    seller_note: row.seller_note || null,
    external_host: row.external_host || null,
    has_image: !!row.has_image,
    has_price: !!row.has_price,
    currency_confirmed: !!row.currency_confirmed,
    has_tracking_link: !!row.has_tracking_link,
    has_legal_text: !!row.has_legal_text,
    discovery: row.discovery || null,
    technical_status: row.technical_status || 'seen_in_sample',
    sample_ids: row.sample_ids || [],
  };
  if (idx >= 0) {
    const prev = list[idx];
    entry.sample_ids = Array.from(new Set([].concat(prev.sample_ids || [], entry.sample_ids)));
    entry.has_image = prev.has_image || entry.has_image;
    entry.has_price = prev.has_price || entry.has_price;
    entry.currency_confirmed = prev.currency_confirmed || entry.currency_confirmed;
    entry.has_tracking_link = prev.has_tracking_link || entry.has_tracking_link;
    entry.has_legal_text = prev.has_legal_text || entry.has_legal_text;
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return list;
}

function publicShopRegistry(registry) {
  return (registry || []).map((r) => {
    const { _key, ...rest } = r;
    return rest;
  });
}

/**
 * Предложение из избранного есть в текущем каталоге.
 * Пустой каталог и неизвестный id — не подтверждены. Запись пользователя не меняется.
 */
function isSavedOfferCurrent(id, catalog) {
  const resolved = resolveSavedOfferId(id, catalog);
  const items = (catalog && catalog.items) || [];
  if (resolved.status === 'resolved_legacy') return true;
  if (resolved.status === 'ok' || resolved.status === 'aliased') {
    return items.some((it) => catalogPublicId(it) === resolved.id);
  }
  return false;
}

function resolveSavedOfferId(id, catalog) {
  const raw = String(id || '');
  if (!raw) return { id: raw, status: 'empty' };
  if (catalog && catalog.id_aliases && catalog.id_aliases[raw]) {
    return { id: catalog.id_aliases[raw], status: 'aliased' };
  }
  const items = (catalog && catalog.items) || [];
  if (items.some((it) => catalogPublicId(it) === raw)) {
    return { id: raw, status: 'ok' };
  }
  // legacy takprodam:sid:pid
  const m = /^takprodam:(\d+):([^:]+)$/.exec(raw);
  if (m) {
    const sid = m[1];
    const pid = m[2];
    const hits = items.filter(
      (it) =>
        String(it.source_id) === sid &&
        (String(it.product_id) === pid || String(it.source_record_id) === pid)
    );
    if (hits.length === 1) {
      return { id: catalogPublicId(hits[0]), status: 'resolved_legacy' };
    }
    if (hits.length > 1) {
      return { id: raw, status: 'ambiguous_legacy', candidates: hits.map(catalogPublicId) };
    }
    return { id: raw, status: 'unavailable' };
  }
  return { id: raw, status: items.length ? 'unavailable' : 'ok' };
}

module.exports = {
  SCHEMA_VERSION,
  PROVIDER,
  CHANNEL_LABEL_RE,
  marketplaceKeyFromTitle,
  resolveSeller,
  offerDedupeKey,
  catalogPublicId,
  legacyPublicId,
  normalizeEntry,
  emptyMarketplaceStatus,
  migrateCatalogToV2,
  decideMarketplaceWrite,
  mergeMarketplaceIntoCatalog,
  buildCatalogStats,
  upsertShopRegistry,
  publicShopRegistry,
  resolveSavedOfferId,
  isSavedOfferCurrent,
  hostOf,
  countByMarketplace,
};
