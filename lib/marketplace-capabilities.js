'use strict';

/**
 * Единый слой паспортов возможностей площадок.
 * Источник истины — data/sources.json (+ опционально data/marketplace-fixtures.json).
 * Не ходит во внешнюю сеть.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const CRITERIA_KEYS = [
  'price_min',
  'price_max',
  'category',
  'size',
  'color',
  'brand',
  'features',
  'sort_price_asc',
  'sort_price_desc',
  'delivery_fastest',
];

const PRICE_SORT_DEFAULT = 'default';
const PRICE_SORT_ASC = 'asc';
const PRICE_SORT_DESC = 'desc';
const PRICE_SORTS = new Set([PRICE_SORT_DEFAULT, PRICE_SORT_ASC, PRICE_SORT_DESC]);

const DELIVERY_PREFERENCE_ANY = 'any';
const DELIVERY_PREFERENCE_FASTEST = 'fastest';
const DELIVERY_PREFERENCES = new Set([DELIVERY_PREFERENCE_ANY, DELIVERY_PREFERENCE_FASTEST]);
const DELIVERY_FASTEST_KINDS = new Set(['filter', 'sort']);

function normalizePriceSort(raw) {
  if (raw == null || raw === '') return null;
  const v = String(raw).trim();
  if (!PRICE_SORTS.has(v)) return null;
  return v;
}

/**
 * Единый price_sort. Явное price_sort имеет приоритет над prefer_cheaper.
 * prefer_cheaper true → asc; false/отсутствие → default.
 */
function resolvePriceSort(input) {
  const src = input && typeof input === 'object' ? input : {};
  const hasExplicit =
    Object.prototype.hasOwnProperty.call(src, 'price_sort')
    && src.price_sort != null
    && String(src.price_sort).trim() !== '';
  if (hasExplicit) {
    const normalized = normalizePriceSort(src.price_sort);
    if (!normalized) {
      return { ok: false, error_kind: 'invalid_price_sort_value', priceSort: PRICE_SORT_DEFAULT };
    }
    return { ok: true, priceSort: normalized };
  }
  if (src.prefer_cheaper === true || src.preferCheaper === true) {
    return { ok: true, priceSort: PRICE_SORT_ASC };
  }
  return { ok: true, priceSort: PRICE_SORT_DEFAULT };
}

/**
 * Подтверждённая URL-сортировка «сначала дешевле».
 * Без sort_price_asc_verified + param + value — не применяем (не выдумываем).
 */
function sortPriceAscAllowed(source) {
  if (!source || source.verified === false) return false;
  if (source.sort_price_asc_verified !== true) return false;
  const param = source.sort_price_asc_param;
  const value = source.sort_price_asc_value;
  if (!param || value == null || String(value).trim() === '') return false;
  const caps = source.filter_capabilities || {};
  if (caps.sort_price_asc === 'disabled' || caps.sort_price_asc === 'unsupported') {
    return false;
  }
  return true;
}

/**
 * Подтверждённая URL-сортировка «сначала дороже» — отдельно от asc.
 */
function sortPriceDescAllowed(source) {
  if (!source || source.verified === false) return false;
  if (source.sort_price_desc_verified !== true) return false;
  const param = source.sort_price_desc_param;
  const value = source.sort_price_desc_value;
  if (!param || value == null || String(value).trim() === '') return false;
  const caps = source.filter_capabilities || {};
  if (caps.sort_price_desc === 'disabled' || caps.sort_price_desc === 'unsupported') {
    return false;
  }
  return true;
}

function anyVerifiedSortPriceAsc(sources) {
  const list = Array.isArray(sources) ? sources : loadSources();
  return list.some((s) => sortPriceAscAllowed(s));
}

function anyVerifiedSortPriceDesc(sources) {
  const list = Array.isArray(sources) ? sources : loadSources();
  return list.some((s) => sortPriceDescAllowed(s));
}

function anyVerifiedPriceSort(sources) {
  return anyVerifiedSortPriceAsc(sources) || anyVerifiedSortPriceDesc(sources);
}

/**
 * Подтверждённая быстрая доставка в URL.
 * kind: "filter" (конкретный фильтр) или "sort" (сортировка по сроку) — не смешивать смыслы.
 */
function deliveryFastestAllowed(source) {
  if (!source || source.verified === false) return false;
  if (source.delivery_fastest_verified !== true) return false;
  const kind = source.delivery_fastest_kind;
  if (!DELIVERY_FASTEST_KINDS.has(kind)) return false;
  const param = source.delivery_fastest_param;
  const value = source.delivery_fastest_value;
  if (!param || value == null || String(value).trim() === '') return false;
  const caps = source.filter_capabilities || {};
  if (caps.delivery_fastest === 'disabled' || caps.delivery_fastest === 'unsupported') {
    return false;
  }
  return true;
}

function deliveryFastestIsSort(source) {
  return deliveryFastestAllowed(source) && source.delivery_fastest_kind === 'sort';
}

function deliveryFastestIsFilter(source) {
  return deliveryFastestAllowed(source) && source.delivery_fastest_kind === 'filter';
}

/**
 * Две сортировки нельзя подставить одним параметром / перезаписывать друг друга.
 * priceSort: default|asc|desc (prefer_cheaper true трактуется как asc на вызывающей стороне).
 */
function sortPreferencesConflict(source, priceSortOrPreferCheaper, deliveryPreference) {
  if (deliveryPreference !== DELIVERY_PREFERENCE_FASTEST) return false;
  if (!deliveryFastestIsSort(source)) return false;
  let priceSort = PRICE_SORT_DEFAULT;
  if (priceSortOrPreferCheaper === true) priceSort = PRICE_SORT_ASC;
  else if (typeof priceSortOrPreferCheaper === 'string') {
    priceSort = normalizePriceSort(priceSortOrPreferCheaper) || PRICE_SORT_DEFAULT;
  }
  if (priceSort === PRICE_SORT_ASC) return sortPriceAscAllowed(source);
  if (priceSort === PRICE_SORT_DESC) return sortPriceDescAllowed(source);
  return false;
}

function anyVerifiedDeliveryFastest(sources) {
  const list = Array.isArray(sources) ? sources : loadSources();
  return list.some((s) => deliveryFastestAllowed(s));
}

function normalizeDeliveryPreference(raw) {
  if (raw == null || raw === '') return DELIVERY_PREFERENCE_ANY;
  const v = String(raw).trim();
  if (!DELIVERY_PREFERENCES.has(v)) return null;
  return v;
}

/** Нормализация статусов передачи (смысл → канон). */
const TRANSFER = {
  verified_browser: 'native_filter',
  verified_url: 'native_filter',
  url_unverified: 'unconfirmed',
  unverified: 'unconfirmed',
  in_query_only: 'in_query',
  manual: 'manual',
  unsupported: 'unsupported',
  unknown: 'unconfirmed',
  disabled: 'disabled',
  native_filter: 'native_filter',
  in_query: 'in_query',
};

const VERIFY_LEVEL = {
  native_filter: 'browser_filter_value',
  verified_browser: 'browser_filter_value',
  verified_url: 'url_generation',
  url_unverified: 'format_claimed',
  unverified: 'format_claimed',
  in_query_only: 'in_query',
  in_query: 'in_query',
  manual: 'manual',
  unsupported: 'unsupported',
  unknown: 'unconfirmed',
  disabled: 'disabled',
};

function loadJson(rel) {
  const full = path.join(ROOT, rel);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function loadSources() {
  return loadJson('data/sources.json');
}

function loadFixtures() {
  try {
    return loadJson('data/marketplace-fixtures.json');
  } catch (_) {
    return { version: 1, fixtures: [] };
  }
}

function disabledSet(source) {
  const list = Array.isArray(source.disabled_filters) ? source.disabled_filters : [];
  return new Set(list.map(String));
}

function isFilterEnabled(source, key) {
  if (disabledSet(source).has(key)) return false;
  if (key === 'price_min' && disabledSet(source).has('price')) return false;
  if (key === 'price_max' && disabledSet(source).has('price')) return false;
  const caps = source.filter_capabilities || {};
  const raw = caps[key];
  if (raw === 'disabled') return false;
  return true;
}

/**
 * Может ли адаптер реально подставить URL-фильтр цены (не только «заявлено»).
 */
function adapterImplementsPrice(source, which) {
  if (!isFilterEnabled(source, which === 'min' ? 'price_min' : 'price_max')) return false;
  if ((source.price_currency || 'RUB') !== 'RUB') return false;
  if (which === 'min') {
    return source.price_min_filter_verified === true && !!(source.price_min_param);
  }
  return (
    source.price_filter_verified === true
    && !!(source.price_max_param || source.price_param)
  );
}

function criterionPassport(source, key) {
  const caps = source.filter_capabilities || {};
  const raw = caps[key] || 'unknown';
  const disabled = !isFilterEnabled(source, key);
  const transfer = disabled ? 'disabled' : TRANSFER[raw] || 'unconfirmed';
  let implemented = 'none';
  if (disabled) implemented = 'disabled';
  else if (key === 'price_min') {
    implemented = adapterImplementsPrice(source, 'min') ? 'url_param' : transfer === 'in_query' ? 'in_query' : 'manual_or_none';
  }   else if (key === 'price_max') {
    implemented = adapterImplementsPrice(source, 'max') ? 'url_param' : transfer === 'in_query' ? 'in_query' : 'manual_or_none';
  } else if (key === 'sort_price_asc') {
    implemented = sortPriceAscAllowed(source) ? 'url_param' : transfer === 'unsupported' ? 'unsupported' : 'unconfirmed';
  } else if (key === 'sort_price_desc') {
    implemented = sortPriceDescAllowed(source) ? 'url_param' : transfer === 'unsupported' ? 'unsupported' : 'unconfirmed';
  } else if (key === 'delivery_fastest') {
    implemented = deliveryFastestAllowed(source) ? 'url_param' : transfer === 'unsupported' ? 'unsupported' : 'unconfirmed';
  } else if (transfer === 'in_query') implemented = 'in_query';
  else if (transfer === 'manual' || transfer === 'unsupported') implemented = transfer;
  else implemented = 'unconfirmed';

  const checks = source.verification || {};
  const fieldCheck = checks[key] || null;
  const kind =
    key === 'delivery_fastest' && source.delivery_fastest_kind
      ? source.delivery_fastest_kind
      : null;

  return {
    key,
    declared: raw,
    transfer,
    implemented,
    verification_level: disabled ? 'disabled' : VERIFY_LEVEL[raw] || 'unconfirmed',
    verified_at: fieldCheck && fieldCheck.at ? fieldCheck.at : null,
    verified_how: fieldCheck && fieldCheck.how ? fieldCheck.how : null,
    multi: caps.multi === true,
    note: fieldCheck && fieldCheck.note ? fieldCheck.note : null,
    kind,
  };
}

function sourcePassport(source) {
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    criteria[key] = criterionPassport(source, key);
  }
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    shown_to_user: source.verified === true,
    disabled_reason: source.disabled_reason || (source.verified === false ? (source.verification_note || null) : null),
    currency: source.price_currency || null,
    url_template: source.url_template || null,
    disabled_filters: [...disabledSet(source)],
    criteria,
    verification_note: source.verification_note || null,
  };
}

function buildReport() {
  const sources = loadSources();
  const fixtures = loadFixtures();
  const passports = sources.map(sourcePassport);
  const issues = [];

  for (const p of passports) {
    const src = sources.find((s) => s.id === p.id);
    for (const key of CRITERIA_KEYS) {
      const c = p.criteria[key];
      if (c.declared === 'verified_browser' && c.implemented !== 'url_param' && (key === 'price_min' || key === 'price_max')) {
        issues.push({
          id: p.id,
          kind: 'config_adapter_mismatch',
          message: `${key}: declared verified_browser but adapter will not apply URL param`,
        });
      }
      if ((key === 'price_min' || key === 'price_max') && c.implemented === 'url_param' && !c.verified_at) {
        // не ошибка — дата может быть только в verification_note
      }
    }
    if (src.price_min_filter_verified && !src.price_min_param) {
      issues.push({ id: p.id, kind: 'config', message: 'price_min_filter_verified without price_min_param' });
    }
  }

  const bySource = {};
  for (const f of fixtures.fixtures || []) {
    bySource[f.source_id] = bySource[f.source_id] || [];
    bySource[f.source_id].push(f.id);
  }
  for (const p of passports) {
    if (p.shown_to_user && !(bySource[p.id] || []).length) {
      issues.push({ id: p.id, kind: 'missing_fixtures', message: 'нет эталонных fixtures' });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    schema_version: 1,
    sources: passports,
    fixture_count: (fixtures.fixtures || []).length,
    fixtures_by_source: bySource,
    issues,
  };
}

/**
 * Учитывает disabled_filters при решении о URL-цене (для links.js).
 */
function priceUrlAllowed(source, which) {
  return adapterImplementsPrice(source, which);
}

module.exports = {
  CRITERIA_KEYS,
  TRANSFER,
  PRICE_SORT_DEFAULT,
  PRICE_SORT_ASC,
  PRICE_SORT_DESC,
  PRICE_SORTS,
  DELIVERY_PREFERENCE_ANY,
  DELIVERY_PREFERENCE_FASTEST,
  DELIVERY_PREFERENCES,
  DELIVERY_FASTEST_KINDS,
  loadSources,
  loadFixtures,
  sourcePassport,
  buildReport,
  isFilterEnabled,
  priceUrlAllowed,
  sortPriceAscAllowed,
  sortPriceDescAllowed,
  anyVerifiedSortPriceAsc,
  anyVerifiedSortPriceDesc,
  anyVerifiedPriceSort,
  deliveryFastestAllowed,
  deliveryFastestIsSort,
  deliveryFastestIsFilter,
  sortPreferencesConflict,
  anyVerifiedDeliveryFastest,
  normalizeDeliveryPreference,
  normalizePriceSort,
  resolvePriceSort,
  disabledSet,
};
