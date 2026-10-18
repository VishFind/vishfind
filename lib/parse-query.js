'use strict';

/**
 * Разбор текстового запроса правилами (без нейросети).
 * Неизвестные поля остаются null; всё нераспознанное — в rest.
 */

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
];

const CATEGORIES = [
  ['куртка', ['куртк', 'косух', 'jacket']],
  ['бомбер', ['бомбер', 'bomber']],
  ['пальто', ['пальто', 'coat']],
  ['плащ', ['плащ', 'raincoat', 'trench']],
  ['жилет', ['жилет', 'vest']],
  ['джинсы', ['джинс', 'jeans']],
  ['брюки', ['брюк', 'штаны', 'pants', 'trousers']],
  ['худи', ['худи', 'hoodi']],
  ['свитер', ['свитер', 'sweater']],
  ['свитшот', ['свитшот', 'sweatshirt']],
  ['рубашка', ['рубашк', 'shirt']],
  ['футболка', ['футболк', 't-shirt', 'tee']],
  ['платье', ['плать', 'dress']],
  ['юбка', ['юбк', 'skirt']],
  ['костюм', ['костюм', 'suit']],
  ['кроссовки', ['кроссовк', 'sneakers']],
  ['ботинки', ['ботинк', 'boots']],
  ['сумка', ['сумк', 'bag']],
];

const LETTER_SIZES = ['XXXL', 'XXL', 'XL', 'XS', 'S', 'M', 'L'];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
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

function extractBudget(query) {
  const s = norm(query);
  // «до 15 000», «до 15000 руб», «до 15к», «до 15 тыс»
  let m = s.match(
    /до\s*(\d[\d\s\u00a0\u202f]*)\s*(тыс(?:яч)?|т\.?\s?р\.?|к(?![а-яa-z])|k(?![a-z])|руб(?:лей|ля)?|₽)?/
  );
  if (m) {
    let n = Number(String(m[1]).replace(/[\s\u00a0\u202f]/g, ''));
    if (!Number.isFinite(n)) return null;
    const unit = m[2] || '';
    if (/тыс|т\.?\s?р|к|k/i.test(unit)) n *= 1000;
    if (n >= 100 && n <= 5_000_000) return Math.round(n);
  }
  // «бюджет 20000», «15к» отдельно
  m = s.match(/(?:бюджет[ае]?\s*|max\s*|максимум\s*)(\d[\d\s]*)\s*(тыс|к(?![а-яa-z])|k(?![a-z])|руб|₽)?/);
  if (m) {
    let n = Number(String(m[1]).replace(/\s+/g, ''));
    if (!Number.isFinite(n)) return null;
    if (m[2] && /тыс|к|k/i.test(m[2])) n *= 1000;
    if (n >= 100 && n <= 5_000_000) return Math.round(n);
  }
  m = s.match(/\b(\d{1,3})\s*[кk]\b/);
  if (m) {
    const n = Number(m[1]) * 1000;
    if (n >= 1000 && n <= 5_000_000) return n;
  }
  return null;
}

function extractSize(query) {
  const raw = String(query || '');
  let m = raw.match(/(?:размер|р-р|р\/р|size)\s*[:\-]?\s*([a-zA-Z]{1,4}|\d{2,3})\b/i);
  if (m) {
    const v = m[1].toUpperCase();
    if (LETTER_SIZES.includes(v) || /^\d{2,3}$/.test(v)) return v;
  }
  const upper = raw.toUpperCase();
  for (const sz of LETTER_SIZES) {
    const re = new RegExp(`(?:^|[^A-ZА-Я0-9])${sz}(?:[^A-ZА-Я0-9]|$)`, 'i');
    if (re.test(upper) && new RegExp(`(?:размер|р-р|size|\\s)${sz}\\b`, 'i').test(raw)) {
      return sz;
    }
  }
  // одиночный размер буквой только если рядом «размер» уже обработан выше;
  // иначе слишком много ложных срабатываний на «M» в середине слов
  return null;
}

function extractColor(query) {
  const s = norm(query);
  for (const [name, stems] of COLORS) {
    if (stems.some((st) => s.includes(norm(st)))) return name;
  }
  return null;
}

function extractCategory(query) {
  const s = norm(query);
  for (const [name, stems] of CATEGORIES) {
    if (stems.some((st) => s.includes(norm(st)))) return name;
  }
  return null;
}

function extractBrand(query, brands) {
  const s = norm(query);
  let found = null;
  let foundLen = 0;
  for (const b of brands || []) {
    const nb = norm(b);
    if (!nb) continue;
    const i = s.indexOf(nb);
    if (i === -1) continue;
    const before = i === 0 || !/[a-zа-я0-9]/.test(s[i - 1]);
    const after = i + nb.length >= s.length || !/[a-zа-я0-9]/.test(s[i + nb.length]);
    if (before && after && nb.length > foundLen) {
      found = b;
      foundLen = nb.length;
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
  ].map(norm)
);

function stripFound(query, pieces) {
  let rest = String(query || '');
  for (const p of pieces) {
    if (!p) continue;
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    rest = rest.replace(re, ' ');
  }
  rest = rest
    .replace(/до\s*\d[\d\s\u00a0\u202f]*\s*(тыс(?:яч)?|т\.?\s?р\.?|[кk]|руб(?:лей|ля)?|₽)?/gi, ' ')
    .replace(/(?:бюджет[ае]?|max|максимум)\s*\d[\d\s]*\s*(тыс|[кk]|руб|₽)?/gi, ' ')
    .replace(/\b\d{1,3}\s*[кk]\b/gi, ' ')
    .replace(/(?:размер|р-р|р\/р|size)\s*[:\-]?\s*([a-zA-Z]{1,4}|\d{2,3})\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
  return rest;
}

function cleanRest(rest, parsed) {
  if (!rest) return null;
  const colorStems = [];
  if (parsed.color) {
    const entry = COLORS.find(([name]) => name === parsed.color);
    if (entry) colorStems.push(...entry[1].map(norm));
    colorStems.push(norm(parsed.color));
  }
  const catStems = [];
  if (parsed.category) {
    const entry = CATEGORIES.find(([name]) => name === parsed.category);
    if (entry) catStems.push(...entry[1].map(norm));
    catStems.push(norm(parsed.category));
  }
  const words = rest
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => {
      const nw = norm(w);
      if (nw.length < 3) return false;
      if (STOP_REST.has(nw)) return false;
      if (colorStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
      if (catStems.some((st) => nw.includes(st) || st.includes(nw))) return false;
      if (parsed.brand && nw === norm(parsed.brand)) return false;
      return true;
    });
  return words.length ? words.join(' ') : null;
}

function buildSearchPhrase(parsed, movie) {
  const parts = [];
  if (parsed.brand) parts.push(parsed.brand);
  if (parsed.color) parts.push(parsed.color);
  if (parsed.category) parts.push(parsed.category);
  if (movie && movie.search_phrase) {
    const movieBits = String(movie.search_phrase).split(/\s+/).filter(Boolean);
    for (const w of movieBits) {
      const nw = norm(w);
      if (parsed.color && (nw.includes(norm(parsed.color).slice(0, 4)) || norm(parsed.color).includes(nw.slice(0, 4)))) {
        continue;
      }
      if (parsed.category && (nw.includes(norm(parsed.category).slice(0, 4)) || norm(parsed.category).includes(nw.slice(0, 4)))) {
        continue;
      }
      if (!parts.some((p) => norm(p) === nw)) parts.push(w);
    }
  }
  if (parsed.rest) {
    for (const w of parsed.rest.split(/\s+/)) {
      if (w.length < 3) continue;
      if (!parts.some((p) => norm(p) === norm(w))) parts.push(w);
    }
  }
  if (parsed.size) parts.push(`размер ${parsed.size}`);
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

  const movie = findMovie(q, movies);
  const budget = extractBudget(q);
  const size = extractSize(q);
  const color = extractColor(q) || (movie && movie.color) || null;
  const category = extractCategory(q) || (movie && movie.category) || null;
  const brand = extractBrand(q, brands);

  const stripPieces = [brand, ...(movie ? movie.triggers || [] : [])];
  if (color) stripPieces.push(color, color.replace(/ё/g, 'е'));
  if (category) stripPieces.push(category);
  if (movie && movie.title) stripPieces.push(movie.title);

  let rest = cleanRest(stripFound(q, stripPieces), {
    color,
    category,
    brand,
  });

  const parsed = {
    budget,
    size,
    color,
    category,
    brand,
    movie: movie
      ? {
          title: movie.title,
          description: movie.description || null,
          search_phrase: movie.search_phrase || null,
        }
      : null,
    rest,
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
  norm,
};
