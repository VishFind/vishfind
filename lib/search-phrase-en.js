'use strict';

/**
 * Короткая английская поисковая фраза для площадок вроде eBay.
 * Словарь — резерв; не полноценный переводчик.
 * Бренд / модель / артикул не переводятся буквально.
 */

const TYPE_RU_EN = {
  куртка: 'jacket',
  бомбер: 'bomber',
  пальто: 'coat',
  худи: 'hoodie',
  свитшот: 'sweatshirt',
  джинсы: 'jeans',
  брюки: 'pants',
  рубашка: 'shirt',
  футболка: 't-shirt',
  свитер: 'sweater',
  платье: 'dress',
  юбка: 'skirt',
  кроссовки: 'sneakers',
  ботинки: 'boots',
  пиджак: 'blazer',
  ветровка: 'windbreaker',
  пуховик: 'down jacket',
  жилет: 'vest',
  шорты: 'shorts',
  сумка: 'bag',
  кардиган: 'cardigan',
  оверсайз: 'oversized',
  oversize: 'oversized',
  oversized: 'oversized',
  вафельный: 'waffle',
  вафельная: 'waffle',
  вафельное: 'waffle',
  меланж: 'melange',
  короткая: 'short',
  короткий: 'short',
  короткое: 'short',
  длинная: 'long',
  длинный: 'long',
};

const COLOR_RU_EN = {
  чёрный: 'black',
  черный: 'black',
  чёрная: 'black',
  черная: 'black',
  чёрное: 'black',
  черное: 'black',
  белый: 'white',
  белая: 'white',
  белое: 'white',
  синий: 'blue',
  синяя: 'blue',
  красный: 'red',
  красная: 'red',
  зелёный: 'green',
  зеленый: 'green',
  зелёная: 'green',
  зеленая: 'green',
  серый: 'gray',
  серая: 'gray',
  бежевый: 'beige',
  бежевая: 'beige',
  коричневый: 'brown',
  коричневая: 'brown',
  розовый: 'pink',
  розовая: 'pink',
  жёлтый: 'yellow',
  желтый: 'yellow',
  оранжевый: 'orange',
  фиолетовый: 'purple',
};

const MATERIAL_RU_EN = {
  кожа: 'leather',
  кожаная: 'leather',
  кожаный: 'leather',
  кожаное: 'leather',
  деним: 'denim',
  джинс: 'denim',
  джинсовая: 'denim',
  хлопок: 'cotton',
  хлопковая: 'cotton',
  шерсть: 'wool',
  шерстяная: 'wool',
  шёлк: 'silk',
  шелк: 'silk',
  замша: 'suede',
  замшевая: 'suede',
  нейлон: 'nylon',
  лен: 'linen',
  лён: 'linen',
};

function normToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:!?()«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLatinBrandOrModel(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  // Бренд/модель/артикул: латиница, цифры, дефисы — не переводим.
  return /^[A-Za-z0-9][A-Za-z0-9 &_./'+-]*$/.test(t);
}

function translateToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return { en: null, known: false };
  // Составные категории («кожаная куртка») — по словам, иначе material-prefix
  // съедает весь токен как «leather» и теряется тип.
  if (/\s/.test(raw)) {
    const bits = raw.split(/\s+/).filter(Boolean);
    const ens = [];
    let allKnown = true;
    for (const b of bits) {
      const one = translateToken(b);
      if (one.en) ens.push(one.en);
      else allKnown = false;
    }
    if (!ens.length) return { en: null, known: false };
    return { en: ens.join(' '), known: allKnown };
  }
  if (looksLatinBrandOrModel(raw)) return { en: raw, known: true };
  const key = normToken(raw);
  if (TYPE_RU_EN[key]) return { en: TYPE_RU_EN[key], known: true };
  if (COLOR_RU_EN[key]) return { en: COLOR_RU_EN[key], known: true };
  if (MATERIAL_RU_EN[key]) return { en: MATERIAL_RU_EN[key], known: true };
  // словоформы цвета/типа — простой префикс (только однословные токены)
  for (const [ru, en] of Object.entries(COLOR_RU_EN)) {
    if (key.startsWith(normToken(ru).slice(0, 4))) return { en, known: true };
  }
  for (const [ru, en] of Object.entries(TYPE_RU_EN)) {
    if (key === normToken(ru) || key.startsWith(normToken(ru))) return { en, known: true };
  }
  for (const [ru, en] of Object.entries(MATERIAL_RU_EN)) {
    if (key.startsWith(normToken(ru).slice(0, 4))) return { en, known: true };
  }
  return { en: null, known: false };
}

/** Убрать дубли вроде oversize/oversized; сохранить порядок. */
function dedupeEnPhrase(phrase) {
  const raw = String(phrase || '').replace(/\s+/g, ' ').trim();
  if (!raw) return raw;
  const synonymKey = (t) => {
    const n = t.toLowerCase();
    if (n === 'oversize' || n === 'oversized') return 'oversized';
    if (n === 'leather' || n === 'leathers') return 'leather';
    return n;
  };
  const seen = new Set();
  const out = [];
  for (const t of raw.split(/\s+/)) {
    const k = synonymKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k === 'oversized' ? 'oversized' : t);
  }
  return out.join(' ');
}

/**
 * Компактный EN из структурированных полей / короткой RU-фразы.
 * @returns {{ phrase: string|null, source: 'dictionary'|'partial'|'none', note: string|null }}
 */
function dictionarySearchPhraseEn(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { phrase: null, source: 'none', note: 'Нет данных для английского запроса.' };
  }
  const parts = [];
  const unknown = [];
  const push = (raw) => {
    if (!raw || raw === '·') return;
    if (normToken(raw) === 'цвет') return;
    const { en, known } = translateToken(raw);
    if (en) {
      for (const piece of String(en).split(/\s+/).filter(Boolean)) {
        const low = piece.toLowerCase();
        const syn = low === 'oversized' || low === 'oversize' ? 'oversized' : low;
        if (!parts.some((p) => {
          const pl = p.toLowerCase();
          const ps = pl === 'oversized' || pl === 'oversize' ? 'oversized' : pl;
          return ps === syn;
        })) {
          parts.push(piece === 'oversize' ? 'oversized' : piece);
        }
      }
      if (!known) unknown.push(String(raw));
    } else if (!looksLatinBrandOrModel(raw) && !/^\d+[A-Za-z0-9/-]*$/.test(raw)) {
      unknown.push(String(raw));
    } else {
      // латиница / артикул — как есть
      if (!parts.some((p) => p.toLowerCase() === String(raw).toLowerCase())) parts.push(String(raw));
    }
  };

  // «Nike Air Force 1 · белый цвет» → Nike Air Force 1 white
  const ruPhrase = String(parsed.search_phrase || '').trim();
  const modelColor = ruPhrase.match(/^(.+?)\s+·\s+(.+?)\s+цвет$/i);
  if (modelColor) {
    for (const w of modelColor[1].split(/\s+/).filter(Boolean)) push(w);
    push(modelColor[2]);
    const phrase = dedupeEnPhrase(parts.join(' '));
    return {
      phrase: phrase || null,
      source: phrase ? 'dictionary' : 'none',
      note: phrase ? null : 'Английская фраза не собрана — словарь не покрыл запрос.',
    };
  }

  const brands = Array.isArray(parsed.brands) && parsed.brands.length
    ? parsed.brands
    : parsed.brand
      ? [parsed.brand]
      : [];
  brands.forEach(push);

  const colorsRaw = Array.isArray(parsed.colors) && parsed.colors.length
    ? parsed.colors
    : parsed.color
      ? [parsed.color]
      : [];
  const colors = colorsRaw.slice(0, 1).map((c) => String(c).split(/[,/]/)[0].trim());
  colors.forEach(push);

  const cats = Array.isArray(parsed.categories) && parsed.categories.length
    ? parsed.categories
    : parsed.category
      ? [parsed.category]
      : [];
  const catHasMaterial = cats.some((c) => /кожан|замш|деним|джинс|хлоп|шерст|шёлк|шелк|нейлон|лён|лен/i.test(String(c)));

  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const restBits = parsed.rest ? String(parsed.rest).split(/\s+/).filter(Boolean) : [];

  // Значимые attrs до типа: texture → fit (waffle oversized cardigan)
  const textures = [];
  const fits = [];
  const lengths = [];
  for (const f of [...features, ...restBits]) {
    const n = normToken(f);
    if (/^вафельн|^стеган|^жаккард|^рубчик/.test(n)) textures.push(f);
    else if (/^(oversize|oversized|оверсайз)/.test(n)) fits.push('оверсайз');
    else if (/^коротк|^длинн|^укороч/.test(n)) lengths.push(f);
  }
  textures.slice(0, 1).forEach(push);
  lengths.slice(0, 1).forEach(push);
  fits.slice(0, 1).forEach(push);

  if (!catHasMaterial) {
    for (const f of features) {
      const n = normToken(f);
      if (MATERIAL_RU_EN[n] || Object.keys(MATERIAL_RU_EN).some((k) => n.startsWith(normToken(k).slice(0, 4)))) {
        push(f);
        break;
      }
    }
  }

  cats.forEach(push);

  for (const b of restBits) {
    if (looksLatinBrandOrModel(b) || /^\d+[A-Za-z0-9/-]*$/.test(b)) push(b);
  }

  if (!parts.length) {
    return {
      phrase: null,
      source: 'none',
      note: 'Английская фраза не собрана — словарь не покрыл запрос.',
    };
  }
  const phrase = dedupeEnPhrase(parts.join(' '));
  if (unknown.length) {
    return {
      phrase,
      source: 'partial',
      note: 'Английская фраза частичная (словарь); непереведённое не подставляли: '
        + unknown.slice(0, 4).join(', '),
    };
  }
  return { phrase, source: 'dictionary', note: null };
}

/**
 * Перевод RU-фразы через локальную Ollama (текст), без vision.
 * При сбое — dictionary fallback.
 */
async function buildSearchPhraseEn(parsed, opts) {
  const dict = dictionarySearchPhraseEn(parsed);
  const ollamaChat = opts && opts.ollamaChat;
  const model = (opts && opts.model) || null;
  const ruPhrase = (parsed && (parsed.search_phrase || parsed.raw_query)) || '';

  if (!ollamaChat || !model || !ruPhrase) {
    return {
      search_phrase_en: dict.phrase,
      search_phrase_en_source: dict.source,
      search_phrase_en_note: dict.note,
    };
  }

  // Если словарь полностью покрыл короткую фразу — модель не дергаем.
  if (dict.source === 'dictionary' && dict.phrase) {
    return {
      search_phrase_en: dict.phrase,
      search_phrase_en_source: 'dictionary',
      search_phrase_en_note: null,
    };
  }

  try {
    const brands = Array.isArray(parsed.brands) ? parsed.brands.join(', ') : parsed.brand || '';
    const prompt =
      'Translate this Russian clothing search query into a short English eBay search phrase. '
      + 'Keep brand names, model names and SKUs unchanged, including digits and hyphens. '
      + 'Keep the garment type. Do not repeat synonyms (e.g. oversize and oversized). '
      + 'Do not invent attributes. Reply with ONLY the English phrase, no quotes.\n'
      + (brands ? 'Brands to keep: ' + brands + '\n' : '')
      + 'Query: ' + ruPhrase;
    const raw = await ollamaChat(
      {
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0 },
      },
      (opts && opts.timeoutMs) || 8000
    );
    const content =
      raw && raw.message && typeof raw.message.content === 'string'
        ? raw.message.content
        : '';
    const line = content
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s && !/^```/.test(s));
    const cleaned = dedupeEnPhrase(
      String(line || '')
        .replace(/^["«]+|["»]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    );
    if (cleaned && /[A-Za-z]/.test(cleaned)) {
      return {
        search_phrase_en: cleaned,
        search_phrase_en_source: 'ollama',
        search_phrase_en_note: null,
      };
    }
  } catch (_) {
    /* fallback below */
  }

  return {
    search_phrase_en: dict.phrase,
    search_phrase_en_source: dict.source === 'none' ? 'fallback' : dict.source,
    search_phrase_en_note:
      dict.note
      || 'Полный перевод недоступен — использован словарный запасной вариант.',
  };
}

module.exports = {
  TYPE_RU_EN,
  COLOR_RU_EN,
  MATERIAL_RU_EN,
  dictionarySearchPhraseEn,
  buildSearchPhraseEn,
  translateToken,
  looksLatinBrandOrModel,
  dedupeEnPhrase,
};
