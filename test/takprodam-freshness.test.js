'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCatalogFresh,
  isMarketplaceFresh,
  searchCatalog,
} = require('../lib/takprodam-catalog');

const NOW = Date.parse('2026-11-15T12:40:00.000Z');
const HOURS = 72;

function entry(partial) {
  return {
    title: 'Сумка тестовая',
    price: 1000,
    currency: null,
    marketplace: 'Ozon',
    marketplace_key: 'ozon',
    store_title: 'Shop',
    tracking_link: 'https://example.com/t',
    image_url: 'https://ir.ozone.ru/a.jpg',
    legal_text: 'Реклама. ООО. Erid: 1',
    category_title: 'Аксессуары',
    source_id: 24991,
    product_id: 1,
    fetched_at: '2026-11-11T19:26:47.552Z',
    ...partial,
  };
}

test('успех Ozon не делает срез Lamoda свежим', () => {
  const catalog = {
    fetched_at: '2026-11-15T12:33:44.108Z',
    marketplaces: {
      ozon: {
        status: 'ok',
        last_success_at: '2026-11-15T12:33:44.108Z',
      },
      lamoda: {
        status: 'error',
        last_success_at: '2026-11-11T19:26:47.552Z',
        last_error: 'product_fetch_failed:timeout',
      },
    },
    items: [
      entry({
        title: 'Портмоне Ozon',
        marketplace: 'Ozon',
        marketplace_key: 'ozon',
        product_id: 10,
        fetched_at: '2026-11-15T12:33:44.108Z',
      }),
      entry({
        title: 'Сумка Lamoda',
        marketplace: 'Lamoda',
        marketplace_key: 'lamoda',
        product_id: 20,
        image_url: 'https://a.lmcdn.ru/a.jpg',
        fetched_at: '2026-11-11T19:26:47.552Z',
      }),
    ],
  };

  assert.equal(isMarketplaceFresh(catalog, 'ozon', HOURS, NOW), true);
  assert.equal(isMarketplaceFresh(catalog, 'lamoda', HOURS, NOW), false);
  assert.equal(isCatalogFresh(catalog, HOURS, NOW), true);

  const found = searchCatalog(
    catalog,
    { search_phrase: 'сумка' },
    { max: 12, isProd: false, maxAgeHours: HOURS, nowMs: NOW }
  );
  assert.equal(found.items.length, 0);
  assert.equal(found.stale_skipped, 1);
  assert.equal(found.reason, 'stale_source_only');

  const wallets = searchCatalog(
    catalog,
    { search_phrase: 'портмоне' },
    { max: 12, isProd: false, maxAgeHours: HOURS, nowMs: NOW }
  );
  assert.equal(wallets.items.length, 1);
  assert.match(wallets.items[0].title, /Ozon/);
  assert.equal(wallets.items[0].marketplace_key, 'ozon');
});

test('просроченные записи остаются в каталоге, но не в активной выдаче', () => {
  const catalog = {
    fetched_at: '2026-11-15T12:33:44.108Z',
    marketplaces: {
      ozon: { last_success_at: '2026-11-15T12:33:44.108Z' },
      lamoda: { last_success_at: '2026-11-11T19:26:47.552Z' },
    },
    items: [
      entry({ title: 'Сумка Ozon', marketplace_key: 'ozon', product_id: 1 }),
      entry({
        title: 'Сумка Lamoda старая',
        marketplace: 'Lamoda',
        marketplace_key: 'lamoda',
        product_id: 2,
      }),
    ],
  };
  assert.equal(catalog.items.length, 2);
  const found = searchCatalog(
    catalog,
    { search_phrase: 'сумка' },
    { maxAgeHours: HOURS, nowMs: NOW, isProd: false }
  );
  assert.equal(found.items.length, 1);
  assert.match(found.items[0].title, /Ozon/);
  assert.equal(catalog.items.length, 2);
});
