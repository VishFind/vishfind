'use strict';

/**
 * Разбор текстового запроса правилами (без нейросети).
 * Неизвестные поля остаются null; известные → критерии; остаток → rest.
 * Массивы: ИЛИ внутри критерия. Совместимые singular-поля — первый элемент.
 */

const { flatCategoriesForParser, FEATURE_OPTIONS } = require('./criteria-catalog');
const { extractWordPriceRange, stripWordPrice } = require('./ru-amount');

const COLORS = [
  ['чёрный', ['черн', 'чёрн', 'black']],
  ['белый', ['бел', 'white']],
  ['красный', ['красн', 'red']],
  ['синий', ['син', 'blue']],
  ['голубой', ['голуб', 'light blue']],
  ['зелёный', ['зелен', 'зелён', 'green']],
  ['оливковый', ['оливк', 'olive']],
  ['коричневый', ['коричнев', 'brown']],
  ['бежевый', ['бежев', 'beige']],
  ['серый', ['сер', 'grey', 'gray']],
  ['розовый', ['розов', 'pink']],
  ['жёлтый', ['желт', 'жёлт', 'yellow']],
  ['оранжевый', ['оранж', 'orange']],
  ['бордовый', ['бордов', 'burgundy']],
  ['фиолетовый', ['фиолет', 'violet', 'purple']],
  ['хаки', ['хаки', 'khaki']],
  ['многоцветный', ['многоцвет', 'multicolor', 'multi-color']],
];

const CATEGORIES = flatCategoriesForParser();

const LETTER_SIZES = ['XXXL', 'XXL', 'XL', 'XXS', 'XS', 'S', 'M', 'L'];

const FEATURE_STEMS = (() => {
  const out = [];
  const groups = FEATURE_OPTIONS || {};
  for (const g of Object.values(groups)) {
    for (const v of g.values || []) {
      const n = String(v).toLowerCase().replace(/ё/g, 'е');
      out.push({ id: v, stems: [n, n.replace(/оверсайз|oversize/g, 'оверсайз')] });
    }
  }
  // Частые формы поверх справочника
  out.push(
    { id: 'oversize', stems: ['оверсайз', 'оверсайза', 'oversize', 'oversized'] },
    { id: 'винтаж', stems: ['винтаж', 'vintage'] },
    { id: 'кожа', stems: ['кожан'] } // «кожаная» как материал, если тип не «кожаная куртка»
  );
  return out;
})();

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function firstOf(list) {
  return list && list.length ? list[0] : null;
}

function findMovie(query, movies) {
  const s = norm(query);
  if (!s) return null;
  return (
    (movies || []).find((m) =>
      (m.triggers || []).some((t) => {
        const i = s.indexOf(norm(t));
        return i === 0 || (i > 0 && !/[a-zа-я0-9]/.test(s[i - 1]));
      })
    ) || null
  );
}

function parseAmount(numStr, unit) {
  let n = Number(String(numStr).replace(/[\s\u00a0\u202f]/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = unit || '';
  if (/тыс|т\.?\s?р|[кk]/i.test(u)) n *= 1000;
  if (n < 0 || n > 5_000_000) return null;
  return Math.round(n);
}

const UNIT =
  '(тыс(?:яч)?\\.?|т\\.?\\s?р\\.?|к(?![а-яa-z0-9])|k(?![a-z0-9])|руб(?:лей|ля)?|₽)?';
const NUM = '(\\d[\\d\\s\\u00a0\\u202f]*)';

/**
 * Диапазон цены из текста.
 * budget — совместимый максимум (alias budget_max).
 * Пустое ограничение = null, не 0.
 */
function extractPriceRange(query) {
  const s = norm(query);
  let budget_min = null;
  let budget_max = null;

  // Сначала словесные формы: «от трёх до восьми тысяч», «до пяти тысяч»
  const words = extractWordPriceRange(query);
  if (words.budget_min != null || words.budget_max != null) {
    return finalizeRange(words.budget_min, words.budget_max);
  }

  // «от 5000 до 15000», «от 5к до 15 тыс», «от 3 до 8 тысяч»
  let m = s.match(
    new RegExp(`от\\s*${NUM}\\s*${UNIT}\\s*до\\s*${NUM}\\s*${UNIT}`)
  );
  if (m) {
    const u1 = m[2] || '';
    const u2 = m[4] || '';
    // Единица на второй границе распространяется на первую («от 3 до 8 тысяч»).
    const unitMin = u1 || u2;
    const unitMax = u2 || u1;
    budget_min = parseAmount(m[1], unitMin);
    budget_max = parseAmount(m[3], unitMax);
    if (budget_min != null && budget_min < 100) budget_min = null;
    if (budget_max != null && budget_max < 100) budget_max = null;
    return finalizeRange(budget_min, budget_max);
  }

  // «до 15 000», «до 15к», «не дороже 7000», «не выше 10 тыс»
  m = s.match(
    new RegExp(
      `(?:до|не\\s+дороже|не\\s+выше|не\\s+более|не\\s+больше)\\s*${NUM}\\s*${UNIT}`
    )
  );
  if (m) {
    const n = parseAmount(m[1], m[2]);
    if (n != null && n >= 100) budget_max = n;
  }

  // «от 5000», «от 5к»
  m = s.match(new RegExp(`от\\s*${NUM}\\s*${UNIT}`));
  if (m) {
    const n = parseAmount(m[1], m[2]);
    if (n != null && n >= 100) budget_min = n;
  }

  // «бюджет 20000», «максимум 15к»
  if (budget_max == null) {
    m = s.match(
      new RegExp(`(?:бюджет[ае]?\\s*|max\\s*|максимум\\s*)${NUM}\\s*${UNIT}`)
    );
    if (m) {
      const n = parseAmount(m[1], m[2]);
      if (n != null && n >= 100) budget_max = n;
    }
  }

  // «15к» / «15 тыс» без «до» — как верхняя граница (совместимость)
  if (budget_max == null && budget_min == null) {
    m = s.match(/(?<![a-zа-я0-9])(\d{1,3})\s*[кk](?![a-zа-я0-9])/);
    if (m) {
      const n = Number(m[1]) * 1000;
      if (n >= 1000 && n <= 5_000_000) budget_max = n;
    }
  }
  if (budget_max == null && budget_min == null) {
    m = s.match(
      /(?<![a-zа-я0-9])(\d{1,3}(?:[\s\u00a0\u202f]\d{3})?|\d{4,7})\s*тыс(?:яч)?\.?(?![a-zа-я0-9])/
    );
    if (m) {
      const n = Number(String(m[1]).replace(/[\s\u00a0\u202f]/g, '')) * 1000;
      if (n >= 1000 && n <= 5_000_000) budget_max = Math.round(n);
    }
  }

  return finalizeRange(budget_min, budget_max);
}

function finalizeRange(min, max) {
  let budget_min = min;
  let budget_max = max;
  const budget = budget_max;
  return { budget_min, budget_max, budget };
}

/** @deprecated используйте extractPriceRange; оставлен для совместимости */
function extractBudget(query) {
  return extractPriceRange(query).budget;
}

function isNegatedAt(s, index) {
  const before = s.slice(Math.max(0, index - 6), index);
  return /(?:^|[^a-zа-я0-9])не\s+$/i.test(before);
}

function extractColors(query) {
  const s = norm(query);
  const found = [];
  const negated = [];
  for (const [name, stems] of COLORS) {
    let hit = false;
    let neg = false;
    for (const st of stems) {
      const nst = norm(st);
      if (!nst) continue;
      let from = 0;
      let i;
      while ((i = s.indexOf(nst, from)) !== -1) {
        if (isNegatedAt(s, i)) neg = true;
        else hit = true;
        from = i + nst.length;
      }
    }
    if (neg) negated.push(name);
    if (hit && !found.includes(name)) found.push(name);
  }
  return { colors: found, negated };
}

function extractColor(query) {
  return firstOf(extractColors(query).colors);
}

function extractCategories(query) {
  const s = norm(query);
  const found = [];
  // Сначала многословные, затем однословные; не дублируем.
  const pass = (multiOnly) => {
    for (const [name, stems] of CATEGORIES) {
      if (multiOnly !== name.includes(' ')) continue;
      if (found.includes(name)) continue;
      // Не подменять: если уже есть более длинная категория, содержащая эту — пропуск короткой.
      if (!multiOnly && found.some((f) => f.includes(name) || name.includes(f))) continue;
      if (stems.some((st) => st && s.includes(norm(st)))) found.push(name);
    }
  };
  pass(true);
  pass(false);
  // Если есть «кожаная куртка» и отдельно «куртка» — оставить длинную.
  return found.filter((name, idx, arr) => {
    if (name.includes(' ')) return true;
    return !arr.some((other, j) => j !== idx && other.includes(name));
  });
}

function extractCategory(query) {
  return firstOf(extractCategories(query));
}

function extractSizes(query) {
  const raw = String(query || '');
  const found = [];
  const push = (v) => {
    const u = String(v).toUpperCase();
    if ((LETTER_SIZES.includes(u) || /^\d{2,3}$/.test(u)) && !found.includes(u)) {
      found.push(u);
    }
  };

  // «размер M», «размер 42», «размеры M или L», «размер 42, 44»
  // \bsize\b — не резать «oversize».
  const reLabeled =
    /(?:размер(?:ы|ов)?|р-р|р\/р|\bsize\b)\s*[:\-]?\s*([a-zA-Z]{1,4}|\d{2,3})(?:\s*(?:или|,|\/|и)\s*([a-zA-Z]{1,4}|\d{2,3}))?/gi;
  let m;
  while ((m = reLabeled.exec(raw))) {
    push(m[1]);
    if (m[2]) push(m[2]);
  }

  const upper = raw.toUpperCase();
  for (const sz of LETTER_SIZES) {
    const re = new RegExp(`(?:^|[^A-ZА-Я0-9])${sz}(?:[^A-ZА-Я0-9]|$)`, 'i');
    if (re.test(upper) && new RegExp(`(?:размер|р-р|\\bsize\\b|\\s)${sz}\\b`, 'i').test(raw)) {
      push(sz);
    }
  }
  return found;
}

function extractSize(query) {
  return firstOf(extractSizes(query));
}

function extractBrands(query, brands) {
  const s = norm(query);
  const found = [];
  // Длинные названия раньше коротких, чтобы не резать «New Balance» на «New».
  const sorted = (brands || [])
    .slice()
    .sort((a, b) => norm(b).length - norm(a).length);
  const occupied = [];

  function overlaps(start, end) {
    return occupied.some(([a, b]) => start < b && end > a);
  }

  for (const b of sorted) {
    const nb = norm(b);
    if (!nb) continue;
    let from = 0;
    let i;
    while ((i = s.indexOf(nb, from)) !== -1) {
      const before = i === 0 || !/[a-zа-я0-9]/.test(s[i - 1]);
      const after = i + nb.length >= s.length || !/[a-zа-я0-9]/.test(s[i + nb.length]);
      if (before && after && !overlaps(i, i + nb.length)) {
        if (!found.includes(b)) found.push(b);
        occupied.push([i, i + nb.length]);
        break;
      }
      from = i + nb.length;
    }
  }
  return found;
}

function extractBrand(query, brands) {
  return firstOf(extractBrands(query, brands));
}

function stemInText(s, st) {
  const nst = norm(st);
  if (!nst) return false;
  // Короткие основы («лён»→лен) только как целое слово — иначе «лен» внутри «зелен».
  if (nst.length < 4) {
    return new RegExp(
      `(?:^|[^a-zа-я0-9])${nst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-zа-я0-9]|$)`,
      'i'
    ).test(s);
  }
  return s.includes(nst);
}

function extractFeatures(query, opts) {
  const s = norm(query);
  const found = [];
  const skipMaterialLeather = !!(opts && opts.hasLeatherCategory);
  for (const row of FEATURE_STEMS) {
    if (skipMaterialLeather && row.id === 'кожа') continue;
    if (row.stems.some((st) => stemInText(s, st))) {
      if (!found.includes(row.id)) found.push(row.id);
    }
  }
  return found;
}

const STOP_REST = new Set(
  [
    'как', 'у', 'из', 'в', 'на', 'и', 'или', 'для', 'про', 'это', 'тот', 'та', 'те',
    'фильм', 'фильма', 'фильме', 'кино', 'клуба', 'клуб', 'ого', 'его', 'ее', 'её',
    'найди', 'найти', 'ищу', 'хочу', 'нужна', 'нужен', 'нужно', 'пожалуйста', 'мне',
    'вещь', 'вещи', 'одежду', 'одежда', 'похожее', 'похожая', 'похожий',
    'дороже', 'выше', 'более', 'больше', // хвосты после «не дороже N» уже сняты числом
  ].map(norm)
);

function stripFound(query, pieces) {
  let rest = String(query || '');
  for (const p of pieces) {
    if (!p) continue;
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    rest = rest.replace(re, ' ');
  }
  const wordPrice = extractWordPriceRange(query);
  if (wordPrice.matched) rest = stripWordPrice(rest, wordPrice.matched);

  rest = rest
    .replace(
      /от\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?\.?|т\.?\s?р\.?|[кk]|руб(?:лей|ля)?|₽)?\s*до\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?\.?|т\.?\s?р\.?|[кk]|руб(?:лей|ля)?|₽)?/gi,
      ' '
    )
    .replace(
      /от\s+[а-яё\s]+?\s+до\s+[а-яё\s]+?тысяч[а-яё]*/gi,
      ' '
    )
    .replace(
      /(?:до|не\s+дороже|не\s+выше)\s+[а-яё\s]+?тысяч[а-яё]*/gi,
      ' '
    )
    .replace(
      /(?:до|не\s+дороже|не\s+выше|не\s+более|не\s+больше)\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?\.?|т\.?\s?р\.?|[кk]|руб(?:лей|ля)?|₽)?/gi,
      ' '
    )
    .replace(/от\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?\.?|т\.?\s?р\.?|[кk]|руб(?:лей|ля)?|₽)?/gi, ' ')
    .replace(/(?:бюджет[ае]?|max|максимум)\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?\.?|[кk]|руб|₽)?/gi, ' ')
    .replace(/(?<![a-zа-я0-9])\d{1,3}\s*[кk](?![a-zа-я0-9])/gi, ' ')
    .replace(/(?<![a-zа-я0-9])\d{1,3}(?:[\s\u00a0\u202f]\d{3})?\s*тыс(?:яч)?\.?(?![a-zа-я0-9])/gi, ' ')
    .replace(
      /(?:размер(?:ы|ов)?|р-р|р\/р|\bsize\b)\s*[:\-]?\s*([a-zA-Z]{1,4}|\d{2,3})(?:\s*(?:или|,|\/|и)\s*([a-zA-Z]{1,4}|\d{2,3}))?/gi,
      ' '
    )
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
  return rest;
}

function cleanRest(rest, parsed) {
  if (!rest) return null;
  const keep = new Set((parsed.keepColorStems || []).map(norm));
  const colorStems = [];
  for (const c of parsed.colors || (parsed.color ? [parsed.color] : [])) {
    if (keep.has(norm(c))) continue;
    const entry = COLORS.find(([name]) => name === c);
    if (entry) colorStems.push(...entry[1].map(norm));
    colorStems.push(norm(c));
  }
  const catStems = [];
  for (const cat of parsed.categories || (parsed.category ? [parsed.category] : [])) {
    const entry = CATEGORIES.find(([name]) => name === cat);
    if (entry) catStems.push(...entry[1].map(norm));
    for (const part of String(cat).split(/\s+/)) {
      if (part.length >= 3) catStems.push(norm(part));
    }
  }
  const brandNorms = (parsed.brands || (parsed.brand ? [parsed.brand] : [])).map(norm);
  const featureStems = (parsed.features || []).flatMap((f) => {
    const row = FEATURE_STEMS.find((r) => r.id === f);
    return row ? row.stems.map(norm) : [norm(f)];
  });

  const rawWords = rest
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const words = rawWords.filter((w, i) => {
    const nw = norm(w);
    // Частица «не» перед цветом/словом — сохраняем (отрицание).
    if (nw === 'не') {
      const next = rawWords[i + 1];
      return !!(next && String(next).trim());
    }
    if (nw.length < 3) return false;
    if (STOP_REST.has(nw)) return false;
    if (colorStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
    if (catStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
    if (brandNorms.some((b) => nw === b)) return false;
    return true;
  });
  return words.length ? words.join(' ') : null;
}

/**
 * Базовая поисковая фраза: тип, цвет, бренд, особенности, значимые слова, размер.
 * Цену в фразу не включаем.
 */
function buildSearchPhrase(parsed, movie) {
  const parts = [];
  const pushUnique = (w) => {
    if (!w) return;
    const nw = norm(w);
    if (!parts.some((p) => norm(p) === nw)) parts.push(w);
  };

  for (const b of parsed.brands || (parsed.brand ? [parsed.brand] : [])) pushUnique(b);
  for (const c of parsed.colors || (parsed.color ? [parsed.color] : [])) pushUnique(c);
  for (const cat of parsed.categories || (parsed.category ? [parsed.category] : [])) {
    pushUnique(cat);
  }
  if (movie && movie.search_phrase) {
    const movieBits = String(movie.search_phrase).split(/\s+/).filter(Boolean);
    for (const w of movieBits) {
      const nw = norm(w);
      const colors = parsed.colors || (parsed.color ? [parsed.color] : []);
      const cats = parsed.categories || (parsed.category ? [parsed.category] : []);
      if (colors.some((c) => nw.includes(norm(c).slice(0, 4)) || norm(c).includes(nw.slice(0, 4)))) {
        continue;
      }
      if (cats.some((c) => nw.includes(norm(c).slice(0, 4)) || norm(c).includes(nw.slice(0, 4)))) {
        continue;
      }
      pushUnique(w);
    }
  }
  for (const f of parsed.features || []) pushUnique(f);
  if (parsed.rest) {
    const rw = parsed.rest.split(/\s+/).filter(Boolean);
    for (let i = 0; i < rw.length; i++) {
      const w = rw[i];
      if (norm(w) === 'не' && rw[i + 1]) {
        pushUnique(`не ${rw[i + 1]}`);
        i += 1;
        continue;
      }
      if (w.length < 3) continue;
      pushUnique(w);
    }
  }
  const sizes = parsed.sizes || (parsed.size ? [parsed.size] : []);
  for (const sz of sizes) pushUnique(`размер ${sz}`);
  const phrase = parts.join(' ').replace(/\s+/g, ' ').trim();
  return phrase || null;
}

/**
 * @param {string} query
 * @param {{ movies?: object[], brands?: string[] }} opts
 */
function parseQuery(query, opts = {}) {
  const q = String(query || '').trim();
  const movies = opts.movies || [];
  const brands = opts.brands || [];
  const warnings = [];

  const movie = findMovie(q, movies);
  const range = extractPriceRange(q);
  const sizes = extractSizes(q);
  const size = firstOf(sizes);
  const colorInfo = extractColors(q);
  let colors = colorInfo.colors.slice();
  if (colorInfo.negated.length) {
    warnings.push(
      'Исключения («не …») штатным фильтром площадок не применяются — формулировка сохранена в тексте запроса.'
    );
    // Негации не превращаем в положительный цвет.
    colors = colors.filter((c) => !colorInfo.negated.includes(c));
  }
  if (!colors.length && movie && movie.color) colors = [movie.color];
  const color = firstOf(colors);

  let categories = extractCategories(q);
  if (!categories.length && movie && movie.category) categories = [movie.category];
  const category = firstOf(categories);

  const brandList = extractBrands(q, brands);
  const brand = firstOf(brandList);

  const hasLeatherCategory = categories.some((c) => /кожан/i.test(c));
  const features = extractFeatures(q, { hasLeatherCategory });

  const stripPieces = [...brandList, ...(movie ? movie.triggers || [] : [])];
  for (const c of colors) {
    stripPieces.push(c, c.replace(/ё/g, 'е'));
    const entry = COLORS.find(([name]) => name === c);
    if (entry) {
      for (const st of entry[1]) {
        // Словоформы цвета: чёрн/черн + окончания
        stripPieces.push(st + 'ый', st + 'ая', st + 'ое', st + 'ые', st + 'ую', st + 'ой');
      }
    }
  }
  for (const cat of categories) stripPieces.push(cat);
  if (movie && movie.title) stripPieces.push(movie.title);

  let restRaw = stripFound(q, stripPieces);

  let rest = cleanRest(restRaw, {
    colors,
    color,
    categories,
    category,
    brands: brandList,
    brand,
    features,
    // Не вычищать отрицаемые цвета из rest — иначе «не красный» станет «красный».
    keepColorStems: colorInfo.negated,
  });

  if (colorInfo.negated.length) {
    for (const c of colorInfo.negated) {
      const bit = 'не ' + c;
      if (!norm(rest || '').includes(norm(c))) {
        rest = [rest, bit].filter(Boolean).join(' ');
      } else if (!/(?:^|\s)не\s+/i.test(rest || '')) {
        // Слово цвета есть, но частица «не» потеряна при strip — вернуть честную формулировку.
        rest = (rest || '').replace(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), bit);
        if (!norm(rest).includes('не')) rest = [bit, rest].filter(Boolean).join(' ');
      }
    }
  }

  const parsed = {
    budget: range.budget,
    budget_min: range.budget_min,
    budget_max: range.budget_max,
    size,
    sizes,
    color,
    colors,
    category,
    categories,
    brand,
    brands: brandList,
    features,
    movie: movie
      ? {
          title: movie.title,
          description: movie.description || null,
          search_phrase: movie.search_phrase || null,
        }
      : null,
    rest,
    warnings,
  };

  const search_phrase = buildSearchPhrase(parsed, movie);
  return {
    ...parsed,
    search_phrase,
    raw_query: q,
  };
}

module.exports = {
  parseQuery,
  buildSearchPhrase,
  findMovie,
  extractBudget,
  extractPriceRange,
  extractColors,
  extractBrands,
  extractSizes,
  extractCategories,
  norm,
  COLORS,
};
