'use strict';

/**
 * Сортировка цены: price_sort default|asc|desc (+ совместимость prefer_cheaper).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateSearchBody } = require('../lib/search-request');
const {
  sortPriceAscAllowed,
  sortPriceDescAllowed,
  anyVerifiedSortPriceAsc,
  anyVerifiedSortPriceDesc,
  resolvePriceSort,
  PRICE_SORT_ASC,
  PRICE_SORT_DESC,
  PRICE_SORT_DEFAULT,
} = require('../lib/marketplace-capabilities');
const { buildUrl, search: linksSearch } = require('../providers/links');
const { selectSources } = require('../lib/source-registry');

const ROOT = path.join(__dirname, '..');

test('price_sort: default|asc|desc ok; prefer_cheaper совместим', () => {
  assert.equal(validateSearchBody({ query: 'куртка', price_sort: 'asc' }).value.priceSort, 'asc');
  assert.equal(validateSearchBody({ query: 'куртка', price_sort: 'desc' }).value.priceSort, 'desc');
  assert.equal(validateSearchBody({ query: 'куртка', price_sort: 'default' }).value.priceSort, 'default');
  assert.equal(validateSearchBody({ query: 'куртка', prefer_cheaper: true }).value.priceSort, 'asc');
  assert.equal(validateSearchBody({ query: 'куртка', prefer_cheaper: false }).value.priceSort, 'default');
  assert.equal(validateSearchBody({ query: 'куртка' }).value.priceSort, 'default');
  // Явный price_sort приоритетнее prefer_cheaper.
  assert.equal(
    validateSearchBody({ query: 'куртка', price_sort: 'desc', prefer_cheaper: true }).value.priceSort,
    'desc'
  );
  assert.equal(
    validateSearchBody({ query: 'куртка', price_sort: 'default', prefer_cheaper: true }).value.priceSort,
    'default'
  );
  const bad = validateSearchBody({ query: 'куртка', prefer_cheaper: 'true' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error_kind, 'invalid_prefer_cheaper_type');
  const badSort = validateSearchBody({ query: 'куртка', price_sort: 'cheap' });
  assert.equal(badSort.ok, false);
  assert.equal(badSort.error_kind, 'invalid_price_sort_value');
});

test('resolvePriceSort: единое поле без противоречий', () => {
  assert.equal(resolvePriceSort({ prefer_cheaper: true }).priceSort, PRICE_SORT_ASC);
  assert.equal(resolvePriceSort({}).priceSort, PRICE_SORT_DEFAULT);
  assert.equal(resolvePriceSort({ price_sort: 'desc', prefer_cheaper: true }).priceSort, PRICE_SORT_DESC);
});

test('чип сортировки доступен при подтверждённых asc/desc', () => {
  assert.equal(anyVerifiedSortPriceAsc(), true);
  assert.equal(anyVerifiedSortPriceDesc(), true);
  const peak = require('../data/sources.json').find((s) => s.id === 'peak_concept');
  const spin = require('../data/sources.json').find((s) => s.id === 'spin4spin');
  const ym = require('../data/sources.json').find((s) => s.id === 'yandex_market');
  assert.equal(sortPriceAscAllowed(peak), true);
  assert.equal(sortPriceDescAllowed(peak), true);
  assert.equal(sortPriceAscAllowed(spin), false);
  assert.equal(sortPriceDescAllowed(spin), false);
  assert.equal(sortPriceAscAllowed(ym), false);
  assert.equal(sortPriceDescAllowed(ym), false);
});

test('подтверждённый источник получает параметр; бюджет и бренд не меняются', async () => {
  const source = {
    id: 'fixture_sort',
    name: 'Fixture Sort',
    type: 'marketplace',
    url_template: 'https://market.yandex.ru/search?text={q}',
    price_currency: 'RUB',
    verified: true,
    price_filter_verified: true,
    price_min_filter_verified: true,
    price_min_param: 'pricefrom',
    price_max_param: 'priceto',
    price_param: 'priceto',
    sort_price_asc_verified: true,
    sort_price_asc_param: 'how',
    sort_price_asc_value: 'aprice',
    sort_price_desc_verified: true,
    sort_price_desc_param: 'how',
    sort_price_desc_value: 'dprice',
    filter_capabilities: { sort_price_asc: 'verified_browser', sort_price_desc: 'verified_browser' },
  };
  assert.equal(sortPriceAscAllowed(source), true);
  const parsed = {
    search_phrase: 'куртка Nike',
    brand: 'Nike',
    brands: ['Nike'],
    budget_min: 5000,
    budget_max: 15000,
  };
  const off = buildUrl(source, parsed, { price_sort: 'default' });
  assert.ok(!/how=/.test(off.url));
  assert.equal(off.sort_price_asc_applied, false);
  assert.match(off.url, /pricefrom=5000/);
  assert.match(off.url, /priceto=15000/);

  const on = buildUrl(source, parsed, { price_sort: 'asc' });
  assert.equal(on.sort_price_asc_applied, true);
  assert.match(on.url, /how=aprice/);
  assert.match(on.url, /pricefrom=5000/);
  assert.equal(on.search_phrase_used, 'куртка Nike');
  assert.ok(!/сначала дешевле/i.test(on.search_phrase_used));

  const desc = buildUrl(source, parsed, { price_sort: 'desc' });
  assert.equal(desc.sort_price_desc_applied, true);
  assert.match(desc.url, /how=dprice/);
  assert.ok(!/how=aprice/.test(desc.url));
});

test('неподтверждённый не получает выдуманных параметров; есть пояснение', () => {
  const ozon = require('../data/sources.json').find((s) => s.id === 'ozon');
  const built = buildUrl(
    ozon,
    { search_phrase: 'куртка', budget_max: 10000 },
    { price_sort: 'asc' }
  );
  assert.equal(built.sort_price_asc_applied, false);
  assert.ok(!/how=|sort=|order=/i.test(built.url));
  assert.match(built.sort_price_note || '', /не подтверждена/i);
  assert.ok(!/сначала дешевле/i.test(built.search_phrase_used || ''));

  const desc = buildUrl(ozon, { search_phrase: 'куртка' }, { price_sort: 'desc' });
  assert.equal(desc.sort_price_desc_applied, false);
  assert.ok(!/дешевле|дороже/i.test(desc.search_phrase_used || ''));
});

test('переключение asc → desc → default без дублей', () => {
  const peak = require('../data/sources.json').find((s) => s.id === 'peak_concept');
  const asc = buildUrl(peak, { search_phrase: 'бомбер' }, { price_sort: 'asc' });
  assert.match(asc.url, /ORDER=ASC/);
  assert.ok(!/ORDER=DESC/.test(asc.url));
  const desc = buildUrl(peak, { search_phrase: 'бомбер' }, { price_sort: 'desc' });
  assert.match(desc.url, /ORDER=DESC/);
  assert.ok(!/ORDER=ASC/.test(desc.url));
  const def = buildUrl(peak, { search_phrase: 'бомбер' }, { price_sort: 'default' });
  assert.ok(!/SORT=|ORDER=/.test(def.url));
});

test('существующие query-параметры сохраняются при применении сортировки', () => {
  const source = {
    id: 'fixture_sort2',
    name: 'F',
    type: 'marketplace',
    url_template: 'https://market.yandex.ru/search?text={q}&lr=213',
    verified: true,
    price_currency: 'RUB',
    sort_price_asc_verified: true,
    sort_price_asc_param: 'how',
    sort_price_asc_value: 'aprice',
  };
  const built = buildUrl(source, { search_phrase: 'бомбер' }, { prefer_cheaper: true });
  assert.match(built.url, /lr=213/);
  assert.match(built.url, /how=aprice/);
  assert.match(built.url, /text=/);
});

test('отключённые ЦУМ/CULTT не в выдаче при prefer_cheaper', async () => {
  const sel = selectSources({ search_phrase: 'куртка' }, { maxSources: 20 });
  assert.ok(!sel.selected.some((s) => s.id === 'tsum_ru' || s.id === 'tsum_collect' || s.id === 'the_cultt'));
  const adapters = require('../data/sources.json').filter((s) =>
    ['ozon', 'yandex_market', 'tsum_collect'].includes(s.id)
  );
  const out = await linksSearch({
    parsed: { search_phrase: 'куртка' },
    sources: adapters,
    price_sort: 'asc',
  });
  assert.ok(!out.items.some((i) => i.id === 'tsum_collect'));
  assert.ok(out.items.some((i) => i.id === 'ozon'));
});

test('клиент: Цена содержит сортировку; отдельных плашек дешевле/доставка нет', () => {
  const code = fs.readFileSync(path.join(ROOT, 'js/criteria-panel.js'), 'utf8');
  assert.match(code, /price_sort/);
  assert.match(code, /Сначала дешевле/);
  assert.match(code, /Сначала дороже/);
  assert.match(code, /Без сортировки/);
  assert.ok(!/Скорость доставки/.test(code));
  assert.ok(!/criteria-chip-prefer-cheaper/.test(code));
  assert.ok(!/id: 'delivery'/.test(code));
});

test('Новый запрос сбрасывает price_sort через emptyState', () => {
  const searchJs = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
  assert.match(searchJs, /resetCurrentSearch/);
  assert.match(searchJs, /Criteria\.emptyState\(\)/);
  const panel = fs.readFileSync(path.join(ROOT, 'js/criteria-panel.js'), 'utf8');
  assert.match(panel, /price_sort:\s*PRICE_SORT_DEFAULT/);
});

test('SPIN4SPIN: /search?q= рабочий; бюджет/sort на search не применяем; Peak ORDER', () => {
  const spin = require('../data/sources.json').find((s) => s.id === 'spin4spin');
  const peak = require('../data/sources.json').find((s) => s.id === 'peak_concept');
  assert.equal(spin.price_filter_verified, false);
  assert.equal(spin.sort_price_asc_verified, false);
  assert.equal(spin.sort_price_desc_verified, false);

  const spinAsc = buildUrl(
    spin,
    { search_phrase: 'куртка', budget_min: 10000, budget_max: 50000 },
    { price_sort: 'asc' }
  );
  assert.equal(spinAsc.price_filter_applied, false);
  assert.equal(spinAsc.sort_price_asc_applied, false);
  assert.match(spinAsc.url, /spin4spin\.com\/search\?/);
  assert.match(spinAsc.url, /q=%D0%BA%D1%83%D1%80%D1%82%D0%BA%D0%B0/);
  assert.ok(!/price_min=/.test(spinAsc.url));
  assert.ok(!/sort=price_asc/.test(spinAsc.url));
  assert.ok(!/\{q\}/.test(spinAsc.url));
  assert.match(spinAsc.sort_price_asc_note || spinAsc.sort_price_note || '', /не подтвержд/i);

  const spinDesc = buildUrl(spin, { search_phrase: 'куртка' }, { price_sort: 'desc' });
  assert.equal(spinDesc.sort_price_desc_applied, false);
  assert.ok(!/sort=price_desc/.test(spinDesc.url));
  assert.match(spinDesc.url, /q=%D0%BA%D1%83%D1%80%D1%82%D0%BA%D0%B0/);

  const peakBuilt = buildUrl(peak, { search_phrase: 'бомбер' }, { price_sort: 'asc' });
  assert.equal(peakBuilt.sort_price_asc_applied, true);
  assert.match(peakBuilt.url, /SORT=PROPERTY_RETAIL_PRICE_MIN/);
  assert.match(peakBuilt.url, /ORDER=ASC/);
});

test('eBay: _sop=15/16 — цена с учётом доставки; RUB-бюджет не подставляется', () => {
  const ebay = require('../data/sources.json').find((s) => s.id === 'ebay');
  assert.equal(sortPriceAscAllowed(ebay), true);
  assert.equal(sortPriceDescAllowed(ebay), true);
  const asc = buildUrl(
    ebay,
    { search_phrase: 'hoodie', budget_min: 20, budget_max: 100 },
    { price_sort: 'asc' }
  );
  assert.equal(asc.sort_price_asc_applied, true);
  assert.match(asc.url, /_sop=15/);
  assert.match(asc.sort_price_note || '', /с учётом доставки/i);
  assert.equal(asc.price_filter_applied, false);

  const desc = buildUrl(ebay, { search_phrase: 'hoodie' }, { price_sort: 'desc' });
  assert.equal(desc.sort_price_desc_applied, true);
  assert.match(desc.url, /_sop=16/);
  assert.match(desc.sort_price_note || '', /с учётом доставки/i);
});
