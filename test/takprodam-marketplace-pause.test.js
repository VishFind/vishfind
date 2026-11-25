'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PAUSED,
  isMarketplacePaused,
  pausedMarketplaces,
  pauseNote,
} = require('../lib/takprodam-marketplace-pause');
const {
  isMarketplaceFresh,
  searchCatalog,
} = require('../lib/takprodam-catalog');
const {
  SYNTH_NOW,
  syntheticFreshAndStaleCatalog,
} = require('./fixtures/synthetic-catalog');

test('по умолчанию Lamoda на паузе, Ozon нет', () => {
  assert.deepEqual([...DEFAULT_PAUSED], ['lamoda']);
  assert.equal(isMarketplacePaused('lamoda', {}), true);
  assert.equal(isMarketplacePaused('ozon', {}), false);
  assert.equal(isMarketplacePaused('LAMODA', {}), true);
});

test('пустой TAKPRODAM_MARKETPLACE_PAUSE снимает паузу', () => {
  const env = { TAKPRODAM_MARKETPLACE_PAUSE: '' };
  assert.equal(pausedMarketplaces(env).size, 0);
  assert.equal(isMarketplacePaused('lamoda', env), false);
});

test('текст паузы — не запрет', () => {
  const note = pauseNote('lamoda');
  assert.match(note, /паузе/i);
  assert.match(note, /не вывод о запрете/i);
  assert.match(note, /время актуальности не менялось/i);
});

test('пауза/просрочка Lamoda не скрывает свежие предложения Ozon', () => {
  assert.equal(isMarketplacePaused('lamoda', {}), true);
  assert.equal(isMarketplacePaused('ozon', {}), false);

  const now = Date.parse('2026-11-15T12:40:00.000Z');
  const catalog = {
    fetched_at: '2026-11-15T12:33:44.108Z',
    marketplaces: {
      ozon: { status: 'ok', last_success_at: '2026-11-15T12:33:44.108Z' },
      lamoda: {
        status: 'error',
        last_success_at: '2026-11-11T19:26:47.552Z',
        last_error: 'marketplace_paused:lamoda',
      },
    },
    items: [
      {
        title: 'Браслет серебряный Ozon',
        price: 1200,
        currency: null,
        marketplace: 'Ozon',
        marketplace_key: 'ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/t1',
        image_url: 'https://ir.ozone.ru/a.jpg',
        legal_text: 'Реклама. ООО. Erid: 1',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 101,
        fetched_at: '2026-11-15T12:33:44.108Z',
      },
      {
        title: 'Сумка кожаная Lamoda',
        price: 5000,
        currency: null,
        marketplace: 'Lamoda',
        marketplace_key: 'lamoda',
        store_title: 'lamoda ru',
        tracking_link: 'https://example.com/t2',
        image_url: 'https://a.lmcdn.ru/a.jpg',
        legal_text: 'Реклама. ООО. Erid: 2',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 202,
        fetched_at: '2026-11-11T19:26:47.552Z',
      },
    ],
  };

  assert.equal(isMarketplaceFresh(catalog, 'ozon', 72, now), true);
  assert.equal(isMarketplaceFresh(catalog, 'lamoda', 72, now), false);

  const bracelets = searchCatalog(
    catalog,
    { search_phrase: 'браслет' },
    { max: 12, isProd: false, maxAgeHours: 72, nowMs: now }
  );
  assert.equal(bracelets.items.length, 1);
  assert.equal(bracelets.items[0].marketplace_key, 'ozon');
  assert.equal(bracelets.reason, null);

  const bags = searchCatalog(
    catalog,
    { search_phrase: 'сумка' },
    { max: 12, isProd: false, maxAgeHours: 72, nowMs: now }
  );
  assert.equal(bags.items.length, 0);
  assert.equal(bags.reason, 'stale_source_only');
  assert.equal(bags.stale_skipped, 1);
});

test('синтетическая фикстура: stale-only для сумки без рабочего каталога', () => {
  const cat = syntheticFreshAndStaleCatalog();
  const now = Date.parse(SYNTH_NOW);
  assert.equal(isMarketplaceFresh(cat, 'synthetic_fresh', 72, now), true);
  assert.equal(isMarketplaceFresh(cat, 'synthetic_stale', 72, now), false);
  const bag = searchCatalog(cat, { search_phrase: 'сумка' }, { isProd: true, maxAgeHours: 72, nowMs: now });
  assert.equal(bag.reason, 'stale_source_only');
  assert.equal(bag.items.length, 0);
  const wallet = searchCatalog(
    cat,
    { search_phrase: 'портмоне' },
    { isProd: true, maxAgeHours: 72, nowMs: now }
  );
  assert.ok(wallet.items.some((it) => /портмоне/i.test(it.title)));
});

test('синтетическая фикстура не лежит в рабочем каталоге Takprodam', () => {
  const livePath = path.join(__dirname, '..', 'data', 'takprodam-catalog', 'catalog.json');
  const raw = fs.readFileSync(livePath, 'utf8');
  assert.doesNotMatch(raw, /synthetic:fixture/);
  assert.doesNotMatch(raw, /SyntheticStale/);
  const fixtureSrc = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'synthetic-catalog.js'),
    'utf8'
  );
  assert.match(fixtureSrc, /not for live search catalog/);
});
