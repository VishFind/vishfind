'use strict';

/**
 * Предпочтение доставки delivery_preference: any | fastest.
 * Без выдуманных URL-параметров: только delivery_fastest_verified + kind.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateSearchBody } = require('../lib/search-request');
const {
  deliveryFastestAllowed,
  deliveryFastestIsFilter,
  deliveryFastestIsSort,
  sortPreferencesConflict,
  anyVerifiedDeliveryFastest,
  normalizeDeliveryPreference,
  DELIVERY_PREFERENCE_ANY,
  DELIVERY_PREFERENCE_FASTEST,
} = require('../lib/marketplace-capabilities');
const { buildUrl, search: linksSearch } = require('../providers/links');
const { selectSources } = require('../lib/source-registry');

const ROOT = path.join(__dirname, '..');

test('delivery_preference: any|fastest ok; неверные значения отклоняются', () => {
  assert.equal(
    validateSearchBody({ query: 'куртка', delivery_preference: 'any' }).value.deliveryPreference,
    'any'
  );
  assert.equal(
    validateSearchBody({ query: 'куртка', delivery_preference: 'fastest' }).value.deliveryPreference,
    'fastest'
  );
  assert.equal(validateSearchBody({ query: 'куртка' }).value.deliveryPreference, 'any');
  const badType = validateSearchBody({ query: 'куртка', delivery_preference: true });
  assert.equal(badType.ok, false);
  assert.equal(badType.error_kind, 'invalid_delivery_preference_type');
  const badVal = validateSearchBody({ query: 'куртка', delivery_preference: 'tomorrow' });
  assert.equal(badVal.ok, false);
  assert.equal(badVal.error_kind, 'invalid_delivery_preference_value');
  assert.equal(normalizeDeliveryPreference('fastest'), DELIVERY_PREFERENCE_FASTEST);
  assert.equal(normalizeDeliveryPreference(null), DELIVERY_PREFERENCE_ANY);
});

test('в реестре нет подтверждённой быстрой доставки', () => {
  assert.equal(anyVerifiedDeliveryFastest(), false);
  for (const id of ['ozon', 'wildberries', 'yandex_market']) {
    const src = require('../data/sources.json').find((s) => s.id === id);
    assert.equal(deliveryFastestAllowed(src), false);
  }
});

test('any не добавляет параметр доставки; текст и бюджет сохраняются', () => {
  const ym = require('../data/sources.json').find((s) => s.id === 'yandex_market');
  const built = buildUrl(
    ym,
    { search_phrase: 'куртка Nike', brand: 'Nike', budget_min: 5000, budget_max: 15000 },
    { delivery_preference: 'any', prefer_cheaper: false }
  );
  assert.equal(built.delivery_preference, 'any');
  assert.equal(built.delivery_fastest_applied, false);
  assert.equal(built.delivery_note, null);
  assert.match(built.url, /pricefrom=5000/);
  assert.match(built.url, /priceto=15000/);
  assert.equal(built.search_phrase_used, 'куртка Nike');
  assert.ok(!/доставк|быстр/i.test(built.search_phrase_used));
  assert.ok(!/delivery|delivery_days|shipping|срок/i.test(built.url));
});

test('fastest без подтверждения: нет параметра, есть пояснение; фраза без «быстрая доставка»', () => {
  const ozon = require('../data/sources.json').find((s) => s.id === 'ozon');
  const built = buildUrl(
    ozon,
    { search_phrase: 'бомбер', budget_max: 8000 },
    { delivery_preference: 'fastest' }
  );
  assert.equal(built.delivery_fastest_applied, false);
  assert.match(built.delivery_note, /не подтверждена/i);
  assert.ok(!/быстрая доставка/i.test(built.search_phrase_used || ''));
  assert.ok(!/доставк/i.test(built.search_phrase_used || ''));
});

test('подтверждённый filter: параметр + цена вместе; kind=filter', () => {
  const source = {
    id: 'fixture_del_filter',
    name: 'F',
    type: 'marketplace',
    url_template: 'https://market.yandex.ru/search?text={q}',
    verified: true,
    price_currency: 'RUB',
    price_filter_verified: true,
    price_min_filter_verified: true,
    price_min_param: 'pricefrom',
    price_max_param: 'priceto',
    delivery_fastest_verified: true,
    delivery_fastest_kind: 'filter',
    delivery_fastest_param: 'delivery-interval',
    delivery_fastest_value: '1_2_days',
    filter_capabilities: { delivery_fastest: 'verified_browser' },
  };
  assert.equal(deliveryFastestIsFilter(source), true);
  assert.equal(deliveryFastestIsSort(source), false);
  const built = buildUrl(
    source,
    { search_phrase: 'куртка', budget_max: 10000 },
    { delivery_preference: 'fastest', prefer_cheaper: true }
  );
  assert.equal(built.delivery_fastest_applied, true);
  assert.equal(built.delivery_fastest_kind, 'filter');
  assert.match(built.url, /delivery-interval=1_2_days/);
  assert.match(built.url, /priceto=10000/);
  assert.equal(built.sort_price_asc_applied, false);
  assert.ok((built.applied_filters || []).includes('delivery_fastest_filter'));
  assert.ok(!/как можно скорее|быстрая доставка/i.test(built.search_phrase_used));
});

test('подтверждённый sort доставки + prefer_cheaper: конфликт, не перезаписываем', () => {
  const source = {
    id: 'fixture_conflict',
    name: 'F',
    type: 'marketplace',
    url_template: 'https://market.yandex.ru/search?text={q}',
    verified: true,
    price_currency: 'RUB',
    sort_price_asc_verified: true,
    sort_price_asc_param: 'how',
    sort_price_asc_value: 'aprice',
    delivery_fastest_verified: true,
    delivery_fastest_kind: 'sort',
    delivery_fastest_param: 'how',
    delivery_fastest_value: 'delivery_asc',
    filter_capabilities: {
      sort_price_asc: 'verified_browser',
      delivery_fastest: 'verified_browser',
    },
  };
  assert.equal(sortPreferencesConflict(source, true, 'fastest'), true);
  const both = buildUrl(
    source,
    { search_phrase: 'куртка' },
    { prefer_cheaper: true, delivery_preference: 'fastest' }
  );
  assert.equal(both.sort_price_asc_applied, true);
  assert.match(both.url, /how=aprice/);
  assert.ok(!/delivery_asc/.test(both.url));
  assert.equal(both.delivery_fastest_applied, false);
  assert.match(both.delivery_note, /не совмещена/i);

  const onlyDelivery = buildUrl(
    source,
    { search_phrase: 'куртка' },
    { prefer_cheaper: false, delivery_preference: 'fastest' }
  );
  assert.equal(onlyDelivery.delivery_fastest_applied, true);
  assert.match(onlyDelivery.url, /how=delivery_asc/);
  assert.ok(!/aprice/.test(onlyDelivery.url));
});

test('filter доставки + sort цены совместимы', () => {
  const source = {
    id: 'fixture_combo',
    name: 'F',
    type: 'marketplace',
    url_template: 'https://market.yandex.ru/search?text={q}',
    verified: true,
    price_currency: 'RUB',
    price_filter_verified: true,
    price_min_filter_verified: true,
    price_min_param: 'pricefrom',
    price_max_param: 'priceto',
    sort_price_asc_verified: true,
    sort_price_asc_param: 'how',
    sort_price_asc_value: 'aprice',
    delivery_fastest_verified: true,
    delivery_fastest_kind: 'filter',
    delivery_fastest_param: 'delivery-interval',
    delivery_fastest_value: '1',
    filter_capabilities: {
      sort_price_asc: 'verified_browser',
      delivery_fastest: 'verified_browser',
    },
  };
  assert.equal(sortPreferencesConflict(source, true, 'fastest'), false);
  const built = buildUrl(
    source,
    { search_phrase: 'куртка Nike', brand: 'Nike', budget_min: 1000, budget_max: 5000 },
    { prefer_cheaper: true, delivery_preference: 'fastest' }
  );
  assert.equal(built.sort_price_asc_applied, true);
  assert.equal(built.delivery_fastest_applied, true);
  assert.match(built.url, /how=aprice/);
  assert.match(built.url, /delivery-interval=1/);
  assert.match(built.url, /pricefrom=1000/);
  assert.match(built.url, /priceto=5000/);
  assert.equal(built.search_phrase_used, 'куртка Nike');
  assert.ok(!/быстрая доставка|сначала дешевле/i.test(built.search_phrase_used));
});

test('отключённые источники не возвращаются при delivery_preference', async () => {
  const sel = selectSources({ search_phrase: 'куртка' }, { maxSources: 20 });
  assert.ok(!sel.selected.some((s) => s.id === 'tsum_ru' || s.id === 'tsum_collect' || s.id === 'the_cultt'));
  const adapters = require('../data/sources.json').filter((s) =>
    ['ozon', 'yandex_market', 'tsum_collect'].includes(s.id)
  );
  const out = await linksSearch({
    parsed: { search_phrase: 'куртка' },
    sources: adapters,
    delivery_preference: 'fastest',
  });
  assert.ok(!out.items.some((i) => i.id === 'tsum_collect'));
  assert.ok(out.items.some((i) => i.id === 'ozon'));
});

test('клиент: доставка убрана из UI; старое preference не влияет', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'js/criteria-panel.js'), 'utf8');
  assert.match(panel, /delivery_preference:\s*'any'/);
  assert.ok(!/Скорость доставки/.test(panel));
  assert.ok(!/Любой срок/.test(panel));
  assert.ok(!/Как можно скорее/.test(panel));
  assert.ok(!/id: 'delivery'/.test(panel));
  const searchJs = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
  assert.match(searchJs, /delivery_preference не отправляем/);
  assert.ok(!/payload\.delivery_preference/.test(searchJs));
  assert.match(searchJs, /Criteria\.emptyState\(\)/);
  assert.match(searchJs, /resetCurrentSearch/);
  assert.match(searchJs, /photoAnalysisDone/);
});
