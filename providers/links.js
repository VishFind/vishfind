'use strict';

/**
 * Провайдер «ссылки»: строит прямые URL на поиск площадок.
 * Не ходит в сеть, не выдумывает товары и цены.
 *
 * Фильтры URL — только при *_verified: true в data/sources.json.
 * Множественные значения без подтверждённого multi-фильтра → словами в запросе
 * или честная пометка «вручную» / отдельные переходы не плодим автоматически.
 */

const {
  isFilterEnabled,
  priceUrlAllowed,
  sortPriceAscAllowed,
  sortPriceDescAllowed,
  deliveryFastestAllowed,
  sortPreferencesConflict,
  DELIVERY_PREFERENCE_ANY,
  DELIVERY_PREFERENCE_FASTEST,
  PRICE_SORT_DEFAULT,
  PRICE_SORT_ASC,
  PRICE_SORT_DESC,
  normalizeDeliveryPreference,
  resolvePriceSort,
} = require('../lib/marketplace-capabilities');

const TYPE_LABELS = {
  marketplace: 'маркетплейс',
  official_store: 'официальный магазин',
  vintage: 'винтаж',
};

const ALLOWED_HOSTS = new Set([
  'www.ozon.ru',
  'ozon.ru',
  'www.wildberries.ru',
  'wildberries.ru',
  'market.yandex.ru',
  'www.avito.ru',
  'avito.ru',
  'www.lamoda.ru',
  'lamoda.ru',
  'www.zara.com',
  'zara.com',
  'www.ebay.com',
  'ebay.com',
  'www.vestiairecollective.com',
  'vestiairecollective.com',
  'www.nike.com',
  'nike.com',
  'www.adidas.com',
  'adidas.com',
  'www.uniqlo.com',
  'uniqlo.com',
  'www.puma.com',
  'puma.com',
  'www.newbalance.com',
  'newbalance.com',
  'brandshop.ru',
  'www.brandshop.ru',
  'peakstore.ru',
  'www.peakstore.ru',
  'limestore.com',
  'www.limestore.com',
  'lime-shop.com',
  'www.lime-shop.com',
  'maag-fashion.com',
  'www.maag-fashion.com',
  'thecultt.com',
  'www.thecultt.com',
  'collect.tsum.ru',
  'spin4spin.com',
  'www.spin4spin.com',
  'oskelly.ru',
  'www.oskelly.ru',
]);

function formatRub(n) {
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}

function listOf(parsed, plural, singular) {
  if (Array.isArray(parsed[plural]) && parsed[plural].length) {
    return parsed[plural].map((x) => String(x).trim()).filter(Boolean);
  }
  if (parsed[singular]) return [String(parsed[singular]).trim()].filter(Boolean);
  return [];
}

function normalizeRange(parsed) {
  let min = parsed.budget_min != null ? Number(parsed.budget_min) : null;
  let max =
    parsed.budget_max != null
      ? Number(parsed.budget_max)
      : parsed.budget != null
        ? Number(parsed.budget)
        : null;
  // 0 — валидная граница; пустое / NaN — отсутствие ограничения
  if (!Number.isFinite(min) || min < 0) min = null;
  if (!Number.isFinite(max) || max < 0) max = null;
  if (min != null) min = Math.round(min);
  if (max != null) max = Math.round(max);
  const invalid = min != null && max != null && min > max;
  return { min, max, invalid };
}

function appendParam(url, param, value) {
  if (!param || value == null || value === '') return url;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}${param}=${encodeURIComponent(String(value))}`;
}

function formatPriceValue(template, min, max) {
  let value = template || '';
  if (min != null) {
    value = value.replace(/\{min\}/g, String(min)).replace(/\{min_kopecks\}/g, String(min * 100));
  }
  if (max != null) {
    value = value.replace(/\{max\}/g, String(max)).replace(/\{max_kopecks\}/g, String(max * 100));
  }
  if (min == null && max != null && /\{min\}|\{min_kopecks\}/.test(template || '')) {
    value = (template || '')
      .replace(/\{min\}/g, '0')
      .replace(/\{min_kopecks\}/g, '0')
      .replace(/\{max\}/g, String(max))
      .replace(/\{max_kopecks\}/g, String(max * 100));
  }
  return value;
}

function safeHttpsUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function applyPriceFilters(source, url, range) {
  const notes = [];
  let price_filter_applied = false;
  let price_filter_note = null;
  const applied = [];
  const unsupported = [];

  const currency = source.price_currency || 'RUB';
  if (range.min == null && range.max == null) {
    return {
      url,
      price_filter_applied,
      price_filter_note,
      filter_details: notes,
      applied_filters: applied,
      unsupported_filters: unsupported,
    };
  }

  if (range.invalid) {
    notes.push({
      kind: 'error',
      field: 'price',
      text: 'Диапазон цены некорректен (от больше до) — в ссылку не подставляем.',
    });
    return {
      url,
      price_filter_applied: false,
      price_filter_note: notes[0].text,
      filter_details: notes,
      applied_filters: applied,
      unsupported_filters: ['price'],
    };
  }

  if (currency !== 'RUB') {
    notes.push({
      kind: 'manual',
      field: 'price',
      text: 'Цена в рублях не применяется к этой площадке без явной поддержки валюты — задайте фильтр вручную.',
    });
    unsupported.push('price');
    return {
      url,
      price_filter_applied: false,
      price_filter_note: notes[0].text,
      filter_details: notes,
      applied_filters: applied,
      unsupported_filters: unsupported,
    };
  }

  const maxVerified = priceUrlAllowed(source, 'max');
  const minVerified = priceUrlAllowed(source, 'min');
  const maxParam = source.price_max_param || source.price_param || null;
  const minParam = source.price_min_param || null;

  let next = url;

  if (
    maxVerified
    && minVerified
    && source.price_param
    && source.price_format
    && /\{min\}|\{max\}|\{min_kopecks\}|\{max_kopecks\}/.test(source.price_format)
    && !minParam
    && !source.price_max_param
  ) {
    const value = formatPriceValue(source.price_format, range.min ?? 0, range.max);
    if (range.max != null || (range.min != null && /\{min\}/.test(source.price_format))) {
      next = appendParam(next, source.price_param, value);
      price_filter_applied = true;
      const bits = [];
      if (range.min != null) bits.push('от ' + formatRub(range.min));
      if (range.max != null) bits.push('до ' + formatRub(range.max));
      notes.push({ kind: 'applied', field: 'price', text: 'Цена в ссылке: ' + bits.join(' ') });
      applied.push('price');
      return {
        url: next,
        price_filter_applied,
        price_filter_note: null,
        filter_details: notes,
        applied_filters: applied,
        unsupported_filters: unsupported,
      };
    }
  }

  if (range.min != null) {
    if (!isFilterEnabled(source, 'price_min')) {
      notes.push({
        kind: 'manual',
        field: 'price_min',
        text: 'Фильтр цены «от» временно отключён для этой площадки — задайте вручную.',
      });
      unsupported.push('price_min');
    } else if (minVerified && minParam) {
      const tmpl = source.price_min_format || '{min}';
      next = appendParam(next, minParam, formatPriceValue(tmpl, range.min, range.max));
      price_filter_applied = true;
      notes.push({
        kind: 'applied',
        field: 'price_min',
        text: 'Цена «от» в ссылке: ' + formatRub(range.min),
      });
      applied.push('price_min');
    } else if (minParam || maxParam || source.price_param) {
      notes.push({
        kind: 'manual',
        field: 'price_min',
        text: 'Нижняя граница цены в URL этой площадки не подтверждена — выставьте «от» вручную.',
      });
      unsupported.push('price_min');
    } else {
      notes.push({
        kind: 'manual',
        field: 'price_min',
        text: 'Нижнюю границу цены задайте вручную на площадке.',
      });
      unsupported.push('price_min');
    }
  }

  if (range.max != null) {
    if (!isFilterEnabled(source, 'price_max')) {
      notes.push({
        kind: 'manual',
        field: 'price_max',
        text: 'Фильтр цены «до» временно отключён для этой площадки — задайте вручную.',
      });
      unsupported.push('price_max');
    } else if (maxVerified && maxParam) {
      const tmpl = source.price_max_format || source.price_format || '{max}';
      next = appendParam(next, maxParam, formatPriceValue(tmpl, range.min, range.max));
      price_filter_applied = true;
      notes.push({
        kind: 'applied',
        field: 'price_max',
        text: 'Цена «до» в ссылке: ' + formatRub(range.max),
      });
      applied.push('price_max');
    } else if (maxParam || source.price_param) {
      notes.push({
        kind: 'manual',
        field: 'price_max',
        text: 'Фильтр цены «до» в URL этой площадки пока не подтверждён — ограничьте цену вручную.',
      });
      unsupported.push('price_max');
    } else {
      notes.push({
        kind: 'manual',
        field: 'price_max',
        text: 'У этой площадки фильтр цены в ссылку не подставляем — задайте бюджет на сайте.',
      });
      unsupported.push('price_max');
    }
  }

  if (!price_filter_applied && notes.length) {
    price_filter_note = notes.map((n) => n.text).join(' ');
  }

  return {
    url: next,
    price_filter_applied,
    price_filter_note,
    filter_details: notes,
    applied_filters: applied,
    unsupported_filters: unsupported,
  };
}

function describeNonPriceFilters(parsed, caps) {
  const details = [];
  const inQuery = [];
  const unsupported = [];
  const capsSafe = caps || {};

  function describe(field, values, label) {
    if (!values.length) return;
    const mode = capsSafe[field] || 'in_query_only';
    const joined = values.join(', ');
    if (mode === 'unsupported') {
      details.push({
        kind: 'manual',
        field,
        text: label + ' («' + joined + '») задайте вручную на площадке.',
      });
      unsupported.push(field);
      return;
    }
    // Нет подтверждённых ID — всегда словами (или вручную при multi без поддержки).
    if (values.length > 1 && capsSafe.multi !== true && mode !== 'verified_browser') {
      details.push({
        kind: 'in_query',
        field,
        text:
          label
          + ' ('
          + joined
          + '): несколько значений переданы словами в запросе (ИЛИ). Штатный multi-фильтр не подтверждён.',
      });
      inQuery.push(field);
      return;
    }
    details.push({
      kind: 'in_query',
      field,
      text: label + ' («' + joined + '») — словами в поисковом запросе, не как фильтр витрины.',
    });
    inQuery.push(field);
  }

  describe('color', listOf(parsed, 'colors', 'color'), 'Цвет');
  describe('size', listOf(parsed, 'sizes', 'size'), 'Размер');
  describe('brand', listOf(parsed, 'brands', 'brand'), 'Бренд');
  describe('category', listOf(parsed, 'categories', 'category'), 'Тип');
  if (parsed.rest) {
    details.push({
      kind: 'in_query',
      field: 'features',
      text: 'Особенности («' + parsed.rest + '») — словами в запросе.',
    });
    inQuery.push('features');
  }
  return { details, inQuery, unsupported };
}

/**
 * Базовая фраза без цены (search_phrase уже без бюджета).
 * eBay / Vestiaire: английский вариант, если подготовлен (RU для остальных).
 */
function phraseForSource(parsed, source) {
  const id = source && source.id;
  if (id === 'ebay' || id === 'vestiaire') {
    const en = parsed && parsed.search_phrase_en;
    if (en && String(en).trim()) return String(en).trim();
  }
  return (parsed && (parsed.search_phrase || parsed.raw_query)) || '';
}

/** Текстовое уточнение бюджета для in_query (только RUB). */
function formatBudgetInQuery(range) {
  if (!range || range.invalid) return null;
  const min = range.min;
  const max = range.max;
  if (min != null && max != null) return 'от ' + min + ' до ' + max + ' рублей';
  if (max != null) return 'до ' + max + ' рублей';
  if (min != null) return 'от ' + min + ' рублей';
  return null;
}

function templateAcceptsQuery(source) {
  return String((source && source.url_template) || '').includes('{q}');
}

function applySortExtras(url, extras) {
  let next = url;
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
    for (const [k, v] of Object.entries(extras)) {
      if (!k || v == null || String(v).trim() === '') continue;
      next = appendParam(next, k, v);
    }
  }
  return next;
}

/**
 * Сортировка по цене: default | asc | desc.
 * Только при соответствующем *_verified. Не пишет «дешевле/дороже» в {q}.
 */
function applyPriceSort(source, url, priceSort) {
  const sort = priceSort || PRICE_SORT_DEFAULT;
  if (sort === PRICE_SORT_DEFAULT) {
    return {
      url,
      price_sort: PRICE_SORT_DEFAULT,
      sort_price_asc_applied: false,
      sort_price_desc_applied: false,
      sort_price_note: null,
      filter_details: [],
    };
  }

  if (sort === PRICE_SORT_ASC) {
    if (!sortPriceAscAllowed(source)) {
      return {
        url,
        price_sort: PRICE_SORT_ASC,
        sort_price_asc_applied: false,
        sort_price_desc_applied: false,
        sort_price_note: 'Сортировка по возрастанию цены не подтверждена',
        filter_details: [
          {
            kind: 'info',
            field: 'sort_price_asc',
            text: 'Сортировка по возрастанию цены не подтверждена',
          },
        ],
      };
    }
    let next = appendParam(url, source.sort_price_asc_param, source.sort_price_asc_value);
    next = applySortExtras(next, source.sort_price_asc_extra_params);
    const appliedText =
      source.sort_price_asc_label
      || 'Сортировка: сначала дешевле';
    return {
      url: next,
      price_sort: PRICE_SORT_ASC,
      sort_price_asc_applied: true,
      sort_price_desc_applied: false,
      sort_price_note: appliedText,
      filter_details: [{ kind: 'applied', field: 'sort_price_asc', text: appliedText }],
    };
  }

  if (sort === PRICE_SORT_DESC) {
    if (!sortPriceDescAllowed(source)) {
      return {
        url,
        price_sort: PRICE_SORT_DESC,
        sort_price_asc_applied: false,
        sort_price_desc_applied: false,
        sort_price_note: 'Сортировка по убыванию цены не подтверждена',
        filter_details: [
          {
            kind: 'info',
            field: 'sort_price_desc',
            text: 'Сортировка по убыванию цены не подтверждена',
          },
        ],
      };
    }
    let next = appendParam(url, source.sort_price_desc_param, source.sort_price_desc_value);
    next = applySortExtras(next, source.sort_price_desc_extra_params);
    const appliedText =
      source.sort_price_desc_label
      || 'Сортировка: сначала дороже';
    return {
      url: next,
      price_sort: PRICE_SORT_DESC,
      sort_price_asc_applied: false,
      sort_price_desc_applied: true,
      sort_price_note: appliedText,
      filter_details: [{ kind: 'applied', field: 'sort_price_desc', text: appliedText }],
    };
  }

  return {
    url,
    price_sort: PRICE_SORT_DEFAULT,
    sort_price_asc_applied: false,
    sort_price_desc_applied: false,
    sort_price_note: null,
    filter_details: [],
  };
}

/** @deprecated используйте applyPriceSort; оставлено для старых вызовов. */
function applySortPriceAsc(source, url, preferCheaper) {
  return applyPriceSort(source, url, preferCheaper ? PRICE_SORT_ASC : PRICE_SORT_DEFAULT);
}

/**
 * Предпочтение доставки. "any" — без параметра.
 * "fastest" — только при delivery_fastest_verified + kind filter|sort.
 * Не добавляет «быстрая доставка» в {q}. Не выбирает город/ПВЗ/подписку.
 */
function applyDeliveryPreference(source, url, deliveryPreference, opts) {
  const priceSort =
    (opts && opts.price_sort)
    || ((opts && opts.prefer_cheaper) ? PRICE_SORT_ASC : PRICE_SORT_DEFAULT);
  const pref = normalizeDeliveryPreference(deliveryPreference) || DELIVERY_PREFERENCE_ANY;
  if (pref === DELIVERY_PREFERENCE_ANY) {
    return {
      url,
      delivery_preference: DELIVERY_PREFERENCE_ANY,
      delivery_fastest_applied: false,
      delivery_fastest_kind: null,
      delivery_note: null,
      filter_details: [],
    };
  }
  if (sortPreferencesConflict(source, priceSort, pref)) {
    return {
      url,
      delivery_preference: DELIVERY_PREFERENCE_FASTEST,
      delivery_fastest_applied: false,
      delivery_fastest_kind: 'sort',
      delivery_note:
        'Сортировка по сроку доставки не совмещена с сортировкой по цене — уточните приоритет на площадке',
      filter_details: [
        {
          kind: 'info',
          field: 'delivery_fastest',
          text: 'Сортировка по сроку доставки не совмещена с сортировкой по цене — уточните приоритет на площадке',
        },
      ],
    };
  }
  if (!deliveryFastestAllowed(source)) {
    return {
      url,
      delivery_preference: DELIVERY_PREFERENCE_FASTEST,
      delivery_fastest_applied: false,
      delivery_fastest_kind: null,
      delivery_note: 'Быстрая доставка в ссылке не подтверждена — уточните на площадке',
      filter_details: [
        {
          kind: 'info',
          field: 'delivery_fastest',
          text: 'Быстрая доставка в ссылке не подтверждена — уточните на площадке',
        },
      ],
    };
  }
  const kind = source.delivery_fastest_kind;
  const next = appendParam(url, source.delivery_fastest_param, source.delivery_fastest_value);
  const appliedText =
    kind === 'sort'
      ? 'Сортировка: как можно скорее'
      : 'Фильтр быстрой доставки передан в ссылку';
  const locationNote = source.delivery_fastest_requires_location
    ? ' Город и способ доставки уточните на площадке.'
    : '';
  return {
    url: next,
    delivery_preference: DELIVERY_PREFERENCE_FASTEST,
    delivery_fastest_applied: true,
    delivery_fastest_kind: kind,
    delivery_note: appliedText + locationNote,
    filter_details: [
      {
        kind: 'applied',
        field: 'delivery_fastest',
        text: appliedText + locationNote,
      },
    ],
  };
}

function buildUrl(source, parsed, opts) {
  const resolvedSort = resolvePriceSort(opts || {});
  const priceSort = resolvedSort.ok ? resolvedSort.priceSort : PRICE_SORT_DEFAULT;
  const preferCheaper = priceSort === PRICE_SORT_ASC;
  const deliveryPreference =
    normalizeDeliveryPreference(opts && opts.delivery_preference) || DELIVERY_PREFERENCE_ANY;
  const range = normalizeRange(parsed);
  const basePhrase = phraseForSource(parsed, source);
  const tmpl = String(source.url_template || '');
  const acceptsQuery = templateAcceptsQuery(source);
  let phrase = basePhrase;
  // Не подставляем пустой {q}: витрина без запроса помечается отдельно.
  let url;
  if (acceptsQuery) {
    if (!phrase || !String(phrase).trim()) {
      url = tmpl.replace(/[?&][^=]*=\{q\}/g, '').replace(/\{q\}/g, '');
      url = url.replace(/\?&/, '?').replace(/[?&]$/, '');
    } else {
      url = tmpl.replace('{q}', encodeURIComponent(phrase));
    }
  } else {
    url = tmpl.replace('{q}', '');
  }
  const price = applyPriceFilters(source, url, range);
  url = price.url;

  const caps = source.filter_capabilities || {};
  const nonPrice = describeNonPriceFilters(parsed, caps);
  let filter_details = [...price.filter_details, ...nonPrice.details];
  const inQuery = nonPrice.inQuery.slice();
  const unsupported = [...(price.unsupported_filters || []), ...nonPrice.unsupported];
  let price_filter_note = price.price_filter_note;
  // Бюджет словами в {q} больше не подставляем — только подтверждённые URL-параметры.
  const budget_in_query = false;

  const currency = source.price_currency || 'RUB';
  const wantsBudget = (range.min != null || range.max != null) && !range.invalid;

  if (!price.price_filter_applied && wantsBudget) {
    if (currency !== 'RUB') {
      // Рублёвый бюджет не подставляем в чужую валюту ни фильтром, ни словами.
      // Сообщение уже может быть в price.filter_details.
    } else if (!acceptsQuery) {
      filter_details = filter_details.filter((d) => d && d.field !== 'price' && d.field !== 'price_min' && d.field !== 'price_max');
      filter_details.push({
        kind: 'info',
        field: 'price',
        text: 'Переход на витрину без текстового поиска — бюджет в ссылку не передан.',
      });
      price_filter_note = 'Бюджет в ссылку не передан (витрина без поискового параметра).';
    } else {
      // Не пишем «до N рублей» / «дешевле» в поисковую фразу вместо фильтра.
      filter_details = filter_details.filter(
        (d) => !(d && (d.field === 'price' || d.field === 'price_min' || d.field === 'price_max') && d.kind === 'in_query')
      );
      const hasManualPrice = filter_details.some(
        (d) => d && (d.field === 'price' || d.field === 'price_min' || d.field === 'price_max')
      );
      if (!hasManualPrice) {
        filter_details.push({
          kind: 'manual',
          field: 'price',
          text: 'Бюджет в URL этой площадки не подтверждён — задайте диапазон на сайте.',
        });
      }
      price_filter_note = 'Бюджет в URL не подтверждён — в поисковую фразу не добавлялся.';
    }
  }

  if (acceptsQuery && (!phrase || !String(phrase).trim())) {
    filter_details.push({
      kind: 'info',
      field: 'query',
      text: 'Поисковая фраза пуста — открывается сайт без подстановки запроса.',
    });
  } else if (!acceptsQuery) {
    filter_details.push({
      kind: 'info',
      field: 'query',
      text: 'Шаблон без поискового параметра — переход на витрину/каталог, не страница поиска по запросу.',
    });
  }

  const sort = applyPriceSort(source, url, priceSort);
  url = sort.url;
  filter_details = filter_details.concat(sort.filter_details || []);
  const delivery = applyDeliveryPreference(source, url, deliveryPreference, {
    price_sort: priceSort,
    prefer_cheaper: preferCheaper,
  });
  url = delivery.url;
  filter_details = filter_details.concat(delivery.filter_details || []);
  const applied_filters = (price.applied_filters || []).slice();
  if (sort.sort_price_asc_applied) applied_filters.push('sort_price_asc');
  if (sort.sort_price_desc_applied) applied_filters.push('sort_price_desc');
  if (delivery.delivery_fastest_applied) {
    applied_filters.push(
      delivery.delivery_fastest_kind === 'sort' ? 'delivery_fastest_sort' : 'delivery_fastest_filter'
    );
  }

  const safe = safeHttpsUrl(url);
  return {
    url: safe || url,
    url_ok: !!safe,
    search_phrase_used: phrase,
    budget_in_query,
    price_filter_applied: price.price_filter_applied,
    price_filter_note,
    price_sort: sort.price_sort || priceSort,
    sort_price_asc_applied: !!sort.sort_price_asc_applied,
    sort_price_desc_applied: !!sort.sort_price_desc_applied,
    sort_price_asc_note: sort.sort_price_asc_applied ? sort.sort_price_note : (
      priceSort === PRICE_SORT_ASC ? sort.sort_price_note : null
    ),
    sort_price_desc_note: sort.sort_price_desc_applied ? sort.sort_price_note : (
      priceSort === PRICE_SORT_DESC ? sort.sort_price_note : null
    ),
    sort_price_note: sort.sort_price_note,
    delivery_preference: delivery.delivery_preference,
    delivery_fastest_applied: !!delivery.delivery_fastest_applied,
    delivery_fastest_kind: delivery.delivery_fastest_kind,
    delivery_note: delivery.delivery_note,
    filter_details,
    applied_filters,
    in_query_filters: inQuery,
    unsupported_filters: unsupported,
    verification_level: source.price_filter_verified
      ? 'price_url_verified'
      : 'base_url_only',
  };
}

async function search(input) {
  const parsed = input.parsed || {};
  const resolvedSort = resolvePriceSort(input || {});
  const priceSort = resolvedSort.ok ? resolvedSort.priceSort : PRICE_SORT_DEFAULT;
  const preferCheaper = priceSort === PRICE_SORT_ASC;
  const deliveryPreference =
    normalizeDeliveryPreference(input.delivery_preference || input.deliveryPreference)
    || DELIVERY_PREFERENCE_ANY;
  const phrase = parsed.search_phrase || parsed.raw_query || '';
  if (!phrase) {
    return { provider: 'links', items: [] };
  }

  const items = [];
  for (const source of input.sources || []) {
    if (!source || source.verified !== true) continue;
    try {
      const built = buildUrl(source, parsed, {
        price_sort: priceSort,
        prefer_cheaper: preferCheaper,
        delivery_preference: deliveryPreference,
      });
      const acceptsQuery = String(source.url_template || '').includes('{q}');
      const usedPhrase = built.search_phrase_used || phraseForSource(parsed, source) || phrase;
      let linkKind = source.link_kind || null;
      if (!acceptsQuery && !linkKind) linkKind = 'store_entry';
      if (acceptsQuery && (!usedPhrase || !String(usedPhrase).trim()) && !linkKind) {
        linkKind = 'store_entry';
      }
      items.push({
        id: source.id,
        name: source.name,
        type: source.type,
        type_label: TYPE_LABELS[source.type] || source.type,
        url: built.url,
        result_kind: source.result_kind || 'search_link',
        trust_level: source.trust_level || null,
        source_type: source.source_type || source.type,
        registry_id: source.registry_id || null,
        link_kind: linkKind,
        link_label: source.link_label || null,
        own_brand: !!source.own_brand,
        display_group: source.display_group || null,
        display_group_order: source.display_group_order || null,
        display_group_label: source.display_group_label || null,
        price: null,
        price_note: 'Цена на сайте',
        price_filter_applied: built.price_filter_applied,
        price_filter_note: built.price_filter_note,
        price_sort: built.price_sort,
        sort_price_asc_applied: !!built.sort_price_asc_applied,
        sort_price_desc_applied: !!built.sort_price_desc_applied,
        sort_price_asc_note: built.sort_price_asc_note,
        sort_price_desc_note: built.sort_price_desc_note,
        sort_price_note: built.sort_price_note,
        delivery_preference: built.delivery_preference,
        delivery_fastest_applied: !!built.delivery_fastest_applied,
        delivery_fastest_kind: built.delivery_fastest_kind,
        delivery_note: built.delivery_note,
        budget_in_query: !!built.budget_in_query,
        search_phrase_used: usedPhrase,
        phrase_accepts_query: acceptsQuery && !!(usedPhrase && String(usedPhrase).trim()),
        filter_details: built.filter_details,
        applied_filters: built.applied_filters,
        in_query_filters: built.in_query_filters,
        unsupported_filters: built.unsupported_filters,
        verification_level: built.verification_level,
      });
    } catch (e) {
      items.push({
        id: source.id,
        name: source.name,
        type: source.type,
        type_label: TYPE_LABELS[source.type] || source.type,
        url: null,
        result_kind: 'search_link',
        error: 'Не удалось построить ссылку для этой площадки.',
        filter_details: [{ kind: 'error', field: 'adapter', text: 'Ошибка адаптера: ссылка не построена.' }],
        applied_filters: [],
        in_query_filters: [],
        unsupported_filters: [],
        verification_level: 'error',
      });
    }
  }

  return { provider: 'links', items };
}

module.exports = {
  id: 'links',
  enabled: true,
  search,
  TYPE_LABELS,
  normalizeRange,
  applyPriceFilters,
  applySortPriceAsc,
  applyPriceSort,
  buildUrl,
  formatBudgetInQuery,
  phraseForSource,
  ALLOWED_HOSTS,
};
