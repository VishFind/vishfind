'use strict';

/**
 * Выбор и приоритет источников под запрос.
 * Кандидаты не выдаются как подключённые магазины.
 *
 * Пользовательские группы выдачи (display_group):
 * 1 official — официальный сайт указанного/распознанного бренда
 * 2 other — Lamoda, Авито, own-brand витрины без указанного бренда, прочие
 * 3 marketplace_tail — Ozon → Wildberries → Яндекс Маркет
 * 4 reseller — реселлеры / ресейл (после основных площадок; не путать с Lamoda)
 */

const path = require('path');
const fs = require('fs');
const brandsApi = require('./brands');

const ROOT = path.join(__dirname, '..');

/** Ленивая загрузка, чтобы избежать цикла require с source-policy. */
function sourcePolicy() {
  return require('./source-policy');
}

/** Обязательная последняя тройка (порядок фиксирован). */
const MANDATORY_TAIL_IDS = ['ozon', 'wildberries', 'yandex_market'];

/** Площадки группы 3 (тип источника может быть reseller/classifieds). */
const GROUP3_IDS = new Set(['lamoda_ru', 'avito', 'youla']);

const DISPLAY_GROUP_ORDER = ['official', 'other', 'marketplace_tail', 'reseller'];

const DISPLAY_GROUP_LABELS = {
  official: 'Официальный магазин бренда',
  reseller: 'Реселлеры и ресейл',
  other: 'Другие места поиска',
  marketplace_tail: 'Маркетплейсы',
};

const ACTIVE_STATUSES = new Set(['search_link', 'products_connected']);

/** Сохраняем старые константы для тестов/совместимости. */
const GROUP_ORDER_WITH_BRAND = [
  'brand_official',
  'ru_reseller',
  'foreign_reseller',
  'classifieds',
  'chinese_marketplace',
  'mass_marketplace',
];

const GROUP_ORDER_NO_BRAND = [
  'ru_reseller',
  'brand_official',
  'foreign_reseller',
  'classifieds',
  'chinese_marketplace',
  'mass_marketplace',
];

function loadRegistry() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/source-registry.json'), 'utf8')
  );
  return raw;
}

function groupOf(src) {
  const t = src.type;
  if (t === 'brand_official') return 'brand_official';
  if (t === 'classifieds') return 'classifieds';
  if (t === 'chinese_marketplace') return 'chinese_marketplace';
  if (t === 'mass_marketplace') return 'mass_marketplace';
  if (t === 'reseller' || t === 'authorized_reseller' || t === 'vintage') {
    return src.region === 'RU' ? 'ru_reseller' : 'foreign_reseller';
  }
  return 'mass_marketplace';
}

function brandsOf(parsed) {
  const list = [];
  if (Array.isArray(parsed.brands)) list.push(...parsed.brands);
  if (parsed.brand) list.push(parsed.brand);
  return [...new Set(list.map((b) => String(b).trim()).filter(Boolean))];
}

/** Расширение связанными брендами (Jordan→Nike), без раздувания чужими. */
function expandWantedBrands(wanted) {
  const out = [];
  const seen = new Set();
  for (const w of wanted) {
    const key = String(w).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
    const b = brandsApi.findBrand(w);
    if (!b || !Array.isArray(b.related)) continue;
    for (const rel of b.related) {
      const rb = brandsApi.findBrand(rel) || { name: rel };
      const rk = String(rb.name || rel).toLowerCase();
      if (seen.has(rk)) continue;
      seen.add(rk);
      out.push(rb.name || rel);
    }
  }
  return out;
}

function brandMatches(src, wanted) {
  if (!wanted.length) return true;
  const own = (src.brands || []).map((b) => String(b).toLowerCase());
  if (!own.length) return true; // универсальные площадки
  return wanted.some((w) => {
    const wl = String(w).toLowerCase();
    if (own.includes(wl)) return true;
    const wb = brandsApi.findBrand(w);
    if (!wb) return false;
    const aliases = [wb.name, wb.id, ...(wb.aliases || [])].map((a) =>
      String(a).toLowerCase()
    );
    return own.some((o) => aliases.includes(o));
  });
}

function domainKey(d) {
  return String(d || '')
    .toLowerCase()
    .replace(/^www\./, '');
}

function isOwnBrandStore(src) {
  return !!(src && src.own_brand);
}

function isMandatoryTail(src) {
  if (!src) return false;
  if (MANDATORY_TAIL_IDS.includes(src.id)) return true;
  if (src.adapter_ref && MANDATORY_TAIL_IDS.includes(src.adapter_ref)) return true;
  return false;
}

/**
 * Неизвестный бренд ≠ «бренд отсутствует».
 * Латинский токен в rest/query, не найденный в реестре.
 */
function detectUnknownBrandIntent(parsed, wanted) {
  if (wanted.length) return false;
  if (Array.isArray(parsed.unknown_brands) && parsed.unknown_brands.length) return true;
  const chunks = [
    String(parsed.rest || ''),
    String(parsed.query || ''),
    String(parsed.raw_query || ''),
  ];
  const text = chunks.join(' ');
  const tokens = text.match(/[A-Za-z][A-Za-z0-9&'.-]{2,}/g) || [];
  for (const t of tokens) {
    if (brandsApi.findBrand(t)) continue;
    // Стоп-слова / общие англ. термины одежды — не бренд.
    if (
      /^(hoodie|hoodies|jacket|jackets|jeans|sneakers|shoes|dress|shirt|pants|coat|bag|bags|size|black|white|blue|red|green|the|and|or|for|with|new|men|women|kids)$/i.test(
        t
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function categoryMatches(src, parsed) {
  const want = []
    .concat(parsed.categories || [], parsed.category || [])
    .map((c) => String(c).toLowerCase().trim())
    .filter(Boolean);
  if (!want.length) return true;
  const have = (src.categories || []).map((c) => String(c).toLowerCase());
  if (!have.length) return true;
  // Грубая совместимость одежды: casual/sport/women/men ↔ типичные категории запроса
  const clothingBucket = new Set([
    'casual',
    'sport',
    'sneakers',
    'women',
    'men',
    'kids',
    'outerwear',
    'footwear',
    'own_brand',
    'ru',
  ]);
  const srcClothing = have.some((h) => clothingBucket.has(h));
  if (srcClothing) return true;
  return want.some((w) => have.includes(w));
}

function displayGroupOf(src, ctx) {
  if (isMandatoryTail(src)) return 'marketplace_tail';
  if (GROUP3_IDS.has(src.id)) return 'other';
  if (src.type === 'brand_official') {
    if (ctx.hasKnownBrand && brandMatches(src, ctx.wanted)) return 'official';
    if (isOwnBrandStore(src) && !ctx.hasKnownBrand && !ctx.unknownBrand) return 'other';
    return 'official';
  }
  if (src.type === 'reseller' || src.type === 'authorized_reseller' || src.type === 'vintage') {
    return 'reseller';
  }
  if (src.type === 'classifieds') return 'other';
  if (src.type === 'chinese_marketplace') return 'other';
  if (src.type === 'mass_marketplace') return 'other';
  return 'other';
}

function annotateDisplay(src, group) {
  return {
    ...src,
    display_group: group,
    display_group_order: DISPLAY_GROUP_ORDER.indexOf(group) + 1,
    display_group_label: DISPLAY_GROUP_LABELS[group] || group,
  };
}

function sortWithinGroup(list) {
  list.sort((a, b) => {
    const trustRank = (t) =>
      ({
        official_store: 0,
        authorized_reseller: 1,
        reseller_described: 2,
        classifieds_platform: 3,
        mass_marketplace: 4,
        unverified: 5,
      }[t] ?? 6);
    const tr = trustRank(a.trust_level) - trustRank(b.trust_level);
    if (tr !== 0) return tr;
    const del = (d) => (d === 'confirmed' ? 0 : d === 'unknown' ? 1 : 2);
    return del(a.delivery_to_ru) - del(b.delivery_to_ru);
  });
}

/** Официальный ориентир из brand-registry, если в source-registry нет search_link. */
function officialFromBrandRegistry(wanted, alreadyIds, alreadyDomains) {
  const extras = [];
  const domains = alreadyDomains || new Set();
  for (const w of wanted) {
    const b = brandsApi.findBrand(w);
    if (!b || !b.domain) continue;
    const id = 'brand_official_' + b.id;
    if (alreadyIds.has(id) || alreadyIds.has(b.id)) continue;
    const dk = domainKey(b.domain);
    if (domains.has(dk)) continue;
    extras.push({
      id,
      name: b.name,
      domain: b.domain,
      type: 'brand_official',
      region: b.region || 'INTL',
      storefront_region: b.storefront_region || null,
      brand_origin: b.brand_origin || null,
      currency: null,
      brands: [b.name, ...(b.aliases || []).slice(0, 4)],
      own_brand: true,
      delivery_to_ru: 'unknown',
      data_mode: 'none',
      connection_status: 'identity_checked',
      trust_level: 'official_store',
      trust_basis:
        b.identification_basis
        || 'Домен из реестра брендов (identity_checked). Не найденный товар и не подтверждённая доставка в РФ.',
      checked_at: b.checked_at || null,
      url_template: null,
      link_kind: 'official_store_entry',
      note: 'Официальный сайт бренда (не найденный товар).',
    });
    alreadyIds.add(id);
    domains.add(dk);
  }
  return extras;
}

function passesBrandGate(s, ctx) {
  const { wanted, hasKnownBrand, unknownBrand } = ctx;

  // Собственный бренд магазина
  if (isOwnBrandStore(s) || s.type === 'brand_official') {
    if (hasKnownBrand) {
      // Только если продаёт указанный бренд (свой).
      return brandMatches(s, wanted);
    }
    if (unknownBrand) {
      // Неизвестный бренд ≠ пустой: не подставляем чужие own-brand витрины.
      return false;
    }
    // Бренд не указан: own_brand — по категории; прочие brand_official (Nike.com и т.п.) — нет.
    if (isOwnBrandStore(s)) return categoryMatches(s, ctx.parsed);
    return false;
  }

  // Универсальные площадки при известном бренде — ок (пустой brands[]).
  if (hasKnownBrand && Array.isArray(s.brands) && s.brands.length && !brandMatches(s, wanted)) {
    return false;
  }
  return true;
}

/**
 * @param {object} parsed
 * @param {{ maxSources?: number, includeCandidates?: boolean }} [opts]
 */
function selectSources(parsed, opts) {
  const maxOptional = (opts && opts.maxSources) || 8;
  const includeCandidates = !!(opts && opts.includeCandidates);
  const reg = loadRegistry();
  const wantedRaw = brandsOf(parsed || {});
  const wanted = expandWantedBrands(wantedRaw);
  const hasKnownBrand = wanted.length > 0;
  const unknownBrand = detectUnknownBrandIntent(parsed || {}, wanted);
  const ctx = {
    parsed: parsed || {},
    wanted,
    hasKnownBrand,
    unknownBrand,
  };

  const usable = (reg.sources || []).filter((s) => {
    if (s.connection_status === 'disabled' || s.connection_status === 'temporarily_limited') {
      return false;
    }
    if (!sourcePolicy().outboundLinkAllowed(s) && ACTIVE_STATUSES.has(s.connection_status)) {
      if (s.connection_status === 'search_link' || s.connection_status === 'products_connected') {
        return false;
      }
    }
    if (!includeCandidates && !ACTIVE_STATUSES.has(s.connection_status)) {
      // Официальный с url_template при совпадении бренда — можно в optional.
      if (
        hasKnownBrand
        && s.type === 'brand_official'
        && brandMatches(s, wanted)
        && s.url_template
        && (s.connection_status === 'identity_checked' || s.url_template)
      ) {
        return passesBrandGate(s, ctx);
      }
      return false;
    }
    return passesBrandGate(s, ctx);
  });

  const buckets = {
    official: [],
    reseller: [],
    other: [],
    marketplace_tail: [],
  };

  for (const s of usable) {
    const g = displayGroupOf(s, ctx);
    buckets[g].push(s);
  }

  for (const g of DISPLAY_GROUP_ORDER) sortWithinGroup(buckets[g]);

  // В группе 3: сначала Lamoda/Авито, затем ограниченный набор own-brand (не только LIMÉ/MAAG).
  if (buckets.other.length) {
    const platforms = [];
    const own = [];
    const rest = [];
    for (const s of buckets.other) {
      if (GROUP3_IDS.has(s.id)) platforms.push(s);
      else if (isOwnBrandStore(s)) own.push(s);
      else rest.push(s);
    }
    // Лёгкая ротация own-brand по длине фразы — стабильно, без запросов к магазинам.
    const seed = String((parsed && parsed.search_phrase) || '').length;
    if (own.length > 1) {
      const rot = seed % own.length;
      own.push(...own.splice(0, rot));
    }
    const PLATFORM_ORDER = ['lamoda_ru', 'avito', 'youla'];
    platforms.sort((a, b) => PLATFORM_ORDER.indexOf(a.id) - PLATFORM_ORDER.indexOf(b.id));
    const OWN_BRAND_CAP = 3;
    buckets.other = platforms.concat(own.slice(0, OWN_BRAND_CAP), rest);
  }

  // Фиксированный порядок тройки
  buckets.marketplace_tail.sort((a, b) => {
    return MANDATORY_TAIL_IDS.indexOf(a.id) - MANDATORY_TAIL_IDS.indexOf(b.id);
  });

  const selected = [];
  const selectedIds = new Set();
  const selectedDomains = new Set();

  function take(list, limit) {
    for (const s of list) {
      if (selected.length >= limit) break;
      if (selectedIds.has(s.id)) continue;
      selected.push(annotateDisplay(s, displayGroupOf(s, ctx)));
      selectedIds.add(s.id);
      if (s.domain) selectedDomains.add(domainKey(s.domain));
    }
  }

  // Лимит только на необязательные: сначала Lamoda/Авито (other), ресейл — позже
  take(buckets.official, maxOptional);
  take(buckets.other, maxOptional);
  take(buckets.reseller, maxOptional);

  // Официальные extras для известных брендов, ещё не попавших в selected
  const officialExtras = [];
  if (hasKnownBrand) {
    for (const s of reg.sources || []) {
      if (s.type !== 'brand_official') continue;
      if (!brandMatches(s, wanted)) continue;
      if (selectedIds.has(s.id)) continue;
      if (
        s.connection_status === 'temporarily_limited'
        || s.connection_status === 'disabled'
      ) {
        continue;
      }
      if (!sourcePolicy().outboundLinkAllowed(s) && ACTIVE_STATUSES.has(s.connection_status)) {
        continue;
      }
      if (s.domain) {
        officialExtras.push(
          annotateDisplay(
            {
              ...s,
              link_kind: 'official_store_entry',
              note: 'Официальный сайт бренда (не найденный товар).',
            },
            'official'
          )
        );
        selectedIds.add(s.id);
        selectedDomains.add(domainKey(s.domain));
      }
    }
    for (const extra of officialFromBrandRegistry(wanted, selectedIds, selectedDomains)) {
      officialExtras.push(annotateDisplay(extra, 'official'));
    }
  }

  // Обязательная тройка — вне лимита optional, без дублей
  const mandatory = [];
  for (const id of MANDATORY_TAIL_IDS) {
    const s = (reg.sources || []).find((x) => x.id === id);
    if (!s) continue;
    if (s.connection_status === 'disabled' || s.connection_status === 'temporarily_limited') {
      continue;
    }
    if (!sourcePolicy().outboundLinkAllowed(s)) continue;
    if (!ACTIVE_STATUSES.has(s.connection_status) && !includeCandidates) continue;
    if (selectedIds.has(s.id)) {
      // Уже попал в other — перенесём в хвост при финальной сортировке через annotate
      continue;
    }
    mandatory.push(annotateDisplay(s, 'marketplace_tail'));
    selectedIds.add(s.id);
    if (s.domain) selectedDomains.add(domainKey(s.domain));
  }

  // Если тройка уже была среди selected (редко) — помечаем хвостом
  const normalized = selected.map((s) => {
    if (isMandatoryTail(s)) return annotateDisplay(s, 'marketplace_tail');
    return s;
  });

  const withoutTail = normalized.filter((s) => s.display_group !== 'marketplace_tail');
  const tailFromSelected = normalized.filter((s) => s.display_group === 'marketplace_tail');
  const tailIds = new Set(tailFromSelected.map((s) => s.id));
  for (const m of mandatory) {
    if (!tailIds.has(m.id)) {
      tailFromSelected.push(m);
      tailIds.add(m.id);
    }
  }
  tailFromSelected.sort(
    (a, b) => MANDATORY_TAIL_IDS.indexOf(a.id) - MANDATORY_TAIL_IDS.indexOf(b.id)
  );

  const officialPart = withoutTail.filter((s) => s.display_group === 'official');
  const otherPart = withoutTail.filter((s) => s.display_group === 'other');
  const resellerPart = withoutTail.filter((s) => s.display_group === 'reseller');
  const restPart = withoutTail.filter(
    (s) => s.display_group !== 'official' && s.display_group !== 'other' && s.display_group !== 'reseller'
  );
  // Порядок: официальные → Lamoda/Авито/прочие → маркетплейсы → ресейл
  const finalSelected = officialPart
    .concat(otherPart, restPart, tailFromSelected, resellerPart);

  return {
    selected: finalSelected,
    officialExtras: officialExtras.slice(0, 6),
    wantedBrands: wanted,
    wantedBrandsRaw: wantedRaw,
    unknownBrandIntent: unknownBrand,
    registry_stats: stats(reg),
    display_group_labels: DISPLAY_GROUP_LABELS,
  };
}

function stats(reg) {
  const sources = reg.sources || [];
  const byStatus = {};
  for (const s of sources) {
    byStatus[s.connection_status] = (byStatus[s.connection_status] || 0) + 1;
  }
  return {
    total: sources.length,
    by_status: byStatus,
    active_search_link: sources.filter((s) => s.connection_status === 'search_link').length,
    products_connected: sources.filter((s) => s.connection_status === 'products_connected').length,
    own_brand_active: sources.filter(
      (s) => s.own_brand && ACTIVE_STATUSES.has(s.connection_status)
    ).length,
  };
}

/**
 * Собрать adapter sources.json записи для links-провайдера по выбранным registry id.
 */
function adaptersForSelection(selected, adapterSources) {
  const byId = new Map((adapterSources || []).map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  for (const s of selected) {
    const ref = s.adapter_ref;
    if (ref && byId.has(ref) && !seen.has(ref)) {
      const adapter = byId.get(ref);
      if (adapter.verified === false) continue;
      seen.add(ref);
      out.push({
        ...adapter,
        url_template: s.url_template || adapter.url_template,
        registry_id: s.id,
        trust_level: s.trust_level,
        source_type: s.type,
        result_kind: 'search_link',
        link_kind: s.link_kind || null,
        link_label: s.link_label || null,
        usage_policy: s.usage_policy || null,
        display_group: s.display_group || null,
        display_group_order: s.display_group_order || null,
        display_group_label: s.display_group_label || null,
        own_brand: !!s.own_brand,
      });
    } else if (s.url_template && !seen.has(s.id)) {
      seen.add(s.id);
      out.push({
        id: s.id,
        name: s.name,
        type: s.type === 'brand_official' ? 'official_store' : s.type,
        url_template: s.url_template,
        price_currency: s.currency || 'RUB',
        verified: s.connection_status === 'search_link' || s.connection_status === 'products_connected',
        price_filter_verified: false,
        price_min_filter_verified: false,
        filter_capabilities: {
          price_min: 'manual',
          price_max: 'manual',
          size: 'in_query_only',
          color: 'in_query_only',
          brand: 'in_query_only',
          features: 'in_query_only',
        },
        registry_id: s.id,
        trust_level: s.trust_level,
        source_type: s.type,
        result_kind: 'search_link',
        link_kind: s.link_kind || null,
        link_label: s.link_label || null,
        usage_policy: s.usage_policy || null,
        display_group: s.display_group || null,
        display_group_order: s.display_group_order || null,
        display_group_label: s.display_group_label || null,
        own_brand: !!s.own_brand,
      });
    }
  }
  return out;
}

function registrySummary() {
  return stats(loadRegistry());
}

module.exports = {
  loadRegistry,
  selectSources,
  adaptersForSelection,
  registrySummary,
  brandsOf,
  expandWantedBrands,
  brandMatches,
  groupOf,
  displayGroupOf,
  isOwnBrandStore,
  detectUnknownBrandIntent,
  MANDATORY_TAIL_IDS,
  DISPLAY_GROUP_ORDER,
  DISPLAY_GROUP_LABELS,
  GROUP_ORDER_WITH_BRAND,
  GROUP_ORDER_NO_BRAND,
};
