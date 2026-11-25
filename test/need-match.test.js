'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNeedModel, matchNeeds } = require('../lib/need-match');
const Saved = require('../js/saved-items');

const NOW = Date.parse('2026-11-15T12:40:00.000Z');

function fixtureCatalog() {
  return {
    fetched_at: '2026-11-15T12:33:44.108Z',
    marketplaces: {
      ozon: { status: 'ok', last_success_at: '2026-11-15T12:33:44.108Z' },
      lamoda: { status: 'error', last_success_at: '2026-11-11T19:26:47.552Z' },
    },
    items: [
      {
        schema_version: 2,
        provider: 'takprodam',
        source_id: 24991,
        product_id: 101,
        marketplace: 'Ozon',
        marketplace_key: 'ozon',
        store_title: 'Shop',
        title: 'Сумка кожаная коричневая дорожная',
        price: 4500,
        currency: null,
        category_title: 'Аксессуары',
        tracking_link: 'https://takprdm.ru/a',
        external_link: 'https://www.ozon.ru/a',
        image_url: 'https://ir.ozone.ru/a.jpg',
        legal_text: 'Реклама. ООО Тест. Erid: aaa',
        fetched_at: '2026-11-15T12:33:44.108Z',
      },
      {
        schema_version: 2,
        provider: 'takprodam',
        source_id: 24991,
        product_id: 102,
        marketplace: 'Ozon',
        marketplace_key: 'ozon',
        store_title: 'Shop',
        title: 'Портмоне мужское кожаное',
        price: 3000,
        currency: null,
        category_title: 'Аксессуары',
        tracking_link: 'https://takprdm.ru/b',
        external_link: 'https://www.ozon.ru/b',
        image_url: 'https://ir.ozone.ru/b.jpg',
        legal_text: 'Реклама. ООО Тест. Erid: bbb',
        fetched_at: '2026-11-15T12:33:44.108Z',
      },
      {
        schema_version: 2,
        provider: 'takprodam',
        source_id: 24991,
        product_id: 103,
        marketplace: 'Ozon',
        marketplace_key: 'ozon',
        store_title: 'Shop',
        title: 'Кардхолдер из натуральной кожи',
        price: 1500,
        currency: null,
        category_title: 'Аксессуары',
        tracking_link: 'https://takprdm.ru/c',
        external_link: 'https://www.ozon.ru/c',
        image_url: 'https://ir.ozone.ru/c.jpg',
        legal_text: 'Реклама. ООО Тест. Erid: ccc',
        fetched_at: '2026-11-15T12:33:44.108Z',
      },
      {
        schema_version: 2,
        provider: 'takprodam',
        source_id: 24991,
        product_id: 201,
        marketplace: 'Lamoda',
        marketplace_key: 'lamoda',
        store_title: 'lamoda ru',
        title: 'Сумка дорожная Pais',
        price: 4893,
        currency: null,
        category_title: 'Аксессуары',
        tracking_link: 'https://takprdm.ru/l',
        external_link: 'https://www.lamoda.ru/l',
        image_url: 'https://a.lmcdn.ru/l.jpg',
        legal_text: 'Реклама. ООО Тест. Erid: lll',
        fetched_at: '2026-11-11T19:26:47.552Z',
      },
    ],
  };
}

test('модель запроса: бюджет обязателен, размер неизвестен', () => {
  const model = buildNeedModel(
    { category: 'сумка', budget_max: 5000, size: 'M', search_phrase: 'сумка' },
    'сумка до 5000 размер M'
  );
  assert.equal(model.category, 'сумка');
  assert.ok(model.must.some((m) => m.field === 'budget' && m.hard));
  assert.ok(model.unknown.some((u) => u.field === 'size'));
});

test('обычный подбор: до пяти, без случайных товаров', () => {
  const res = matchNeeds(
    fixtureCatalog(),
    { search_phrase: 'сумка', category: 'сумка' },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'сумка' }
  );
  assert.ok(res.items.length <= 5);
  assert.ok(res.items.length >= 1);
  assert.match(res.items[0].title, /Сумка/);
  assert.ok(Array.isArray(res.items[0].match_notes));
  assert.ok(res.items[0].match_notes.some((n) => /назван/i.test(n.basis || '')));
  assert.equal(
    res.items.some((it) => /Lamoda|Pais/i.test(it.title)),
    false
  );
});

test('исключение и альтернативы', () => {
  const cat = fixtureCatalog();
  const first = matchNeeds(
    cat,
    { search_phrase: 'кожа' },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'кожа' }
  );
  assert.ok(first.items.length >= 1);
  const id = first.items[0].id;
  const next = matchNeeds(
    cat,
    { search_phrase: 'кожа' },
    {
      max: 5,
      isProd: true,
      maxAgeHours: 72,
      nowMs: NOW,
      raw_query: 'кожа',
      exclude_ids: [id],
    }
  );
  assert.equal(next.items.some((it) => it.id === id), false);
  assert.equal(next.actions.reset_exclusions, true);
});

test('исчерпание после исключений', () => {
  const cat = fixtureCatalog();
  const all = matchNeeds(
    cat,
    { search_phrase: 'кардхолдер' },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'кардхолдер' }
  );
  const ids = all.items.map((it) => it.id);
  const empty = matchNeeds(
    cat,
    { search_phrase: 'кардхолдер' },
    {
      max: 5,
      isProd: true,
      maxAgeHours: 72,
      nowMs: NOW,
      raw_query: 'кардхолдер',
      exclude_ids: ids,
    }
  );
  assert.equal(empty.items.length, 0);
  assert.equal(empty.reason, 'exhausted_after_exclusions');
});

test('жёсткий бюджет без валюты', () => {
  const res = matchNeeds(
    fixtureCatalog(),
    { search_phrase: 'сумка', budget_max: 5000 },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'сумка до 5000' }
  );
  assert.equal(res.items.length, 0);
  assert.equal(res.reason, 'budget_currency_unconfirmed');
  assert.match(res.note, /валют/i);
});

test('просроченный источник не попадает в подбор', () => {
  const res = matchNeeds(
    fixtureCatalog(),
    { search_phrase: 'Pais' },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'Pais' }
  );
  assert.equal(res.items.length, 0);
  assert.equal(res.reason, 'stale_source_only');
  assert.equal(
    res.note,
    'Предложения по этому запросу временно не показываем: данные магазина требуют обновления.'
  );
});

test('состояние подбора хранится отдельно от избранного', () => {
  const storage = Saved.createMemoryStorage({
    'vishfind-saved': JSON.stringify([{ id: 'keep', type: 'query', query: 'сумка', item: 'Сумка' }]),
  });
  const written = Saved.writeNeedMatch(storage, {
    query: 'сумка',
    exclude_ids: ['takprodam:24991:ozon:101'],
  });
  assert.equal(written.ok, true);
  const loaded = Saved.loadNeedMatch(storage);
  assert.equal(loaded.state.query, 'сумка');
  assert.equal(loaded.state.exclude_ids.length, 1);
  assert.equal(JSON.parse(storage.getItem('vishfind-saved')).length, 1);
});

test('кнопки без данных: нет качественнее/дешевле', () => {
  const res = matchNeeds(
    fixtureCatalog(),
    { search_phrase: 'портмоне' },
    { max: 5, isProd: true, maxAgeHours: 72, nowMs: NOW, raw_query: 'портмоне' }
  );
  assert.equal(res.actions.can_filter_quality, false);
  assert.equal(res.actions.can_filter_cheaper, false);
  assert.equal(res.actions.edit_requirements, true);
});
