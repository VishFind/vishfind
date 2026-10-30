'use strict';

/**
 * Единая модель критериев поиска.
 * Массивы = ИЛИ внутри критерия; разные критерии = И.
 * Совместимость: одиночные поля читаются как один элемент массива.
 */

const { buildSearchPhrase, buildCompactSearchPhrase } = require('./parse-query');

const MAX_MULTI = 8;

function asList(value) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = String(item == null ? '' : item).trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/ё/g, 'е');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_MULTI) break;
  }
  return out;
}

function firstOf(list) {
  return list && list.length ? list[0] : null;
}

function parsePrice(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[\s\u00a0\u202f]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 5_000_000) return null;
  return Math.round(n);
}

function isPriceSet(v) {
  return parsePrice(v) != null;
}

/**
 * Нормализация attributes / parsed / criteria из истории.
 */
function listFromPluralOrSingular(plural, singular) {
  // Пустой массив [] не должен затирать заполненное одиночное поле
  // (типичный случай: emptyParsed + mergeVision → category без categories).
  const fromPlural = asList(plural);
  if (fromPlural.length) return fromPlural;
  return asList(singular);
}

function normalizeCriteria(input) {
  const src = input && typeof input === 'object' ? input : {};
  const categories = listFromPluralOrSingular(src.categories, src.category);
  const colors = listFromPluralOrSingular(src.colors, src.color);
  const sizes = listFromPluralOrSingular(src.sizes, src.size);
  const brands = listFromPluralOrSingular(src.brands, src.brand);
  const features = asList(src.features != null ? src.features : null);
  let rest = src.rest != null ? String(src.rest).trim() : '';
  if (!rest && features.length) rest = features.join(' ');

  let budget_min = parsePrice(src.budget_min != null ? src.budget_min : src.price_min);
  let budget_max = parsePrice(
    src.budget_max != null
      ? src.budget_max
      : src.budget != null
        ? src.budget
        : src.price_max
  );
  if (budget_min == null && budget_max == null && src.budget != null) {
    budget_max = parsePrice(src.budget);
  }
  const budget = budget_max;

  return {
    categories,
    colors,
    sizes,
    brands,
    features,
    rest: rest || null,
    budget_min,
    budget_max,
    budget,
    category: firstOf(categories),
    color: firstOf(colors),
    size: firstOf(sizes),
    brand: firstOf(brands),
  };
}

function priceError(criteria) {
  const min = criteria.budget_min;
  const max = criteria.budget_max;
  if (min != null && max != null && min > max) {
    return 'Цена «от» не может быть больше цены «до». Исправьте диапазон.';
  }
  return null;
}

function sizeMixNote(sizes) {
  if (!sizes || sizes.length < 2) return null;
  const letter = sizes.some((s) => /^[A-Z]{1,4}$/i.test(s));
  const numeric = sizes.some((s) => /^\d{2,3}$/.test(s));
  if (letter && numeric) {
    return 'Выбраны и буквенные, и числовые размеры. Системы размеров не переводим — на площадке проверьте оба варианта.';
  }
  return null;
}

/**
 * Слияние текста (parsed) и ручных attributes.
 * priority=true: непустые attrs перекрывают текст.
 * clearList: явный сброс (не возвращать из текста).
 */
function mergeCriteria(parsed, attrs, opts) {
  const priority = !!(opts && opts.priority);
  const clearList = Array.isArray(opts && opts.clear) ? opts.clear : [];
  const clear = new Set(clearList.map(String));
  const base = normalizeCriteria(parsed || {});
  const manual = normalizeCriteria(attrs || {});
  const out = { ...base };

  function applyField(plural, singular) {
    const cleared =
      clear.has(singular) || clear.has(plural) || clear.has(singular + 's');
    if (cleared) {
      out[plural] = [];
      out[singular] = null;
      return;
    }
    if (priority && manual[plural].length) {
      out[plural] = manual[plural].slice();
      out[singular] = firstOf(out[plural]);
    } else if (!out[plural].length && manual[plural].length) {
      out[plural] = manual[plural].slice();
      out[singular] = firstOf(out[plural]);
    }
  }

  applyField('categories', 'category');
  applyField('colors', 'color');
  applyField('sizes', 'size');
  applyField('brands', 'brand');
  // features — список без singular-алиаса
  if (clear.has('features')) {
    out.features = [];
  } else if (priority && manual.features.length) {
    out.features = manual.features.slice();
  } else if (!out.features.length && manual.features.length) {
    out.features = manual.features.slice();
  }

  if (clear.has('rest') || clear.has('features')) {
    out.rest = null;
    out.features = [];
  } else if (priority && (manual.rest || manual.features.length)) {
    out.rest = manual.rest;
    out.features = manual.features.length ? manual.features : asList(manual.rest);
  } else if (!out.rest && manual.rest) {
    out.rest = manual.rest;
    out.features = asList(manual.rest);
  }

  const clearAllPrice = clear.has('budget') || clear.has('price');
  const clearMin = clearAllPrice || clear.has('budget_min') || clear.has('price_min');
  const clearMax = clearAllPrice || clear.has('budget_max') || clear.has('price_max');

  if (clearMin) out.budget_min = null;
  else if (priority && isPriceSet(attrs && (attrs.budget_min != null ? attrs.budget_min : attrs.price_min))) {
    out.budget_min = manual.budget_min;
  } else if (out.budget_min == null && manual.budget_min != null) {
    out.budget_min = manual.budget_min;
  }

  if (clearMax) {
    out.budget_max = null;
    out.budget = null;
  } else if (
    priority
    && isPriceSet(
      attrs
        && (attrs.budget_max != null
          ? attrs.budget_max
          : attrs.budget != null
            ? attrs.budget
            : attrs.price_max)
    )
  ) {
    out.budget_max = manual.budget_max;
    out.budget = out.budget_max;
  } else if (out.budget_max == null && out.budget == null && manual.budget_max != null) {
    out.budget_max = manual.budget_max;
    out.budget = out.budget_max;
  }

  if (out.budget == null && out.budget_max != null) out.budget = out.budget_max;
  if (out.budget_max == null && out.budget != null) out.budget_max = out.budget;

  // Для search_phrase: plural → join; короткие размеры не кладём в rest
  // (buildSearchPhrase отбрасывает токены короче 3 символов).
  const phraseSource = {
    brands: out.brands,
    brand: out.brands.join(' ') || null,
    colors: out.colors,
    color: out.colors.join(' ') || null,
    categories: out.categories,
    category: out.categories.join(' ') || null,
    sizes: out.sizes.length === 1 ? out.sizes : [],
    size: out.sizes.length === 1 ? out.sizes[0] : null,
    features: out.features,
    rest: out.rest,
    movie: parsed && parsed.movie,
  };
  // Магазинная фраза всегда компактная (тип + 1–2 значимых признака).
  const userFeatures = Array.isArray(attrs && attrs.features) ? attrs.features : [];
  let phrase =
    buildCompactSearchPhrase(phraseSource, { userFeatures }) ||
    buildSearchPhrase(phraseSource, parsed && parsed.movie) ||
    '';
  if (out.sizes.length > 1) {
    const sizeBits = out.sizes.map((s) => 'размер ' + s).join(' ');
    phrase = [phrase, sizeBits].filter(Boolean).join(' ').trim();
  }
  out.search_phrase = phrase || null;
  out.raw_query = (parsed && parsed.raw_query) || '';
  out.movie = (parsed && parsed.movie) || null;
  out.warnings = [];
  if (parsed && Array.isArray(parsed.warnings)) {
    for (const w of parsed.warnings) if (w && !out.warnings.includes(w)) out.warnings.push(w);
  }
  const mix = sizeMixNote(out.sizes);
  if (mix) out.warnings.push(mix);
  const pe = priceError(out);
  if (pe) out.warnings.push(pe);
  return out;
}

function publicCriteria(c) {
  if (!c) return null;
  return {
    budget: c.budget != null ? c.budget : null,
    budget_min: c.budget_min != null ? c.budget_min : null,
    budget_max: c.budget_max != null ? c.budget_max : c.budget != null ? c.budget : null,
    size: c.size != null ? c.size : firstOf(c.sizes),
    color: c.color != null ? c.color : firstOf(c.colors),
    category: c.category != null ? c.category : firstOf(c.categories),
    brand: c.brand != null ? c.brand : firstOf(c.brands),
    sizes: Array.isArray(c.sizes) ? c.sizes.slice() : asList(c.size),
    colors: Array.isArray(c.colors) ? c.colors.slice() : asList(c.color),
    categories: Array.isArray(c.categories) ? c.categories.slice() : asList(c.category),
    brands: Array.isArray(c.brands) ? c.brands.slice() : asList(c.brand),
    features: Array.isArray(c.features) ? c.features.slice() : [],
    movie: c.movie || null,
    rest: c.rest || null,
    search_phrase: c.search_phrase || null,
    warnings: Array.isArray(c.warnings) ? c.warnings.slice() : [],
  };
}

module.exports = {
  MAX_MULTI,
  asList,
  firstOf,
  parsePrice,
  isPriceSet,
  normalizeCriteria,
  mergeCriteria,
  publicCriteria,
  priceError,
  sizeMixNote,
};
