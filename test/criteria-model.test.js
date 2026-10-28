'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeCriteria,
  normalizeCriteria,
  parsePrice,
  isPriceSet,
  publicCriteria,
} = require('../lib/criteria-model');
const { search: linksSearch, normalizeRange } = require('../providers/links');
const sources = require('../data/sources.json');

test('parsePrice: пусто ≠ 0, ноль допустим', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(0), 0);
  assert.equal(isPriceSet(0), true);
  assert.equal(isPriceSet(''), false);
});

test('normalize: одиночные поля → массивы', () => {
  const n = normalizeCriteria({ color: 'чёрный', size: 'M', brand: 'Nike' });
  assert.deepEqual(n.colors, ['чёрный']);
  assert.deepEqual(n.sizes, ['M']);
  assert.deepEqual(n.brands, ['Nike']);
  assert.equal(n.color, 'чёрный');
});

test('merge: ручной budget_min не теряется и приоритетнее текста', () => {
  const parsed = {
    raw_query: 'куртка до 90000',
    category: 'куртка',
    budget_min: null,
    budget_max: 90000,
    budget: 90000,
    search_phrase: 'куртка',
  };
  const out = mergeCriteria(
    parsed,
    { budget_min: 5000, budget_max: 15000, colors: ['чёрный', 'зелёный'] },
    { priority: true, clear: [] }
  );
  assert.equal(out.budget_min, 5000);
  assert.equal(out.budget_max, 15000);
  assert.deepEqual(out.colors, ['чёрный', 'зелёный']);
  assert.equal(out.category, 'куртка');
  assert.match(out.search_phrase, /чёрный/);
  assert.match(out.search_phrase, /зелёный/);
});

test('merge: clear budget_min не возвращает цену из текста', () => {
  const parsed = {
    raw_query: 'куртка от 3000 до 15000',
    category: 'куртка',
    budget_min: 3000,
    budget_max: 15000,
    budget: 15000,
    search_phrase: 'куртка',
  };
  const out = mergeCriteria(parsed, { size: 'M' }, { priority: true, clear: ['budget_min'] });
  assert.equal(out.budget_min, null);
  assert.equal(out.budget_max, 15000);
  assert.equal(out.size, 'M');
});

test('Яндекс: только нижняя граница → pricefrom без priceto', async () => {
  const yandex = sources.find((s) => s.id === 'yandex_market');
  const out = await linksSearch({
    parsed: { search_phrase: 'бомбер', budget_min: 5000, budget_max: null, budget: null },
    sources: [yandex],
  });
  assert.equal(out.items.length, 1);
  assert.match(out.items[0].url, /pricefrom=5000/);
  assert.ok(!/priceto=/.test(out.items[0].url));
  assert.ok(out.items[0].applied_filters.includes('price_min'));
});

test('Яндекс: диапазон → pricefrom и priceto', async () => {
  const yandex = sources.find((s) => s.id === 'yandex_market');
  const out = await linksSearch({
    parsed: { search_phrase: 'бомбер', budget_min: 5000, budget_max: 15000, budget: 15000 },
    sources: [yandex],
  });
  assert.match(out.items[0].url, /pricefrom=5000/);
  assert.match(out.items[0].url, /priceto=15000/);
});

test('normalizeRange: 0 не отбрасывается как пустое', () => {
  const r = normalizeRange({ budget_min: 0, budget_max: 1000 });
  assert.equal(r.min, 0);
  assert.equal(r.max, 1000);
  assert.equal(r.invalid, false);
});

test('Ozon: без native price — бюджет словами в {q}, не как URL-фильтр', async () => {
  const ozon = sources.find((s) => s.id === 'ozon');
  assert.equal(ozon.price_filter_verified, false);
  const out = await linksSearch({
    parsed: { search_phrase: 'куртка', budget_min: 5000, budget_max: 15000, budget: 15000 },
    sources: [ozon],
  });
  const item = out.items[0];
  // Не подтверждённый native-фильтр площадки.
  assert.equal(item.price_filter_applied, false);
  assert.ok(!/currency_price=/.test(item.url));
  assert.ok(!(item.applied_filters || []).includes('price_min'));
  assert.ok(!(item.applied_filters || []).includes('price_max'));
  // Контракт: RUB + {q} → бюджет в поисковой фразе.
  assert.equal(item.budget_in_query, true);
  assert.ok((item.in_query_filters || []).includes('price'));
  assert.match(item.search_phrase_used || '', /5000/);
  assert.match(item.search_phrase_used || '', /15000/);
  assert.match(decodeURIComponent(item.url), /от\s*5000|до\s*15000|рубл/i);
  assert.ok(
    (item.filter_details || []).some((d) => d && d.kind === 'in_query' && d.field === 'price')
  );
});

test('ошибка одного источника не мешает другим', async () => {
  const bad = { id: 'bad', name: 'Bad', type: 'marketplace', verified: true, url_template: null };
  const yandex = sources.find((s) => s.id === 'yandex_market');
  const out = await linksSearch({
    parsed: { search_phrase: 'куртка', budget_max: 10000 },
    sources: [bad, yandex],
  });
  assert.equal(out.items.length, 2);
  assert.ok(out.items.find((i) => i.id === 'yandex_market' && i.url));
});

test('publicCriteria сохраняет совместимые одиночные поля', () => {
  const pub = publicCriteria({
    colors: ['чёрный', 'зелёный'],
    sizes: ['M'],
    budget_min: 0,
    budget_max: 5000,
  });
  assert.equal(pub.color, 'чёрный');
  assert.deepEqual(pub.colors, ['чёрный', 'зелёный']);
  assert.equal(pub.budget_min, 0);
});

test('несколько размеров не теряются в search_phrase', () => {
  const out = mergeCriteria(
    { raw_query: 'куртка', category: 'куртка', search_phrase: 'куртка' },
    { sizes: ['M', 'L'] },
    { priority: true, clear: [] }
  );
  assert.match(out.search_phrase, /размер M/);
  assert.match(out.search_phrase, /размер L/);
});
