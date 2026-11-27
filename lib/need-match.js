'use strict';

/**
 * Подбор под потребность по локальному каталогу.
 * Без AI, без выдуманных атрибутов. Совпадения только по явным полям/названию.
 */

const {
  norm,
  nonempty,
  searchCatalog,
  marketplaceLastSuccessAt,
  tokenizeQuery,
} = require('./takprodam-catalog');
const { catalogPublicId } = require('./takprodam-schema');
const { normalizeCriteria } = require('./criteria-model');
const { rankingExtraScore, fallbackNeedCriteria } = require('./need-criteria-ai');
const { titleFitsCategory } = require('./category-guards');

const MAX_PICK = 5;
const BRAND_PRIMARY = 3;
const BRAND_ALT = 2;
const TITLE_HINT_RE =
  /кож[аеи]|кожан|натуральн|мужск|женск|дорожн|поясн|через\s+плечо|с\s+монетниц/i;

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const s = String(item == null ? '' : item).trim();
    if (!s) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function rawHasHardMarker(rawQuery, value) {
  const q = String(rawQuery || '');
  if (!value) return false;
  const esc = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    '(?:только|обязательно|строго)\\s+(?:[\\wа-яё-]+\\s+){0,3}' + esc,
    'i'
  ).test(q);
}

/**
 * Модель запроса: категория, обязательное, предпочтения, неизвестное.
 */
function buildNeedModel(parsed, rawQuery) {
  const c = normalizeCriteria(parsed || {});
  const raw = String(rawQuery || parsed && parsed.raw_query || '');
  const must = [];
  const prefer = [];
  const unknown = [];

  if (c.category) {
    must.push({
      field: 'category',
      value: c.category,
      hard: rawHasHardMarker(raw, c.category) || /только|обязательно/i.test(raw),
      label: 'Категория: ' + c.category,
    });
  }
  for (const color of c.colors || []) {
    const hard = rawHasHardMarker(raw, color);
    (hard ? must : prefer).push({
      field: 'color',
      value: color,
      hard,
      label: 'Цвет: ' + color,
    });
  }
  for (const brand of c.brands || []) {
    must.push({
      field: 'brand',
      value: brand,
      hard: true,
      label: 'Бренд: ' + brand,
    });
  }
  for (const size of c.sizes || []) {
    unknown.push({
      field: 'size',
      value: size,
      label: 'Размер: ' + size,
      note: 'В каталоге размер не подтверждён отдельным полем',
    });
  }

  const budget_min = c.budget_min;
  const budget_max = c.budget_max != null ? c.budget_max : c.budget;
  if (budget_min != null || budget_max != null) {
    must.push({
      field: 'budget',
      value: { min: budget_min, max: budget_max },
      hard: true,
      label:
        budget_min != null && budget_max != null
          ? 'Цена от ' + budget_min + ' до ' + budget_max
          : budget_max != null
            ? 'Не дороже ' + budget_max
            : 'Цена от ' + budget_min,
    });
  }

  const restTokens = tokenizeQuery({
    search_phrase: null,
    rest: c.rest,
    category: null,
    brand: null,
    color: null,
    size: null,
  });
  for (const token of restTokens) {
    if (/кож|материал|вмест|качеств|оригинал|доставк|отзыв/i.test(token)) {
      unknown.push({
        field: 'attribute',
        value: token,
        label: token,
        note: 'Нет отдельного проверенного поля; совпадение возможно только по названию',
      });
      prefer.push({
        field: 'title_token',
        value: token,
        hard: false,
        label: 'Упоминание в названии: ' + token,
        title_only: true,
      });
    } else {
      prefer.push({
        field: 'title_token',
        value: token,
        hard: false,
        label: 'Слово запроса: ' + token,
        title_only: true,
      });
    }
  }

  if (!c.category && !(c.colors || []).length && !(c.brands || []).length && !restTokens.length) {
    const phraseTokens = tokenizeQuery(parsed);
    for (const token of phraseTokens) {
      prefer.push({
        field: 'title_token',
        value: token,
        hard: false,
        label: 'Слово запроса: ' + token,
        title_only: true,
      });
    }
  }

  return {
    category: c.category || null,
    must,
    prefer,
    unknown,
    budget_min: budget_min != null ? budget_min : null,
    budget_max: budget_max != null ? budget_max : null,
    raw_query: raw || null,
  };
}

function titleContains(entry, value) {
  return norm(entry && entry.title).includes(norm(value));
}

function explainOffer(entry, model, catalog) {
  const matched = [];
  const missing = [];
  const title = String(entry.title || '');

  for (const rule of model.must || []) {
    if (rule.field === 'budget') {
      if (!nonempty(entry.currency) || !Number.isFinite(Number(entry.price))) {
        missing.push({
          field: 'budget',
          label: 'Валюта цены не подтверждена источником',
          basis: null,
        });
      } else {
        matched.push({ field: 'budget', label: rule.label, basis: 'поле цены источника' });
      }
      continue;
    }
    if (rule.field === 'brand' || rule.field === 'color' || rule.field === 'category') {
      const inTitle = titleContains(entry, rule.value);
      const inCategory =
        rule.field === 'category' &&
        norm(entry.category_title).includes(norm(rule.value));
      const inShop =
        rule.field === 'brand' &&
        [entry.brand, entry.marketplace, entry.marketplace_title, entry.store_title]
          .filter(Boolean)
          .some((v) => norm(v).includes(norm(rule.value)));
      if (inTitle || inCategory || inShop) {
        matched.push({
          field: rule.field,
          label: rule.label,
          basis: inShop
            ? 'магазин/бренд фида'
            : inCategory && !inTitle
              ? 'категория источника'
              : 'указано в названии источника',
        });
      } else {
        missing.push({ field: rule.field, label: rule.label + ' — не найдено', basis: null });
      }
    }
  }

  for (const rule of model.prefer || []) {
    if (rule.field === 'title_token' || rule.field === 'color') {
      if (titleContains(entry, rule.value)) {
        matched.push({
          field: rule.field,
          label: rule.label,
          basis: 'указано в названии источника',
        });
      }
    }
  }

  for (const u of model.unknown || []) {
    if (u.field === 'size') {
      missing.push({
        field: 'size',
        label: 'Размер «' + u.value + '» не подтверждён',
        basis: null,
      });
    } else if (TITLE_HINT_RE.test(u.value) || /кож|материал/i.test(u.value)) {
      if (!titleContains(entry, u.value) && !/кож/i.test(title)) {
        missing.push({
          field: u.field,
          label: u.label + ' — в названии не видно',
          basis: null,
        });
      }
    }
  }

  if (!nonempty(entry.currency)) {
    missing.push({
      field: 'currency',
      label: 'Валюта не передана источником',
      basis: null,
    });
  }

  const mk = entry.marketplace_key;
  const lastSuccess = marketplaceLastSuccessAt(catalog, mk);
  return {
    matched,
    missing,
    data_freshness: {
      marketplace_key: mk || null,
      last_success_at: lastSuccess,
      basis: 'время последнего успешного обновления среза',
    },
  };
}

function availableActions(model, state) {
  const actions = {
    edit_requirements: true,
    exclude_offer: true,
    show_others: false,
    reset_exclusions: false,
  };
  const excluded = uniqueStrings(state && state.exclude_ids);
  if (excluded.length) actions.reset_exclusions = true;
  // «Меньше/качественнее» не предлагаем — нет признаков.
  actions.can_filter_cheaper = false;
  actions.can_filter_quality = false;
  if ((model.budget_min != null || model.budget_max != null) && model.must.some((m) => m.field === 'budget')) {
    // бюджет уже обязателен; отдельной кнопки «дешевле» нет без валюты
    actions.can_filter_cheaper = false;
  }
  return actions;
}

/**
 * Подбор до пяти предложений из уже загруженного каталога.
 */
function offerBrandHay(offer) {
  // Без title: иначе чужой магазин с «Finn» в названии модели ломает микс.
  return norm(
    [offer && offer.brand, offer && offer.marketplace, offer && offer.store_title, offer && offer.source]
      .filter(Boolean)
      .join(' ')
  );
}

function offerBrandKey(offer) {
  const raw =
    (offer && offer.brand) ||
    (offer && offer.marketplace) ||
    (offer && offer.store_title) ||
    (offer && offer.source) ||
    '';
  return norm(raw) || 'unknown';
}

function offerMatchesWantedBrand(offer, brandNorms) {
  if (!brandNorms.length) return false;
  const hay = offerBrandHay(offer);
  return brandNorms.some((b) => hay.includes(b));
}

function countBrandKey(rows, key) {
  let n = 0;
  for (const row of rows || []) {
    if (offerBrandKey(row) === key) n += 1;
  }
  return n;
}

/**
 * Сначала по одному с каждого бренда, затем добор с лимитом maxPerBrand.
 * Никогда не отдаём max карточек одного бренда.
 */
function pickBrandDiverse(rows, max, maxPerBrand) {
  const limit = Math.max(1, Math.min(Number(maxPerBrand) || 1, max));
  const picked = [];
  const have = new Set();
  const haveTitles = new Set();

  function tryTake(passLimit) {
    for (const row of rows || []) {
      if (picked.length >= max) break;
      const id = String(row.id);
      if (have.has(id)) continue;
      const titleKey = norm(row.title);
      if (titleKey && haveTitles.has(titleKey)) continue;
      const key = offerBrandKey(row);
      if (countBrandKey(picked, key) >= passLimit) continue;
      picked.push(row);
      have.add(id);
      if (titleKey) haveTitles.add(titleKey);
    }
  }

  tryTake(1);
  if (picked.length < max && limit > 1) tryTake(limit);
  return picked;
}

function scoreCandidate(offer, entry, model, catalog, ranking) {
  const explained = explainOffer(entry, model, catalog);
  let need_score =
    explained.matched.length * 10 -
    explained.missing.filter((m) => m.field === 'budget' || m.field === 'brand').length * 5;
  need_score += rankingExtraScore(entry && entry.title, ranking);
  // Категория из запроса важнее «похожего» магазинного хита.
  if (model.category && titleFitsCategory(model.category, entry && entry.title, entry && entry.category_title)) {
    need_score += 8;
  } else if (model.category) {
    need_score -= 20;
  }
  return {
    ...offer,
    match_notes: explained.matched,
    missing_notes: explained.missing,
    data_freshness: explained.data_freshness,
    need_score,
  };
}

function matchNeeds(catalog, parsed, opts) {
  const options = opts || {};
  const max = Math.min(Number(options.max) > 0 ? Number(options.max) : MAX_PICK, MAX_PICK);
  const isProd = !!options.isProd;
  const maxAgeHours = options.maxAgeHours;
  const nowMs = options.nowMs;
  const excludeIds = new Set(uniqueStrings(options.exclude_ids).map(String));
  const rawQuery = options.raw_query || (parsed && parsed.raw_query) || '';
  const model = buildNeedModel(parsed, rawQuery);
  const brandNorms = uniqueStrings(
    (model.must || []).filter((m) => m.field === 'brand').map((m) => m.value)
  ).map(norm);

  const ranking =
    options.ranking && typeof options.ranking === 'object'
      ? options.ranking
      : fallbackNeedCriteria(rawQuery, parsed);
  const commonSearch = {
    max: brandNorms.length ? 80 : 150,
    isProd,
    maxAgeHours,
    nowMs,
    // Без бренда — тянем топ с каждого магазина, иначе Finn Flare/Shopping Live забивают выдачу.
    diverseByMarketplace: brandNorms.length === 0,
    perMarketplace: brandNorms.length === 0 ? 25 : undefined,
  };

  // С брендом: до 3 карточек целевого магазина + до 2 альтернатив из других фидов.
  // Без бренда: до 5 лучших по разным магазинам (НЕ схема 3+2).
  let foundPrimary = searchCatalog(catalog, parsed, {
    ...commonSearch,
    brandOptional: false,
  });
  function softenColor(base) {
    const next = Object.assign({}, base, { color: null, colors: [] });
    // Убираем цвет и из фразы, иначе tokenizeQuery всё равно требует «зелёная» в title.
    if (next.category) next.search_phrase = String(next.category);
    else if (next.search_phrase && (base.color || (base.colors && base.colors.length))) {
      let phrase = String(next.search_phrase);
      for (const c of [].concat(base.colors || [], base.color || [])) {
        const re = new RegExp(String(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
        phrase = phrase.replace(re, ' ');
      }
      phrase = phrase.replace(/зелён\w*|зелен\w*|green/gi, ' ').replace(/\s+/g, ' ').trim();
      next.search_phrase = phrase || next.search_phrase;
    }
    return next;
  }

  // Цвет без совпадений в фидах: не обнуляем выдачу — ослабляем цвет и ищем по типу вещи,
  // но сохраняем цвет как мягкий буст (чтобы синяя/красная куртка не давали один и тот же топ).
  const softColorList = []
    .concat((parsed && parsed.colors) || [], (parsed && parsed.color) || [])
    .filter(Boolean);
  if (
    !(foundPrimary.items || []).length &&
    parsed &&
    softColorList.length
  ) {
    foundPrimary = searchCatalog(catalog, softenColor(parsed), {
      ...commonSearch,
      brandOptional: false,
      softColors: softColorList,
    });
  }
  function withoutBrand(base) {
    const next = Object.assign({}, base, { brand: null, brands: [] });
    if (next.category) next.search_phrase = String(next.category);
    else if (next.search_phrase && brandNorms.length) {
      let phrase = String(next.search_phrase);
      for (const b of brandNorms) {
        const re = new RegExp(String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
        phrase = phrase.replace(re, ' ');
      }
      next.search_phrase = phrase.replace(/\s+/g, ' ').trim() || next.search_phrase;
    }
    return next;
  }

  let foundPool =
    brandNorms.length > 0
      ? searchCatalog(catalog, withoutBrand(parsed), {
          ...commonSearch,
          brandOptional: true,
        })
      : foundPrimary;
  if (brandNorms.length && !(foundPool.items || []).length && softColorList.length) {
    foundPool = searchCatalog(catalog, softenColor(withoutBrand(parsed)), {
      ...commonSearch,
      brandOptional: true,
      softColors: softColorList,
    });
  }

  function toCandidates(list) {
    const out = [];
    for (const offer of list || []) {
      if (excludeIds.has(String(offer.id))) continue;
      const entry =
        ((catalog && catalog.items) || []).find((it) => it && catalogPublicId(it) === offer.id) || {
          title: offer.title,
          category_title: offer.category,
          marketplace_key: offer.marketplace_key,
          currency: offer.currency,
          price: offer.price,
          marketplace: offer.marketplace,
          store_title: offer.store_title,
          brand: offer.brand,
        };
      out.push(scoreCandidate(offer, entry, model, catalog, ranking));
    }
    out.sort((a, b) => b.need_score - a.need_score || (b.score || 0) - (a.score || 0));
    return out;
  }

  const primaryAll = toCandidates(foundPrimary.items).filter((o) => {
    if (!model.category) return true;
    return titleFitsCategory(model.category, o.title, o.category);
  });
  const poolAll = toCandidates(foundPool.items).filter((o) => {
    if (!model.category) return true;
    return titleFitsCategory(model.category, o.title, o.category);
  });
  let picked = [];
  if (brandNorms.length) {
    const brandRows = primaryAll.filter((o) => offerMatchesWantedBrand(o, brandNorms));
    const altRows = poolAll.filter((o) => !offerMatchesWantedBrand(o, brandNorms));
    // Только при явном бренде в запросе: до 3 своего (разные названия) + по 1 с альтернативных.
    const have = new Set();
    const haveTitles = new Set();
    for (const row of brandRows) {
      if (picked.length >= Math.min(BRAND_PRIMARY, max)) break;
      const id = String(row.id);
      const titleKey = norm(row.title);
      if (have.has(id) || (titleKey && haveTitles.has(titleKey))) continue;
      picked.push(row);
      have.add(id);
      if (titleKey) haveTitles.add(titleKey);
    }
    const altSlots = Math.min(BRAND_ALT, Math.max(0, max - picked.length));
    for (const row of pickBrandDiverse(
      altRows.filter((o) => !have.has(String(o.id))),
      altSlots,
      1
    )) {
      picked.push(row);
      have.add(String(row.id));
    }
  } else {
    // Без бренда: по 1 карточке с каждого доступного магазина (все фиды, где есть совпадения).
    // Второй слот с того же магазина — только если уникальных магазинов меньше, чем max.
    picked = pickBrandDiverse(primaryAll, max, 1);
    if (picked.length < max) {
      const uniqueShops = new Set(primaryAll.map(offerBrandKey)).size;
      const fillPer = uniqueShops > 0 && uniqueShops < max ? 2 : 1;
      picked = pickBrandDiverse(primaryAll, max, fillPer);
    }
  }

  const items = picked.map((row) => {
    const { need_score, ...rest } = row;
    return rest;
  });

  const candidates = brandNorms.length ? poolAll : primaryAll;
  const actions = availableActions(model, { exclude_ids: [...excludeIds] });
  actions.show_others = candidates.length > items.length || excludeIds.size > 0;

  const rawFoundCount = (foundPrimary.items || []).length || (foundPool.items || []).length;
  let reason = foundPrimary.reason || foundPool.reason;
  if (!items.length) {
    if (excludeIds.size && rawFoundCount) reason = 'exhausted_after_exclusions';
    else if (!reason) reason = 'no_matches';
  } else {
    reason = null;
  }

  return {
    understood: model,
    items,
    total_candidates: candidates.length + excludeIds.size,
    remaining_after_exclusions: candidates.length,
    excluded_count: excludeIds.size,
    actions,
    reason,
    mix:
      brandNorms.length > 0
        ? { mode: 'brand_primary_alt', primary: BRAND_PRIMARY, alt: BRAND_ALT }
        : { mode: 'best_diverse', primary: max, alt: 0, max_per_brand: 1 },
    ranking: {
      source: ranking.source || 'rules',
      focus_category: ranking.focus_category || null,
      criteria: Array.isArray(ranking.criteria) ? ranking.criteria.slice(0, 5) : [],
    },
    note:
      items.length
        ? brandNorms.length
          ? 'До 3 карточек выбранного бренда и по 1 карточке с других брендов по похожему запросу. Ссылки на сайты — отдельно ниже.'
          : 'Лучшие варианты по запросу с разных магазинов (без схемы 3+2). Ссылки на сайты — отдельно ниже.'
        : emptyReasonNote(reason),
  };
}

function emptyReasonNote(reason) {
  if (reason === 'budget_currency_unconfirmed') {
    return 'Не удалось подтвердить соответствие бюджету: источник не передал валюту. Это не означает, что подходящих товаров на рынке нет.';
  }
  if (reason === 'stale_source_only') {
    return 'Предложения по этому запросу временно не показываем: данные магазина требуют обновления.';
  }
  if (reason === 'exhausted_after_exclusions') {
    return 'Других подходящих предложений в текущем каталоге нет. Можно сбросить исключения или изменить требования.';
  }
  return 'В подключённом каталоге подходящих товаров пока не найдено';
}

module.exports = {
  MAX_PICK,
  buildNeedModel,
  matchNeeds,
  explainOffer,
  availableActions,
};
