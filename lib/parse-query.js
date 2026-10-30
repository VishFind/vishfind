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

/**
 * Модель / артикул / номер в обозначении (Air Force 1, Samba OG, 550).
 * Не путать с буквенными размерами S/M/L.
 */
function isModelOrSkuToken(w) {
  const t = String(w || '').trim();
  if (!t) return false;
  const upper = t.toUpperCase();
  if (LETTER_SIZES.includes(upper)) return false;
  if (/^\d+[A-Za-z0-9/-]*$/.test(t)) return true;
  if (/^[A-Za-z]+[0-9][A-Za-z0-9/-]*$/.test(t)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*[-/][A-Za-z0-9-]+$/.test(t)) return true;
  if (/^[A-Za-z]{1,4}$/.test(t)) return true;
  if (/^[A-Za-z][A-Za-z0-9'.&+-]*$/.test(t)) return true;
  return false;
}

/** Ключ дедупа признаков: oversize / oversized / оверсайз → один. */
function attrDedupeKey(w) {
  const n = norm(w);
  if (/^(oversize|oversized|оверсайз)/.test(n)) return '#oversize';
  return n;
}

const COLOR_AGREEMENT = {
  черный: ['чёрный', 'чёрная', 'чёрное', 'чёрные'],
  белый: ['белый', 'белая', 'белое', 'белые'],
  красный: ['красный', 'красная', 'красное', 'красные'],
  синий: ['синий', 'синяя', 'синее', 'синие'],
  голубой: ['голубой', 'голубая', 'голубое', 'голубые'],
  зеленый: ['зелёный', 'зелёная', 'зелёное', 'зелёные'],
  оливковый: ['оливковый', 'оливковая', 'оливковое', 'оливковые'],
  коричневый: ['коричневый', 'коричневая', 'коричневое', 'коричневые'],
  бежевый: ['бежевый', 'бежевая', 'бежевое', 'бежевые'],
  серый: ['серый', 'серая', 'серое', 'серые'],
  розовый: ['розовый', 'розовая', 'розовое', 'розовые'],
  желтый: ['жёлтый', 'жёлтая', 'жёлтое', 'жёлтые'],
  оранжевый: ['оранжевый', 'оранжевая', 'оранжевое', 'оранжевые'],
  бордовый: ['бордовый', 'бордовая', 'бордовое', 'бордовые'],
  фиолетовый: ['фиолетовый', 'фиолетовая', 'фиолетовое', 'фиолетовые'],
  хаки: ['хаки', 'хаки', 'хаки', 'хаки'],
  многоцветный: ['многоцветный', 'многоцветная', 'многоцветное', 'многоцветные'],
};

function categoryGender(category) {
  const last = norm(String(category || '').trim().split(/\s+/).pop());
  if (!last) return 'masculine';
  if (
    /^(джинсы|брюки|кроссовки|ботинки|шорты|туфли|очки)$/.test(last)
    || /(джинсы|брюки|кроссовки|ботинки|шорты)$/.test(last)
  ) {
    return 'plural';
  }
  if (/^(пальто|платье|худи)$/.test(last)) return 'neuter';
  if (
    /(а|я)$/.test(last)
    || /(куртка|рубашка|футболка|ветровка|юбка|сумка|кофта|толстовка|майка|куртк)/.test(last)
  ) {
    return 'feminine';
  }
  return 'masculine';
}

/**
 * Согласование цвета с типом. Если надёжной формы нет —
 * { mode:'safe' } → подпись «Тип · цвет цвет».
 */
function agreeColorRu(colorLemma, category) {
  const color = String(colorLemma || '').trim();
  const cat = String(category || '').trim();
  if (!color) return { mode: 'none' };
  if (!cat) return { mode: 'agree', color, category: null };
  const forms = COLOR_AGREEMENT[norm(color)];
  if (!forms) return { mode: 'safe', color, category: cat };
  const g = categoryGender(cat);
  const idx = g === 'feminine' ? 1 : g === 'neuter' ? 2 : g === 'plural' ? 3 : 0;
  return { mode: 'agree', color: forms[idx], category: cat };
}

function capitalizeRu(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
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
    // Короткие служебные отбрасываем; цифры/артикулы/латиницу модели — нет.
    if (nw.length < 3 && !isModelOrSkuToken(w)) return false;
    if (STOP_REST.has(nw)) return false;
    if (colorStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
    if (catStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
    if (brandNorms.some((b) => nw === b)) return false;
    return true;
  });
  return words.length ? words.join(' ') : null;
}

const MATERIAL_HINT =
  /^(кожа\w*|замш\w*|деним|джинс\w*|хлоп\w*|шерст\w*|шёлк\w*|шелк\w*|лён|лен|нейлон\w*|материал)/i;
const SECONDARY_DETAIL =
  /карман|шов|застёж|застеж|молни|пуговиц|воротник|капюшон|манжет|фурнитур|отложной|свободн\w*\s+крой|крой|детал/i;
const FIT_HINT = /^(oversize|oversized|оверсайз)/i;
const TEXTURE_HINT = /^(вафельн\w*|стеган\w*|жаккард\w*|рубчик\w*|букл\w*)/i;
const LENGTH_HINT = /^(коротк\w*|длинн\w*|укороч\w*|макси\w*|мини\w*)/i;
const PATTERN_HINT = /^(меланж\w*|полосат\w*|клетчат\w*|камуфл\w*|принтов\w*)/i;
const VINTAGE_HINT = /^(винтаж\w*|vintage)/i;

/**
 * Классификация признака для короткой фразы.
 * secondary — мелочи кроя; в короткую фразу не кладём (полный разбор — в «Что распозналось»).
 */
function classifyAttrToken(tok) {
  const raw = String(tok || '').trim();
  if (!raw) return null;
  if (isModelOrSkuToken(raw)) return { token: raw, kind: 'model', score: 0 };
  if (SECONDARY_DETAIL.test(raw)) return { token: raw, kind: 'secondary', score: 0 };
  if (MATERIAL_HINT.test(raw)) return { token: raw, kind: 'material', score: 100 };
  if (FIT_HINT.test(raw)) return { token: 'оверсайз', kind: 'fit', score: 90 };
  if (VINTAGE_HINT.test(raw)) return { token: 'винтаж', kind: 'vintage', score: 85 };
  if (TEXTURE_HINT.test(raw)) return { token: raw, kind: 'texture', score: 80 };
  if (LENGTH_HINT.test(raw)) return { token: raw, kind: 'length', score: 70 };
  if (PATTERN_HINT.test(raw)) return { token: raw, kind: 'pattern', score: 40 };
  if (raw.length < 3) return null;
  return { token: raw, kind: 'other', score: 25 };
}

/** До 2 значимых признаков; secondary пропускаем. Явные userFeatures сохраняем. */
function pickSignificantAttrs(tokens, opts) {
  const o = opts || {};
  const max = o.max != null ? o.max : 2;
  const userKeep = new Set((o.userFeatures || []).map((t) => attrDedupeKey(t)));
  const scored = [];
  const seenKind = new Set();
  const seenKey = new Set();
  for (const t of tokens || []) {
    const c = classifyAttrToken(t);
    if (!c) continue;
    if (c.kind === 'model') continue;
    const key = attrDedupeKey(c.token);
    if (seenKey.has(key)) continue;
    const isUser = userKeep.has(key);
    if (c.kind === 'secondary' && !isUser) continue;
    if (c.kind === 'secondary' && isUser) {
      scored.push({ ...c, score: 60, user: true });
      seenKey.add(key);
      continue;
    }
    scored.push({ ...c, user: isUser });
    seenKey.add(key);
  }
  scored.sort((a, b) => {
    if (a.user !== b.user) return a.user ? -1 : 1;
    return b.score - a.score;
  });
  const out = [];
  for (const c of scored) {
    if (out.length >= max) break;
    // один признак на kind, кроме явных пользовательских
    if (!c.user && seenKind.has(c.kind) && c.kind !== 'other') continue;
    seenKind.add(c.kind);
    out.push(c.token);
  }
  return out;
}

function extractModelTokenRun(rest) {
  const bits = String(rest || '').split(/\s+/).filter(Boolean);
  const run = [];
  for (const b of bits) {
    if (isModelOrSkuToken(b) || /^[A-Za-z0-9][A-Za-z0-9 &_./'+-]*$/.test(b)) run.push(b);
    else if (run.length) break;
  }
  // Если модель не с начала rest — собрать все model-токены подряд из rest
  if (!run.length) {
    for (const b of bits) {
      if (isModelOrSkuToken(b) || (/^[A-Za-z]/.test(b) && /^[A-Za-z0-9][A-Za-z0-9 &_./'+-]*$/.test(b))) {
        run.push(b);
      } else if (run.length) break;
    }
  }
  return run;
}

function pushColorAndCategory(pushUnique, colors, categories) {
  const colorList = colors
    .map((c) => String(c || '').split(/[,/]/)[0].trim())
    .filter(Boolean);
  const cats = categories.slice();
  const cat = cats[0] || null;
  const colRaw = colorList[0] || null;
  if (colRaw && cat) {
    const agreed = agreeColorRu(colRaw, cat);
    if (agreed.mode === 'safe') {
      pushUnique(`${capitalizeRu(cat)} · ${agreed.color} цвет`);
    } else {
      pushUnique(agreed.color);
      pushUnique(cat);
    }
    for (let i = 1; i < colorList.length; i++) pushUnique(colorList[i]);
    for (let i = 1; i < cats.length; i++) pushUnique(cats[i]);
    return;
  }
  for (const c of colorList) pushUnique(c);
  for (const c of cats) pushUnique(c);
}

/**
 * Базовая поисковая фраза: тип, цвет, бренд, особенности, значимые слова, размер.
 * Цену в фразу не включаем.
 */
function buildSearchPhrase(parsed, movie) {
  const parts = [];
  const pushUnique = (w) => {
    if (!w) return;
    const key = attrDedupeKey(w);
    if (!key) return;
    if (parts.some((p) => attrDedupeKey(p) === key)) return;
    parts.push(w);
  };

  const listOrSingular = (plural, singular) => {
    if (Array.isArray(plural) && plural.length) return plural;
    if (singular) return [singular];
    return [];
  };
  for (const b of listOrSingular(parsed.brands, parsed.brand)) pushUnique(b);
  pushColorAndCategory(
    pushUnique,
    listOrSingular(parsed.colors, parsed.color),
    listOrSingular(parsed.categories, parsed.category)
  );
  if (movie && movie.search_phrase) {
    const movieBits = String(movie.search_phrase).split(/\s+/).filter(Boolean);
    for (const w of movieBits) {
      const nw = norm(w);
      const colors = listOrSingular(parsed.colors, parsed.color);
      const cats = listOrSingular(parsed.categories, parsed.category);
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
      if (w.length < 3 && !isModelOrSkuToken(w)) continue;
      pushUnique(w);
    }
  }
  const sizes = listOrSingular(parsed.sizes, parsed.size);
  for (const sz of sizes) pushUnique(`размер ${sz}`);
  const phrase = parts.join(' ').replace(/\s+/g, ' ').trim();
  return phrase || null;
}

/**
 * Короткая фраза для магазинов: тип + бренд/модель + 1–2 значимых признака.
 * Мелочи кроя (карманы, молнии…) не тащим — они остаются в полном разборе.
 * Явные userFeatures (критерии пользователя) не отбрасываем молча.
 */
function buildCompactSearchPhrase(parsed, opts) {
  const o = opts || {};
  const parts = [];
  const pushUnique = (w) => {
    if (!w) return;
    const cleaned = String(w).replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    const key = attrDedupeKey(cleaned);
    if (!key) return;
    if (parts.some((p) => attrDedupeKey(p) === key)) return;
    parts.push(cleaned);
  };

  const listOrSingular = (plural, singular) => {
    if (Array.isArray(plural) && plural.length) return plural;
    if (singular) return [singular];
    return [];
  };

  const brands = listOrSingular(parsed.brands, parsed.brand);
  const colors = listOrSingular(parsed.colors, parsed.color);
  const categories = listOrSingular(parsed.categories, parsed.category);
  const features = parsed.features || [];
  const colRaw = colors[0] ? String(colors[0]).split(/[,/]/)[0].trim() : null;
  const cat = categories[0] || null;
  const modelRun =
    !o.dropRestModels && parsed.rest ? extractModelTokenRun(parsed.rest) : [];

  // Бренд + модель целиком; цвет — «· … цвет», не между словами модели.
  if (brands.length && modelRun.length) {
    pushUnique([...brands, ...modelRun].join(' '));
    if (colRaw) pushUnique(`· ${colRaw} цвет`);
  } else {
    for (const b of brands) pushUnique(b);

    const attrPool = [];
    for (const f of features) attrPool.push(f);
    if (parsed.rest && !o.dropRestText) {
      const bits = String(parsed.rest).split(/[\s,;]+/).filter(Boolean);
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i];
        // «не красный» целиком — не тащим «красный» как положительный признак
        if (norm(b) === 'не') {
          i += 1;
          continue;
        }
        if (modelRun.includes(b)) continue;
        attrPool.push(b);
      }
    }
    const picked = pickSignificantAttrs(attrPool, {
      max: 2,
      userFeatures: o.userFeatures || [],
    });
    // Материал уже в категории («кожаная куртка») — не дублировать.
    const catJoined = categories.join(' ');
    const attrs = picked.filter(
      (a) => !(MATERIAL_HINT.test(a) && MATERIAL_HINT.test(catJoined))
    );

    const textures = attrs.filter((a) => TEXTURE_HINT.test(a) || LENGTH_HINT.test(a));
    const materials = attrs.filter((a) => MATERIAL_HINT.test(a));
    const fits = attrs.filter((a) => FIT_HINT.test(a) || attrDedupeKey(a) === '#oversize');
    const otherAttrs = attrs.filter(
      (a) => !textures.includes(a) && !materials.includes(a) && !fits.includes(a)
    );

    if (colRaw && cat) {
      const agreed = agreeColorRu(colRaw, cat);
      if (agreed.mode === 'safe') {
        for (const t of textures) pushUnique(t);
        for (const m of materials) pushUnique(m);
        pushUnique(`${capitalizeRu(cat)} · ${agreed.color} цвет`);
        for (const f of fits) pushUnique(f);
        for (const x of otherAttrs) pushUnique(x);
      } else {
        for (const t of textures) pushUnique(t);
        pushUnique(agreed.color);
        for (const m of materials) pushUnique(m);
        pushUnique(cat);
        for (const f of fits) pushUnique(f);
        for (const x of otherAttrs) pushUnique(x);
      }
      for (let i = 1; i < colors.length; i++) {
        const extra = String(colors[i]).split(/[,/]/)[0].trim();
        if (extra) pushUnique(extra);
      }
    } else {
      for (const t of textures) pushUnique(t);
      if (colRaw) pushUnique(colRaw);
      for (let i = 1; i < colors.length; i++) {
        const extra = String(colors[i]).split(/[,/]/)[0].trim();
        if (extra) pushUnique(extra);
      }
      for (const m of materials) pushUnique(m);
      for (const c of categories) pushUnique(c);
      for (const f of fits) pushUnique(f);
      for (const x of otherAttrs) pushUnique(x);
      for (const m of modelRun) pushUnique(m);
    }
    for (let i = 1; i < categories.length; i++) pushUnique(categories[i]);

    // Явные отрицания («не красный») — условие пользователя, не отбрасываем.
    if (parsed.rest) {
      const rw = String(parsed.rest).split(/\s+/).filter(Boolean);
      for (let i = 0; i < rw.length; i++) {
        if (norm(rw[i]) === 'не' && rw[i + 1]) {
          pushUnique(`не ${rw[i + 1]}`);
          i += 1;
        }
      }
    }
  }

  if (!o.dropSize) {
    const sizes = listOrSingular(parsed.sizes, parsed.size);
    if (sizes.length === 1) pushUnique('размер ' + sizes[0]);
  }

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

  // Магазинная фраза — компактная; полный разбор остаётся в полях/«Что распозналось».
  const search_phrase =
    buildCompactSearchPhrase(parsed) || buildSearchPhrase(parsed, movie);
  return {
    ...parsed,
    search_phrase,
    raw_query: q,
  };
}

module.exports = {
  parseQuery,
  buildSearchPhrase,
  buildCompactSearchPhrase,
  findMovie,
  extractBudget,
  extractPriceRange,
  extractColors,
  extractBrands,
  extractSizes,
  extractCategories,
  norm,
  COLORS,
  MATERIAL_HINT,
  SECONDARY_DETAIL,
  isModelOrSkuToken,
  agreeColorRu,
  attrDedupeKey,
  pickSignificantAttrs,
  classifyAttrToken,
};
