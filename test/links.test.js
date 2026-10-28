'use strict';

/**
 * Корректность ссылок маркетплейсов (providers/links.js + data/sources.json).
 * Сеть к магазинам не вызывается.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../providers/links');
const sources = require('../data/sources.json');

test('в выдачу попадают только verified:true', async () => {
  const mixed = [
    ...sources,
    {
      id: 'fake',
      name: 'Fake',
      type: 'marketplace',
      url_template: 'https://example.com/?q={q}',
      verified: false,
    },
  ];
  const out = await links.search({
    parsed: { search_phrase: 'чёрный куртка', budget: 15000 },
    sources: mixed,
  });
  assert.ok(out.items.every((i) => i.id !== 'fake'));
  assert.ok(out.items.every((i) => sources.find((s) => s.id === i.id)?.verified === true));
});

test('кириллица и спецсимволы кодируются в URL', async () => {
  const phrase = 'чёрный куртка M&M + #1';
  const out = await links.search({
    parsed: { search_phrase: phrase, budget: null },
    sources: sources.filter((s) => s.id === 'ozon'),
  });
  assert.equal(out.items.length, 1);
  const url = out.items[0].url;
  assert.ok(url.includes(encodeURIComponent(phrase)));
  assert.ok(!url.includes('чёрный'));
  assert.ok(!url.includes('M&M'));
  assert.doesNotMatch(url, /(?<![%])#/);
});

test('бюджет в URL только при price_filter_verified; иначе текстовый fallback', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget: 15000, budget_max: 15000 },
    sources,
  });
  const ya = out.items.find((i) => i.id === 'yandex_market');
  const ozon = out.items.find((i) => i.id === 'ozon');
  const wb = out.items.find((i) => i.id === 'wildberries');
  assert.ok(ya);
  assert.equal(ya.price_filter_applied, true);
  assert.match(ya.url, /priceto=15000/);
  assert.ok(!decodeURIComponent(ya.url).includes('до 15000 рублей'), 'YM: no text budget duplicate');
  assert.equal(ozon.price_filter_applied, false);
  assert.ok(!/currency_price=/.test(ozon.url));
  assert.equal(ozon.budget_in_query, true);
  assert.ok(decodeURIComponent(ozon.url).includes('до 15000 рублей'));
  assert.ok((ozon.in_query_filters || []).includes('price'));
  assert.ok(!(ozon.applied_filters || []).includes('price'));
  assert.equal(wb.price_filter_applied, false);
  assert.equal(wb.budget_in_query, true);
});

test('Яндекс Маркет: pricefrom и priceto из диапазона', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget_min: 5000, budget_max: 15000, budget: 15000 },
    sources: sources.filter((s) => s.id === 'yandex_market'),
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].price_filter_applied, true);
  assert.match(out.items[0].url, /pricefrom=5000/);
  assert.match(out.items[0].url, /priceto=15000/);
  assert.ok(!/до 15000|до 15 000|рублей/.test(decodeURIComponent(out.items[0].url)));
  assert.equal(out.items[0].budget_in_query, false);
});

test('некорректный диапазон от>до не попадает в URL', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget_min: 20000, budget_max: 5000, budget: 5000 },
    sources: sources.filter((s) => s.id === 'yandex_market'),
  });
  assert.equal(out.items[0].price_filter_applied, false);
  assert.ok(!/pricefrom=/.test(out.items[0].url));
  assert.ok(!/priceto=/.test(out.items[0].url));
});

test('рублёвая цена не применяется к Zara (не RUB) ни фильтром, ни словами', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget: 15000, budget_max: 15000 },
    sources: sources.filter((s) => s.id === 'zara'),
  });
  assert.equal(out.items[0].price_filter_applied, false);
  assert.equal(out.items[0].budget_in_query, false);
  assert.ok(!/priceto|pricefrom|currency_price/.test(out.items[0].url));
  assert.ok(!decodeURIComponent(out.items[0].url).includes('рублей'));
});

test('витрина без {q} не заявляет передачу бюджета', async () => {
  const custom = [
    {
      id: 'vitrina',
      name: 'Vitrina',
      type: 'official_store',
      url_template: 'https://limestore.com/ru_ru/',
      price_currency: 'RUB',
      verified: true,
      price_filter_verified: false,
      link_kind: 'store_entry',
    },
  ];
  const out = await links.search({
    parsed: { search_phrase: 'платье', budget_max: 10000 },
    sources: custom,
  });
  assert.equal(out.items[0].budget_in_query, false);
  assert.equal(out.items[0].url, 'https://limestore.com/ru_ru/');
  assert.ok((out.items[0].filter_details || []).some((d) => /не передан/i.test(d.text || '')));
});

test('ручная цена в критериях — одна в текстовом fallback, без противоречий', async () => {
  const out = await links.search({
    parsed: {
      search_phrase: 'куртка',
      budget_min: null,
      budget_max: 10000,
      budget: 10000,
    },
    sources: sources.filter((s) => s.id === 'ozon'),
  });
  const decoded = decodeURIComponent(out.items[0].url);
  assert.ok(decoded.includes('до 10000 рублей'));
  assert.ok(!decoded.includes('15000'));
});

test('без search_phrase и raw_query — пустой список', async () => {
  const out = await links.search({ parsed: {}, sources });
  assert.deepEqual(out.items, []);
});

test('неизвестный price_param не придумывается; бюджет — словами в {q}', async () => {
  const custom = [
    {
      id: 'x',
      name: 'X',
      type: 'marketplace',
      url_template: 'https://example.com/s?q={q}',
      price_currency: 'RUB',
      verified: true,
      price_param: null,
      price_filter_verified: false,
    },
  ];
  const out = await links.search({
    parsed: { search_phrase: 'платье', budget: 9000, budget_max: 9000 },
    sources: custom,
  });
  assert.equal(out.items[0].price_filter_applied, false);
  assert.ok(!/price|currency/i.test(out.items[0].url.split('?')[1] || ''));
  assert.equal(
    out.items[0].url,
    'https://example.com/s?q=' + encodeURIComponent('платье до 9000 рублей')
  );
  assert.equal(out.items[0].budget_in_query, true);
});
