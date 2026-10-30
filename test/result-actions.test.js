'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const links = require('../providers/links');
const sources = require('../data/sources.json');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');

test('UI: «Что распозналось», копирование запроса, фильтр групп', () => {
  assert.match(js, /Что распозналось/);
  assert.match(js, /Скопировать запрос/);
  assert.match(js, /Упростить запрос/);
  assert.match(js, /linkGroupFilter/);
  assert.match(js, /Подходящие сайты/);
  assert.match(js, /Открыть поиск/);
  assert.match(js, /Открыть сайт/);
  assert.doesNotMatch(js, /Найдено N товаров|Найдена лучшая цена|Все фильтры применены/);
  assert.doesNotMatch(js, /Сортировка: сначала дешевле/);
  assert.match(js, /linkGroupFilter = 'all'/);
});

test('сброс очищает фильтр групп', () => {
  assert.match(js, /function resetCurrentSearch/);
  const resetIdx = js.indexOf('function resetCurrentSearch');
  const chunk = js.slice(resetIdx, resetIdx + 2500);
  assert.match(chunk, /linkGroupFilter\s*=\s*'all'/);
});

test('Яндекс: native price; search_phrase_used без текстового бюджета', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget_min: 5000, budget_max: 10000, budget: 10000 },
    sources: sources.filter((s) => s.id === 'yandex_market'),
  });
  const item = out.items[0];
  assert.equal(item.price_filter_applied, true);
  assert.equal(item.budget_in_query, false);
  assert.equal(item.search_phrase_used, 'куртка');
  assert.ok((item.applied_filters || []).length);
  assert.ok(!(item.in_query_filters || []).includes('price'));
});

test('Ozon: бюджет не пишется словами в {q}; примечание о ручном фильтре', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'куртка', budget_max: 10000, budget: 10000 },
    sources: sources.filter((s) => s.id === 'ozon'),
  });
  const item = out.items[0];
  assert.equal(item.budget_in_query, false);
  assert.equal(item.search_phrase_used, 'куртка');
  assert.ok(!/до 10000 рублей/.test(item.search_phrase_used || ''));
  assert.ok(!(item.in_query_filters || []).includes('price'));
  assert.ok((item.filter_details || []).some((d) => d && /не подтвержд/i.test(d.text || '')));
});

test('витрина без {q}: phrase_accepts_query false', async () => {
  const out = await links.search({
    parsed: { search_phrase: 'платье', budget_max: 8000 },
    sources: [
      {
        id: 'vitrina',
        name: 'V',
        type: 'official_store',
        url_template: 'https://limestore.com/ru_ru/',
        price_currency: 'RUB',
        verified: true,
        link_kind: 'store_entry',
      },
    ],
  });
  assert.equal(out.items[0].phrase_accepts_query, false);
  assert.equal(out.items[0].budget_in_query, false);
  assert.ok((out.items[0].filter_details || []).some((d) => /не переда/i.test(d.text || '')));
});

test('фильтр групп — только клиентский (нет fetch в обработчике)', () => {
  assert.match(js, /paintGroups/);
  const idx = js.indexOf('function paintGroups');
  const chunk = js.slice(idx, idx + 800);
  assert.doesNotMatch(chunk, /fetch\(/);
  assert.doesNotMatch(chunk, /\/api\/search/);
});
