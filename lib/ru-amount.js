'use strict';

/**
 * Разбор русских числительных в контексте цены.
 * Консервативно: только явные бюджетные конструкции, не любое «три» в тексте.
 */

const ONES = {
  ноль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  одного: 1,
  одной: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трёх: 3,
  трех: 3,
  четырёх: 4,
  четырех: 4,
  четыре: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
};

const TEENS = {
  десять: 10,
  десяти: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
};

const TENS = {
  двадцать: 20,
  двадцати: 20,
  тридцать: 30,
  тридцати: 30,
  сорок: 40,
  сорока: 40,
  пятьдесят: 50,
  пятидесяти: 50,
  шестьдесят: 60,
  шестидесяти: 60,
  семьдесят: 70,
  семидесяти: 70,
  восемьдесят: 80,
  восьмидесяти: 80,
  девяносто: 90,
  девяноста: 90,
};

const HUNDREDS = {
  сто: 100,
  ста: 100,
  двести: 200,
  двухсот: 200,
  триста: 300,
  трёхсот: 300,
  трехсот: 300,
  четыреста: 400,
  четырёхсот: 400,
  четырехсот: 400,
  пятьсот: 500,
  пятисот: 500,
  шестьсот: 600,
  шестисот: 600,
  семьсот: 700,
  семисот: 700,
  восемьсот: 800,
  восьмисот: 800,
  девятьсот: 900,
  девятисот: 900,
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/**
 * Разбирает последовательность слов в число (до миллионов).
 * @returns {{ value: number, consumed: number } | null}
 */
function parseWordNumber(words, start) {
  let i = start;
  let total = 0;
  let current = 0;
  let used = 0;

  while (i < words.length) {
    const w = norm(words[i]);
    if (!w) {
      i += 1;
      continue;
    }
    if (TEENS[w] != null) {
      current += TEENS[w];
      used += 1;
      i += 1;
      continue;
    }
    if (TENS[w] != null) {
      current += TENS[w];
      used += 1;
      i += 1;
      continue;
    }
    if (HUNDREDS[w] != null) {
      current += HUNDREDS[w];
      used += 1;
      i += 1;
      continue;
    }
    if (ONES[w] != null) {
      current += ONES[w];
      used += 1;
      i += 1;
      continue;
    }
    if (/^тысяч/.test(w)) {
      if (current === 0) current = 1;
      total += current * 1000;
      current = 0;
      used += 1;
      i += 1;
      continue;
    }
    if (/^миллион/.test(w)) {
      if (current === 0) current = 1;
      total += current * 1_000_000;
      current = 0;
      used += 1;
      i += 1;
      continue;
    }
    break;
  }

  const value = total + current;
  if (used === 0 || !Number.isFinite(value) || value <= 0) return null;
  return { value: Math.round(value), consumed: used };
}

/**
 * Число без требования «тысяч» (для «от трёх до восьми тысяч»).
 * Допускает цифры: «от 3 до восьми тысяч».
 */
function parseLooseAmount(tokens, start) {
  const tok = tokens[start];
  if (tok != null && /^\d+$/.test(tok)) {
    const n = Number(tok);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { value: n, end: start + 1 };
  }
  const parsed = parseWordNumber(tokens, start);
  if (!parsed) return null;
  return { value: parsed.value, end: start + parsed.consumed };
}

function scaleIfThousands(value, tokens, endIdx) {
  const next = norm(tokens[endIdx] || '');
  if (/^тысяч/.test(next)) {
    // parseWordNumber уже мог умножить
    if (value < 1000) return { value: value * 1000, end: endIdx + 1 };
    return { value, end: endIdx + 1 };
  }
  return { value, end: endIdx };
}

/**
 * Ищет бюджетные конструкции с числительными словами.
 * @returns {{ budget_min: number|null, budget_max: number|null, matched: string|null }}
 */
function extractWordPriceRange(query) {
  const raw = norm(query);
  if (!raw) return { budget_min: null, budget_max: null, matched: null };

  const tokens = raw.match(/[a-zа-я0-9]+/gi) || [];
  let budget_min = null;
  let budget_max = null;
  let matched = null;

  // «от трёх до восьми тысяч» / «от двух тысяч пятисот до семи тысяч»
  for (let i = 0; i < tokens.length; i++) {
    if (norm(tokens[i]) !== 'от') continue;
    const a = parseLooseAmount(tokens, i + 1);
    if (!a) continue;
    let aEnd = a.end;
    let aVal = a.value;
    // «от двух тысяч …»
    if (/^тысяч/.test(norm(tokens[aEnd] || ''))) {
      const scaled = scaleIfThousands(aVal, tokens, aEnd);
      aVal = scaled.value;
      aEnd = scaled.end;
      // «пятисот» после тысяч
      const extra = parseLooseAmount(tokens, aEnd);
      if (extra && extra.value < 1000) {
        aVal += extra.value;
        aEnd = extra.end;
      }
    }
    if (norm(tokens[aEnd] || '') !== 'до') continue;
    const b = parseLooseAmount(tokens, aEnd + 1);
    if (!b) continue;
    let bEnd = b.end;
    let bVal = b.value;
    // «тысяч» могло уже войти в parseWordNumber (value≥1000) или стоять следующим токеном.
    if (/^тысяч/.test(norm(tokens[b.end] || ''))) {
      const bScaled = scaleIfThousands(bVal, tokens, bEnd);
      bVal = bScaled.value;
      bEnd = bScaled.end;
    }
    const hasThousandsUnit =
      bVal >= 1000
      || aVal >= 1000
      || /^тысяч/.test(norm(tokens[b.end] || ''))
      || /^тысяч/.test(norm(tokens[a.end] || ''));
    if (!hasThousandsUnit && bVal < 1000) continue;
    // Единица на второй границе → на первую, если та ещё мелкая («от трёх до восьми тысяч»).
    if (bVal >= 1000 && aVal < 1000) aVal *= 1000;
    if (aVal < 100 || bVal < 100) continue;
    if (aVal > 5_000_000 || bVal > 5_000_000) continue;
    budget_min = aVal;
    budget_max = bVal;
    matched = tokens.slice(i, bEnd).join(' ');
    break;
  }

  if (budget_min == null && budget_max == null) {
    for (let i = 0; i < tokens.length; i++) {
      const t = norm(tokens[i]);
      const prev = i > 0 ? norm(tokens[i - 1]) : '';
      const isMaxCue =
        t === 'до'
        || t === 'максимум'
        || ((t === 'дороже' || t === 'выше' || t === 'более' || t === 'больше') && prev === 'не');
      if (!isMaxCue) continue;
      const start = i + 1;
      const a = parseLooseAmount(tokens, start);
      if (!a) continue;
      let val = a.value;
      let end = a.end;
      const scaled = scaleIfThousands(val, tokens, end);
      if (!/^тысяч/.test(norm(tokens[a.end] || '')) && val < 1000) continue;
      val = scaled.value;
      end = scaled.end;
      if (val < 100 || val > 5_000_000) continue;
      budget_max = val;
      matched = tokens.slice(Math.max(0, i - (prev === 'не' ? 1 : 0)), end).join(' ');
      break;
    }
  }

  if (budget_min == null && budget_max == null) {
    for (let i = 0; i < tokens.length; i++) {
      if (norm(tokens[i]) !== 'от') continue;
      const a = parseLooseAmount(tokens, i + 1);
      if (!a) continue;
      let val = a.value;
      let end = a.end;
      const scaled = scaleIfThousands(val, tokens, end);
      if (!/^тысяч/.test(norm(tokens[a.end] || '')) && val < 1000) continue;
      val = scaled.value;
      end = scaled.end;
      if (val < 100 || val > 5_000_000) continue;
      budget_min = val;
      matched = tokens.slice(i, end).join(' ');
      break;
    }
  }

  return { budget_min, budget_max, matched };
}

/**
 * Удаляет из текста найденный словесный бюджетный фрагмент.
 */
function stripWordPrice(query, matched) {
  if (!matched) return query;
  const parts = matched.split(/\s+/).filter(Boolean);
  if (!parts.length) return query;
  let out = String(query);
  // снимаем «от … до …» / «до …» целиком по словам
  const re = new RegExp(
    parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'),
    'i'
  );
  out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = {
  parseWordNumber,
  extractWordPriceRange,
  stripWordPrice,
  norm,
};
