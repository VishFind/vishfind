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

const MAX_PICK = 5;
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
      if (inTitle || inCategory) {
        matched.push({
          field: rule.field,
          label: rule.label,
          basis: inCategory && !inTitle ? 'категория источника' : 'указано в названии источника',
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
function matchNeeds(catalog, parsed, opts) {
  const options = opts || {};
  const max = Math.min(Number(options.max) > 0 ? Number(options.max) : MAX_PICK, MAX_PICK);
  const isProd = !!options.isProd;
  const maxAgeHours = options.maxAgeHours;
  const nowMs = options.nowMs;
  const excludeIds = new Set(uniqueStrings(options.exclude_ids).map(String));
  const rawQuery = options.raw_query || (parsed && parsed.raw_query) || '';
  const model = buildNeedModel(parsed, rawQuery);

  const found = searchCatalog(catalog, parsed, {
    max: 80,
    isProd,
    maxAgeHours,
    nowMs,
  });

  const candidates = [];
  for (const offer of found.items || []) {
    if (excludeIds.has(String(offer.id))) continue;
    // Ищем исходную запись для объяснений
    const entry = ((catalog && catalog.items) || []).find(
      (it) => it && catalogPublicId(it) === offer.id
    ) || {
      title: offer.title,
      category_title: offer.category,
      marketplace_key: offer.marketplace_key,
      currency: offer.currency,
      price: offer.price,
    };
    const explained = explainOffer(entry, model, catalog);
    candidates.push({
      ...offer,
      match_notes: explained.matched,
      missing_notes: explained.missing,
      data_freshness: explained.data_freshness,
      need_score:
        explained.matched.length * 10 -
        explained.missing.filter((m) => m.field === 'budget' || m.field === 'brand').length * 5,
    });
  }

  candidates.sort((a, b) => b.need_score - a.need_score || (b.score || 0) - (a.score || 0));
  const items = candidates.slice(0, max).map((row) => {
    const { need_score, ...rest } = row;
    return rest;
  });

  const actions = availableActions(model, { exclude_ids: [...excludeIds] });
  actions.show_others = candidates.length > items.length || excludeIds.size > 0;

  let reason = found.reason;
  if (!items.length) {
    if (excludeIds.size && (found.items || []).length) reason = 'exhausted_after_exclusions';
    else if (found.reason) reason = found.reason;
    else reason = 'no_matches';
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
    note:
      items.length
        ? 'Подборка до пяти предложений из локального каталога. Это не рейтинг рынка.'
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
