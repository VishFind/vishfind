'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('../lib/parse-query');
const { search: linksSearch } = require('../providers/links');
const { buildReport, isFilterEnabled } = require('../lib/marketplace-capabilities');
const sources = require('../data/sources.json');
const movies = require('../movies.json');
const brands = require('../data/brands.json');

const EXAMPLES = [
  'куртка',
  'чёрная куртка размер M',
  'худи Nike до 15к',
  'бомбер от 5000 до 15000',
];

for (const q of EXAMPLES) {
  test('пример парсится: ' + q, () => {
    const p = parseQuery(q, { movies, brands });
    assert.ok(p.search_phrase, 'ожидался search_phrase для «' + q + '»');
  });
}

test('Яндекс pricefrom только «от»', async () => {
  const yandex = sources.find((s) => s.id === 'yandex_market');
  const out = await linksSearch({
    parsed: { search_phrase: 'бомбер', budget_min: 5000, budget_max: null },
    sources: [yandex],
  });
  assert.match(out.items[0].url, /pricefrom=5000/);
  assert.ok(!/priceto=/.test(out.items[0].url));
});

test('отключение только price_min не убирает price_max', async () => {
  const yandex = {
    ...sources.find((s) => s.id === 'yandex_market'),
    disabled_filters: ['price_min'],
  };
  assert.equal(isFilterEnabled(yandex, 'price_min'), false);
  assert.equal(isFilterEnabled(yandex, 'price_max'), true);
  const out = await linksSearch({
    parsed: { search_phrase: 'бомбер', budget_min: 5000, budget_max: 15000 },
    sources: [yandex],
  });
  assert.ok(!/pricefrom=/.test(out.items[0].url));
  assert.match(out.items[0].url, /priceto=15000/);
  assert.ok(out.items[0].applied_filters.includes('price_max'));
  assert.ok(out.items[0].unsupported_filters.includes('price_min'));
});

test('отчёт совместимости без сети и с Vestiaire off', () => {
  const report = buildReport();
  assert.ok(report.sources.length >= 7);
  const vestiaire = report.sources.find((s) => s.id === 'vestiaire');
  assert.equal(vestiaire.shown_to_user, false);
  assert.ok(vestiaire.disabled_reason);
  const yandex = report.sources.find((s) => s.id === 'yandex_market');
  assert.equal(yandex.criteria.price_min.implemented, 'url_param');
});

test('Vestiaire отсутствует в выдаче links (не регрессия verified)', async () => {
  const out = await linksSearch({
    parsed: { search_phrase: 'куртка' },
    sources,
  });
  assert.ok(!out.items.some((i) => i.id === 'vestiaire'));
  assert.ok(out.items.some((i) => i.id === 'yandex_market'));
});
