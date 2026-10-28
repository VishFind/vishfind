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
];

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
  } else if (key === 'price_max') {
    implemented = adapterImplementsPrice(source, 'max') ? 'url_param' : transfer === 'in_query' ? 'in_query' : 'manual_or_none';
  } else if (transfer === 'in_query') implemented = 'in_query';
  else if (transfer === 'manual' || transfer === 'unsupported') implemented = transfer;
  else implemented = 'unconfirmed';

  const checks = source.verification || {};
  const fieldCheck = checks[key] || null;

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
  loadSources,
  loadFixtures,
  sourcePassport,
  buildReport,
  isFilterEnabled,
  priceUrlAllowed,
  disabledSet,
};
