'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCompactSearchPhrase,
  buildSearchPhrase,
  parseQuery,
  agreeColorRu,
} = require('../lib/parse-query');
const {
  dictionarySearchPhraseEn,
  buildSearchPhraseEn,
  dedupeEnPhrase,
} = require('../lib/search-phrase-en');
const { buildUrl } = require('../providers/links');
const sources = require('../data/sources.json');
const brands = require('../data/brands.json');

test('подробный анализ → короткая RU-фраза', () => {
  const parsed = {
    categories: ['куртка'],
    colors: ['чёрный'],
    features: ['кожаная', 'молния', 'отложной воротник', 'карманы'],
    rest: 'короткая кожаная куртка, молния, отложной воротник, карманы, свободный крой',
  };
  const compact = buildCompactSearchPhrase(parsed);
  assert.match(compact, /куртка/i);
  assert.match(compact, /чёрн/i);
  assert.match(compact, /кожа/i);
  assert.ok(!/карман/i.test(compact));
  assert.ok(!/молни/i.test(compact));
  assert.ok(!/воротник/i.test(compact));
});

test('смысловой отбор: тип + 1–2 признака, без мелочей кроя', () => {
  const p = parseQuery('вафельный кардиган меланж оверсайз с карманами', {
    movies: [],
    brands,
  });
  assert.equal(p.search_phrase, 'вафельный кардиган оверсайз');
  assert.ok(!/карман/i.test(p.search_phrase));
  assert.ok(!/меланж/i.test(p.search_phrase));
  const en = dictionarySearchPhraseEn(p);
  assert.equal(en.phrase, 'waffle oversized cardigan');
});

test('явный пользовательский secondary-признак не удаляется молча', () => {
  const phrase = buildCompactSearchPhrase(
    {
      categories: ['куртка'],
      colors: ['чёрный'],
      features: ['карманы'],
      rest: 'карманы',
    },
    { userFeatures: ['карманы'] }
  );
  assert.match(phrase, /карман/i);
  assert.match(phrase, /куртка/i);
});

test('бренд и модель: подпись «Nike Air Force 1 · белый цвет»', () => {
  const p = parseQuery('Nike Air Force 1 белые', { movies: [], brands });
  assert.equal(p.search_phrase, 'Nike Air Force 1 · белый цвет');
  assert.match(p.rest || '', /\b1\b/);
  const en = dictionarySearchPhraseEn(p);
  assert.equal(en.phrase, 'Nike Air Force 1 white');
});

test('бренд и латинская модель не искажаются, цифра модели сохраняется', () => {
  const phrase = buildCompactSearchPhrase({
    brands: ['Nike'],
    categories: ['кроссовки'],
    rest: 'Air Force 1',
  });
  assert.match(phrase, /Nike/);
  assert.match(phrase, /Air Force 1/);
});

test('словарь EN: чёрная кожаная куртка → black leather jacket', () => {
  const en = dictionarySearchPhraseEn({
    categories: ['куртка'],
    colors: ['чёрная'],
    features: ['кожаная'],
  });
  assert.equal(en.phrase, 'black leather jacket');
  assert.equal(en.source, 'dictionary');
});

test('составная категория «кожаная куртка» не теряет jacket', () => {
  const en = dictionarySearchPhraseEn({
    categories: ['кожаная куртка'],
    colors: ['чёрный'],
  });
  assert.match(en.phrase, /jacket/i);
  assert.match(en.phrase, /leather/i);
  assert.match(en.phrase, /black/i);
});

test('parse: чёрная кожаная куртка → RU согласована + EN с jacket', () => {
  const p = parseQuery('чёрная кожаная куртка', { movies: [], brands });
  assert.match(p.search_phrase, /чёрная/i);
  assert.match(p.search_phrase, /кожаная куртка/i);
  assert.ok(!/чёрный кожаная/i.test(p.search_phrase));
  const en = dictionarySearchPhraseEn(p);
  assert.equal(en.phrase, 'black leather jacket');
});

test('модели с цифрами и артикулами сохраняются', () => {
  for (const q of [
    'Adidas Samba OG чёрные',
    'New Balance 550 белые',
    'Nike Dunk Low Panda',
    'Jordan 1 Retro High',
  ]) {
    const p = parseQuery(q, { movies: [], brands });
    const en = dictionarySearchPhraseEn(p);
    if (/Samba OG/i.test(q)) {
      assert.match(p.search_phrase, /Samba/);
      assert.match(p.search_phrase, /OG/);
      assert.match(en.phrase, /Samba/);
      assert.match(en.phrase, /OG/);
    }
    if (/550/.test(q)) {
      assert.match(p.search_phrase, /550/);
      assert.match(en.phrase, /550/);
    }
    if (/Dunk Low/i.test(q)) {
      assert.match(p.search_phrase, /Dunk/);
      assert.match(p.search_phrase, /Low/);
    }
    if (/Jordan 1/i.test(q)) {
      assert.match(p.search_phrase, /\b1\b/);
      assert.match(en.phrase, /\b1\b/);
    }
  }
});

test('EN dedupe: oversize/oversized', () => {
  assert.equal(
    dedupeEnPhrase('cardigan oversize waffle melange oversized with pockets'),
    'cardigan oversized waffle melange with pockets'
  );
});

test('RU подпись: цвет согласован с типом (не «красный куртка»)', () => {
  const compact = buildCompactSearchPhrase({
    categories: ['куртка'],
    colors: ['красный'],
  });
  assert.equal(compact, 'красная куртка');
  const agreed = agreeColorRu('красный', 'куртка');
  assert.equal(agreed.mode, 'agree');
  assert.equal(agreed.color, 'красная');
});

test('RU safe-подпись при неизвестном цвете', () => {
  const compact = buildCompactSearchPhrase({
    categories: ['куртка'],
    colors: ['терракотовый'],
  });
  assert.match(compact, /Куртка · терракотовый цвет/);
});

test('EN fallback при сбое модели не бросает', async () => {
  const out = await buildSearchPhraseEn(
    { search_phrase: 'чёрная кожаная куртка', categories: ['куртка'], colors: ['чёрная'], features: ['кожаная'] },
    {
      ollamaChat: async () => {
        throw new Error('offline');
      },
      model: 'x',
    }
  );
  assert.ok(out.search_phrase_en);
  assert.match(out.search_phrase_en, /jacket/i);
});

test('eBay получает EN-фразу; RU-площадка — русскую', () => {
  const ebay = sources.find((s) => s.id === 'ebay');
  const peak = sources.find((s) => s.id === 'peak_concept');
  const parsed = {
    search_phrase: 'чёрная кожаная куртка',
    search_phrase_en: 'black leather jacket',
  };
  const ebayUrl = buildUrl(ebay, parsed, { price_sort: 'default' });
  assert.match(ebayUrl.url, /_nkw=black%20leather%20jacket/);
  assert.equal(ebayUrl.search_phrase_used, 'black leather jacket');

  const peakUrl = buildUrl(peak, parsed, { price_sort: 'default' });
  assert.match(decodeURIComponent(peakUrl.url), /чёрная кожаная куртка/);
});

test('короткий текстовый запрос не ухудшается до общей категории', () => {
  const full = buildSearchPhrase({
    brands: ['Stone Island'],
    categories: ['бомбер'],
    rest: '',
  });
  const compact = buildCompactSearchPhrase({
    brands: ['Stone Island'],
    categories: ['бомбер'],
    rest: '',
  });
  assert.match(full, /Stone Island/);
  assert.match(compact, /Stone Island/);
  assert.match(compact, /бомбер/);
});

test('цепочка: исходная → RU → EN → URL', () => {
  const ebay = sources.find((s) => s.id === 'ebay');
  const spin = sources.find((s) => s.id === 'spin4spin');
  const cases = [
    {
      q: 'чёрная кожаная куртка',
      ru: /чёрная кожаная куртка/i,
      en: 'black leather jacket',
    },
    {
      q: 'Nike Air Force 1 белые',
      ru: /^Nike Air Force 1 · белый цвет$/,
      en: 'Nike Air Force 1 white',
    },
    {
      q: 'вафельный кардиган меланж оверсайз с карманами',
      ru: /^вафельный кардиган оверсайз$/,
      en: 'waffle oversized cardigan',
    },
  ];
  for (const c of cases) {
    const p = parseQuery(c.q, { movies: [], brands });
    assert.match(p.search_phrase, c.ru);
    const en = dictionarySearchPhraseEn(p);
    assert.equal(en.phrase, c.en);
    const withEn = { ...p, search_phrase_en: en.phrase };
    const ebayUrl = buildUrl(ebay, withEn, { price_sort: 'default' });
    const spinUrl = buildUrl(spin, withEn, { price_sort: 'asc' });
    assert.match(ebayUrl.url, /_nkw=/);
    assert.ok(!/price_min|sort=price/i.test(spinUrl.url));
    assert.match(spinUrl.url, /spin4spin\.com\/search\?q=/);
  }
});
