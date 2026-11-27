'use strict';

/**
 * Локальный каталог Takprodam: загрузка, свежесть, текстовый поиск, публичные карточки.
 * Поиск только по импортированным данным (без выдуманного q в API).
 */

const fs = require('fs');
const path = require('path');
const {
  catalogPublicId,
  normalizeEntry,
  migrateCatalogToV2,
  offerDedupeKey,
} = require('./takprodam-schema');

const ROOT = path.join(__dirname, '..');

const FASHION_INCLUDE_RE =
  /сумк|рюкзак|ремен|ремеш|кошель|портмон|визитниц|картхолд|кардхолд|клатч|барсет|шарф|палантин|перчат|варежк|очк|очка|солнцезащит|час(?:ы|ов)|браслет|колье|цепоч|цепь|цеп\b|серьг|кольц|кулон|подвеск|бижут|украшен|галстук|запонк|заколк|ободк|берет|шляп|кепк|шапк|повязк|зонт|брошь|брош/i;

const FASHION_EXCLUDE_RE =
  /краск|лак\b|грунт|мебел|фасад|строител|отделоч|сверл|насос|кабель|моторн|смазк|герметик|шпакл|цемент|плитк|инструмент|светодиод|ламп[аы]|розетк|удлинител|аккумулятор(?:ная)?\s+дрель/i;

const LEGAL_MARK_RE = /erid|ерid|реклам|инф\s*продукт|ооо|ип\s|advert/i;

function norm(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[''.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonempty(v) {
  return v != null && String(v).trim() !== '';
}

function safeHttpUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

/** Проверка маркировки: не любое непустое legal_text достаточно. */
function legalTextLooksComplete(legalText) {
  if (!nonempty(legalText)) return false;
  const t = String(legalText);
  if (t.trim().length < 12) return false;
  return LEGAL_MARK_RE.test(t);
}

/** Обложки документов и денежные зажимы: не любое слово «обложка» или «зажим». */
function isDocumentOrMoneyAccessory(title) {
  const t = String(title || '');
  if (/обложк/i.test(t) && /паспорт|документ|страхов|стс|для прав|водительск|автодокумент/i.test(t)) {
    return true;
  }
  if (/зажим/i.test(t) && /банкнот|купюр|денег|денежн/i.test(t)) return true;
  if (/денежн\w*\s+зажим/i.test(t)) return true;
  return false;
}

function isFashionRelevantTitle(title, categoryTitle) {
  const hay = String(title || '') + ' ' + String(categoryTitle || '');
  if (FASHION_EXCLUDE_RE.test(hay)) return false;
  if (FASHION_INCLUDE_RE.test(hay)) return true;
  if (isDocumentOrMoneyAccessory(title)) return true;
  // Ювелирные / украшения по категории — допускаем, если нет exclude.
  if (/ювелир|украшен|аксессуар/i.test(String(categoryTitle || ''))) {
    return /браслет|цепоч|цепь|кольц|серьг|колье|кулон|подвеск|бижут|украшен|шарм|час/i.test(
      String(title || '')
    );
  }
  return false;
}

/**
 * Нормализация сырого item API → запись каталога.
 * currency/source_updated_at не выдумываем.
 */
function mapRawProduct(raw, ctx) {
  const tracking = safeHttpUrl(raw && raw.tracking_link);
  const external = safeHttpUrl(raw && raw.external_link);
  const image = safeHttpUrl(raw && raw.image_url);
  const title = nonempty(raw && raw.title) ? String(raw.title).trim() : null;
  const priceNum = Number(raw && raw.price);
  const price = Number.isFinite(priceNum) ? priceNum : null;
  const legal = nonempty(raw && raw.legal_text) ? String(raw.legal_text) : null;
  const assumed =
    ctx.assumedCurrency && /^[A-Z]{3}$/.test(ctx.assumedCurrency) && ctx.assumedCurrencyBasis
      ? ctx.assumedCurrency
      : null;

  return {
    source: 'takprodam',
    source_id: ctx.sourceId,
    id: raw && raw.id != null ? String(raw.id) : null,
    product_id: raw && raw.product_id != null ? raw.product_id : null,
    sku: nonempty(raw && raw.sku) ? String(raw.sku) : null,
    marketplace: nonempty(raw && raw.marketplace_title)
      ? String(raw.marketplace_title)
      : nonempty(ctx.marketplaceSlug)
        ? String(ctx.marketplaceSlug)
        : null,
    store_title: nonempty(raw && raw.store_title) ? String(raw.store_title).trim() : null,
    title,
    image_url: image,
    price,
    currency: assumed,
    currency_basis: assumed ? ctx.assumedCurrencyBasis : null,
    category_id: ctx.categoryId != null ? ctx.categoryId : null,
    category_title: ctx.categoryTitle || null,
    external_link: external,
    tracking_link: tracking,
    legal_text: legal,
    source_updated_at: null,
    fetched_at: ctx.fetchedAt,
    // commission только серверно при необходимости — в публичный JSON не кладём
    _commission:
      typeof (raw && raw.commission) === 'number' && Number.isFinite(raw.commission)
        ? raw.commission
        : null,
  };
}

function validateForPublic(entry) {
  const reasons = [];
  if (!entry || typeof entry !== 'object') return { ok: false, reasons: ['invalid_entry'] };
  if (!nonempty(entry.title)) reasons.push('missing_title');
  if (!nonempty(entry.image_url)) reasons.push('missing_image_url');
  if (!nonempty(entry.tracking_link)) reasons.push('missing_tracking_link');
  if (!legalTextLooksComplete(entry.legal_text)) reasons.push('incomplete_legal_text');
  if (!isFashionRelevantTitle(entry.title, entry.category_title)) reasons.push('not_fashion_relevant');
  if (entry.product_id == null && !nonempty(entry.id)) reasons.push('missing_ids');
  return { ok: reasons.length === 0, reasons };
}

function stripPrivate(entry) {
  const out = { ...entry };
  delete out._commission;
  return out;
}

/** Каталог в RAM после decrypt — без записи 13MB JSON на диск (OOM/restart на Timeweb). */
let runtimeCatalog = null;

function setRuntimeCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    runtimeCatalog = null;
    return { ok: false };
  }
  const migrated = migrateCatalogToV2(catalog);
  runtimeCatalog = migrated.catalog;
  return { ok: true, migrated: migrated.changed, item_count: (runtimeCatalog.items || []).length };
}

function getRuntimeCatalog() {
  return runtimeCatalog;
}

function loadCatalogFile(relOrAbs) {
  if (runtimeCatalog) {
    return {
      ok: true,
      error: null,
      path: ':memory:',
      catalog: runtimeCatalog,
      migrated: false,
    };
  }
  const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'invalid_json', path: filePath, catalog: null };
    }
    const migrated = migrateCatalogToV2(raw);
    return {
      ok: true,
      error: null,
      path: filePath,
      catalog: migrated.catalog,
      migrated: migrated.changed,
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { ok: false, error: 'missing', path: filePath, catalog: null };
    }
    return { ok: false, error: e.message || 'read_error', path: filePath, catalog: null };
  }
}

function isTimestampFresh(iso, maxAgeHours, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const maxMs = Number(maxAgeHours) * 3600 * 1000;
  if (!Number.isFinite(maxMs) || maxMs <= 0) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - t <= maxMs;
}

/** Время последнего успешного обновления конкретного marketplace. */
function marketplaceLastSuccessAt(catalog, marketplaceKey) {
  const key = String(marketplaceKey || '').trim();
  if (!key || !catalog || !catalog.marketplaces) return null;
  const row = catalog.marketplaces[key];
  return row && row.last_success_at ? row.last_success_at : null;
}

/**
 * Свежесть одного среза. Успех Ozon не делает Lamoda актуальной.
 * Просроченные данные могут оставаться на диске.
 */
function isMarketplaceFresh(catalog, marketplaceKey, maxAgeHours, nowMs) {
  const at = marketplaceLastSuccessAt(catalog, marketplaceKey);
  if (!at) return false;
  return isTimestampFresh(at, maxAgeHours, nowMs);
}

/**
 * Каталог доступен для поиска, если есть хотя бы один свежий срез.
 * Это не означает, что все marketplace в ответе актуальны.
 */
function isCatalogFresh(catalog, maxAgeHours, nowMs) {
  const mps = catalog && catalog.marketplaces;
  if (mps && typeof mps === 'object') {
    const keys = Object.keys(mps);
    if (keys.length) {
      return keys.some((k) => isMarketplaceFresh(catalog, k, maxAgeHours, nowMs));
    }
  }
  return isTimestampFresh(catalog && catalog.fetched_at, maxAgeHours, nowMs);
}

const { titleFitsCategory, tokenMatchesTitle } = require('./category-guards');

const QUERY_STOP = new Set([
  'и',
  'или',
  'для',
  'на',
  'с',
  'по',
  'от',
  'до',
  'не',
  'самый',
  'самая',
  'самое',
  'самые',
  'очень',
  'нужен',
  'нужна',
  'нужно',
  'хочу',
  'найди',
  'подбери',
  'the',
  'a',
  'an',
  'size',
  'размер',
]);

function tokenizeText(text) {
  return norm(text)
    .split(/[\s,;/|]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !QUERY_STOP.has(t) && !/^\d+$/.test(t));
}

function tokenizeQuery(parsed) {
  const bits = [];
  if (parsed && parsed.search_phrase) bits.push(String(parsed.search_phrase));
  if (parsed && parsed.category) bits.push(String(parsed.category));
  if (parsed && parsed.brand) bits.push(String(parsed.brand));
  if (parsed && parsed.color) bits.push(String(parsed.color));
  if (parsed && parsed.size) bits.push(String(parsed.size));
  if (parsed && parsed.rest) bits.push(String(parsed.rest));
  return tokenizeText(bits.join(' '));
}

/** Обязательные токены: тип/бренд/цвет/размер. Остальное из фразы — мягкий буст. */
function hardQueryTokens(parsed) {
  const bits = [];
  if (parsed && parsed.category) bits.push(String(parsed.category));
  if (parsed && Array.isArray(parsed.categories)) {
    for (const c of parsed.categories) if (c) bits.push(String(c));
  }
  if (parsed && parsed.brand) bits.push(String(parsed.brand));
  if (parsed && Array.isArray(parsed.brands)) {
    for (const b of parsed.brands) if (b) bits.push(String(b));
  }
  if (parsed && parsed.color) bits.push(String(parsed.color));
  if (parsed && Array.isArray(parsed.colors)) {
    for (const c of parsed.colors) if (c) bits.push(String(c));
  }
  if (parsed && parsed.size) bits.push(String(parsed.size));
  if (parsed && Array.isArray(parsed.sizes)) {
    for (const s of parsed.sizes) if (s) bits.push(String(s));
  }
  return [...new Set(tokenizeText(bits.join(' ')))];
}

function softQueryTokens(parsed, hardSet) {
  const all = tokenizeQuery(parsed);
  return all.filter((t) => !hardSet.has(t));
}

/**
 * Текстовый/атрибутивный поиск по каталогу. Не семантический.
 * Без совпадений — пустой список (не случайные товары).
 */
function searchCatalog(catalog, parsed, opts) {
  const options = opts || {};
  const max = options.max != null ? options.max : 12;
  const isProd = !!options.isProd;
  const maxAgeHours = options.maxAgeHours;
  const nowMs = options.nowMs;
  const items = (catalog && catalog.items) || [];
  const hasMarketplaceMap =
    !!(catalog && catalog.marketplaces && Object.keys(catalog.marketplaces).length);
  const filterByFreshness = maxAgeHours != null && hasMarketplaceMap;
  const hardTokens = hardQueryTokens(parsed);
  const hardSet = new Set(hardTokens);
  const softTokens = softQueryTokens(parsed, hardSet);
  const tokens = hardTokens.length ? hardTokens : tokenizeQuery(parsed);
  const brandList = [];
  if (parsed && Array.isArray(parsed.brands)) {
    for (const b of parsed.brands) if (nonempty(b)) brandList.push(norm(b));
  }
  if (parsed && nonempty(parsed.brand)) brandList.push(norm(parsed.brand));
  const brands = [...new Set(brandList.filter(Boolean))];
  const color = parsed && nonempty(parsed.color) ? norm(parsed.color) : '';
  const softColors = Array.isArray(options.softColors)
    ? options.softColors.map((c) => norm(c)).filter(Boolean)
    : [];
  const wantedCategory =
    parsed && nonempty(parsed.category) ? String(parsed.category).trim() : '';
  const budgetMax =
    parsed && parsed.budget_max != null
      ? Number(parsed.budget_max)
      : parsed && parsed.budget != null
        ? Number(parsed.budget)
        : null;
  const budgetMin = parsed && parsed.budget_min != null ? Number(parsed.budget_min) : null;
  // Для альтернатив (3+2): не режем чужие бренды, но поднимаем целевой бренд в score.
  const brandOptional = !!options.brandOptional;

  if (!tokens.length && !brands.length && !color && !wantedCategory) {
    return { items: [], reason: 'empty_query' };
  }

  const scored = [];
  let titleMatched = 0;
  let blockedUnconfirmedCurrency = 0;
  let staleSkipped = 0;
  let categoryRejected = 0;
  const budgetSet = Number.isFinite(budgetMax) || Number.isFinite(budgetMin);

  function entryBrandHay(entry, title) {
    return [
      title,
      entry.brand,
      entry.marketplace,
      entry.marketplace_title,
      entry.store_title,
      entry.marketplace_key,
    ]
      .filter((v) => nonempty(v))
      .map((v) => norm(v))
      .join(' ');
  }

  function entryMatchesBrand(hay) {
    if (!brands.length) return false;
    return brands.some((b) => hay.includes(b));
  }

  for (const entry of items) {
    if (!entry || entry.excluded) continue;
    const title = norm(entry.title);
    if (!title) continue;
    const brandHay = entryBrandHay(entry, title);
    const brandHit = entryMatchesBrand(brandHay);

    if (brands.length && !brandOptional && !brandHit) continue;
    if (
      wantedCategory &&
      !titleFitsCategory(wantedCategory, entry.title, entry.category_title)
    ) {
      categoryRejected += 1;
      continue;
    }
    if (color) {
      const colors = color.split(',').map((c) => c.trim()).filter(Boolean);
      if (colors.length && !colors.some((c) => title.includes(c))) continue;
    }

    // Слова бренда из токенов не требуем повторно в title — бренд уже сверен по shop/marketplace.
    const brandTokenSet = new Set(brands);
    const contentTokens = tokens.filter(
      (t) => !brandTokenSet.has(t) && !brands.some((b) => b.includes(t) || t.includes(b))
    );
    // Цвет уже проверен отдельным фильтром — не дублируем как hard-токен.
    const colorTokenSet = new Set(
      [].concat(color ? color.split(',') : [], softColors).map((c) => c.trim()).filter(Boolean)
    );
    const requiredTokens = contentTokens.filter((t) => !colorTokenSet.has(t));
    let hits = 0;
    let allHit = true;
    for (const t of requiredTokens) {
      const inTitle = tokenMatchesTitle(t, entry.title, wantedCategory);
      const inShop = brandHay.includes(t) && !wantedCategory;
      if (inTitle || inShop) hits += 1;
      else allHit = false;
    }
    // Жёстко требуем только тип/бренд/размер. «Самая тёплая» и т.п. — мягкий буст.
    if (requiredTokens.length && !allHit) continue;

    let softHits = 0;
    for (const t of softTokens) {
      if (tokenMatchesTitle(t, entry.title, wantedCategory) || brandHay.includes(t)) softHits += 1;
    }
    for (const c of softColors) {
      if (!c) continue;
      const stem = c.length > 4 ? c.slice(0, 4) : c;
      if (title.includes(c) || (stem.length >= 3 && title.includes(stem))) softHits += 2;
    }

    titleMatched += 1;

    // Просроченный срез не отдаём как актуальный, но оставляем на диске.
    if (filterByFreshness) {
      const mk = String(entry.marketplace_key || '').trim();
      if (!mk || !isMarketplaceFresh(catalog, mk, maxAgeHours, nowMs)) {
        staleSkipped += 1;
        continue;
      }
    }

    // Жёсткий бюджет: неизвестная валюта не считается соответствующей молча.
    if (budgetSet) {
      if (!nonempty(entry.currency) || !Number.isFinite(entry.price)) {
        blockedUnconfirmedCurrency += 1;
        continue;
      }
      if (Number.isFinite(budgetMax) && entry.price > budgetMax) continue;
      if (Number.isFinite(budgetMin) && entry.price < budgetMin) continue;
    }

    const score =
      hits * 3 + softHits * 2 + (brandHit ? 4 : 0) + (color ? 2 : 0) + (wantedCategory ? 1 : 0);
    scored.push({ entry, score, brandHit });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = Number(a.entry.price);
    const pb = Number(b.entry.price);
    const fa = Number.isFinite(pa) ? pa : Infinity;
    const fb = Number.isFinite(pb) ? pb : Infinity;
    // Цена в сортировке только при одинаковой известной валюте — иначе не ранжируем «дешевле».
    const ca = nonempty(a.entry.currency) ? String(a.entry.currency).toUpperCase() : '';
    const cb = nonempty(b.entry.currency) ? String(b.entry.currency).toUpperCase() : '';
    if (!ca || !cb || ca !== cb) return 0;
    return fa - fb;
  });

  const out = scored.slice(0, max).map(({ entry, score }) =>
    toPublicOffer(entry, {
      score,
      isProd,
      marketplace_last_success_at: marketplaceLastSuccessAt(catalog, entry.marketplace_key),
    })
  );
  let reason = null;
  if (!out.length) {
    const freshTitleMatched = titleMatched - staleSkipped;
    if (
      budgetSet &&
      freshTitleMatched > 0 &&
      blockedUnconfirmedCurrency > 0 &&
      blockedUnconfirmedCurrency === freshTitleMatched
    ) {
      reason = 'budget_currency_unconfirmed';
    } else if (titleMatched > 0 && staleSkipped > 0 && freshTitleMatched === 0) {
      reason = 'stale_source_only';
    } else {
      reason = 'no_matches';
    }
  }
  return {
    items: out,
    reason,
    title_matched: titleMatched,
    blocked_unconfirmed_currency: blockedUnconfirmedCurrency,
    stale_skipped: staleSkipped,
    category_rejected: categoryRejected,
  };
}

function toPublicOffer(entry, ctx) {
  const isProd = !!(ctx && ctx.isProd);
  const hasCurrency = nonempty(entry.currency);
  const priceOk = typeof entry.price === 'number' && Number.isFinite(entry.price);
  let price_mode = 'clarify';
  let price_note = null;
  let price = null;
  let currency = null;

  if (priceOk && hasCurrency) {
    price_mode = 'amount';
    price = entry.price;
    currency = String(entry.currency).toUpperCase();
  } else if (priceOk && !hasCurrency) {
    if (isProd) {
      price_mode = 'clarify';
      price = null;
      currency = null;
      price_note = 'валюта источником не указана';
    } else {
      price_mode = 'raw_unspecified_currency';
      price = entry.price;
      currency = null;
      price_note = 'валюта источником не указана';
    }
  } else {
    price_mode = 'clarify';
    price_note = 'цена недоступна';
  }

  return {
    id: catalogPublicId(entry),
    source:
      (entry.provider === 'admitad' ? 'Admitad / ' : 'Takprodam / ') +
      (entry.marketplace || entry.marketplace_title || 'marketplace'),
    marketplace: entry.marketplace || entry.marketplace_title || null,
    store_title: entry.store_title || null,
    title: entry.title,
    // В Admitad-фидах brand часто пуст — для микса/UI берём marketplace.
    brand: nonempty(entry.brand)
      ? String(entry.brand).trim()
      : entry.marketplace || entry.marketplace_title || null,
    category: entry.category_title || null,
    color: null,
    size: null,
    price,
    currency,
    price_mode,
    price_note,
    condition: null,
    // product_url = прямая ссылка продавца/маркетплейса; affiliate_url = tracking.
    // url оставлен = affiliate_url для CTA «Перейти к товару» (атрибуция + erid).
    product_url: entry.product_url || entry.external_link || null,
    affiliate_url: entry.affiliate_url || entry.tracking_link || null,
    url: entry.affiliate_url || entry.tracking_link || null,
    image_url: entry.image_url,
    legal_text: entry.legal_text,
    in_stock: null,
    updated_at: null,
    source_updated_at: entry.source_updated_at,
    fetched_at: entry.fetched_at,
    provider: entry.provider || 'takprodam',
    marketplace_key: entry.marketplace_key || null,
    seller_title: entry.seller_title || null,
    seller_known: entry.seller_known != null ? entry.seller_known : null,
    is_demo: false,
    result_kind: 'product',
    trust_level: 'affiliate_feed',
    data_origin: entry.provider === 'admitad' ? 'admitad_feed' : 'takprodam_catalog',
    score: ctx && ctx.score != null ? ctx.score : 0,
    marketplace_last_success_at:
      ctx && ctx.marketplace_last_success_at ? ctx.marketplace_last_success_at : null,
  };
}

function mapAndNormalize(raw, ctx) {
  return normalizeEntry(mapRawProduct(raw, ctx), {
    marketplaceSlug: ctx && ctx.marketplaceSlug,
  });
}

module.exports = {
  norm,
  nonempty,
  safeHttpUrl,
  legalTextLooksComplete,
  isFashionRelevantTitle,
  mapRawProduct,
  mapAndNormalize,
  validateForPublic,
  stripPrivate,
  catalogPublicId,
  offerDedupeKey,
  loadCatalogFile,
  setRuntimeCatalog,
  getRuntimeCatalog,
  isTimestampFresh,
  marketplaceLastSuccessAt,
  isMarketplaceFresh,
  isCatalogFresh,
  tokenizeQuery,
  hardQueryTokens,
  softQueryTokens,
  searchCatalog,
  toPublicOffer,
  FASHION_INCLUDE_RE,
  FASHION_EXCLUDE_RE,
};
