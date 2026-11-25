'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveSeller,
  offerDedupeKey,
  catalogPublicId,
  legacyPublicId,
  normalizeEntry,
  migrateCatalogToV2,
  mergeMarketplaceIntoCatalog,
  decideMarketplaceWrite,
  resolveSavedOfferId,
  isSavedOfferCurrent,
  SCHEMA_VERSION,
} = require('../lib/takprodam-schema');
const { searchCatalog, toPublicOffer } = require('../lib/takprodam-catalog');
const Saved = require('../js/saved-items');

test('Admitad marketplace_title не становится продавцом автоматически', () => {
  const a = resolveSeller('Admitad', 'patch and go');
  assert.equal(a.seller_known, true);
  assert.equal(a.seller_title, 'patch and go');

  const b = resolveSeller('Admitad', null);
  assert.equal(b.seller_known, false);
  assert.equal(b.seller_title, null);
  assert.match(String(b.seller_note), /channel label/i);

  const c = resolveSeller('Ozon', null);
  assert.equal(c.seller_known, false);
});

test('дедуп: повтор той же записи — один ключ; разные marketplace — разные ключи', () => {
  const ozon = normalizeEntry(
    {
      source_id: 24991,
      id: 'uuid-1',
      product_id: 100,
      marketplace: 'Ozon',
      store_title: 'Shop',
      title: 'Сумка',
      tracking_link: 'https://takprdm.ru/a',
      external_link: 'https://www.ozon.ru/p/1',
      image_url: 'https://ir.ozone.ru/a.jpg',
      legal_text: 'Реклама. ООО. Erid: 1',
      price: 10,
      currency: null,
      fetched_at: '2026-11-11T00:00:00.000Z',
    },
    { marketplaceSlug: 'ozon' }
  );
  const ozonAgain = normalizeEntry(
    {
      ...ozon,
      marketplace: 'Ozon',
      id: 'uuid-1',
      product_id: 100,
    },
    { marketplaceSlug: 'ozon' }
  );
  const lamodaSamePid = normalizeEntry(
    {
      source_id: 24991,
      id: 'uuid-2',
      product_id: 100,
      marketplace: 'Lamoda',
      store_title: 'lamoda ru',
      title: 'Сумка другая',
      tracking_link: 'https://takprdm.ru/b',
      external_link: 'https://www.lamoda.ru/p/x',
      image_url: 'https://a.lmcdn.ru/b.jpg',
      legal_text: 'Реклама. ООО. Erid: 2',
      price: 20,
      currency: null,
      fetched_at: '2026-11-11T00:00:00.000Z',
    },
    { marketplaceSlug: 'lamoda' }
  );

  assert.equal(offerDedupeKey(ozon), offerDedupeKey(ozonAgain));
  assert.notEqual(offerDedupeKey(ozon), offerDedupeKey(lamodaSamePid));
  assert.notEqual(catalogPublicId(ozon), catalogPublicId(lamodaSamePid));
});

test('варианты разных продавцов не схлопываются по названию', () => {
  const a = normalizeEntry(
    {
      source_id: 24991,
      id: 'a',
      product_id: 1,
      marketplace: 'Ozon',
      store_title: 'Seller A',
      title: 'Сумка чёрная',
      tracking_link: 'https://takprdm.ru/a',
      external_link: 'https://www.ozon.ru/1',
      image_url: 'https://ir.ozone.ru/1.jpg',
      legal_text: 'Реклама. Erid: aaaa',
    },
    { marketplaceSlug: 'ozon' }
  );
  const b = normalizeEntry(
    {
      source_id: 24991,
      id: 'b',
      product_id: 2,
      marketplace: 'Ozon',
      store_title: 'Seller B',
      title: 'Сумка чёрная',
      tracking_link: 'https://takprdm.ru/b',
      external_link: 'https://www.ozon.ru/2',
      image_url: 'https://ir.ozone.ru/2.jpg',
      legal_text: 'Реклама. Erid: bbbb',
    },
    { marketplaceSlug: 'ozon' }
  );
  assert.notEqual(offerDedupeKey(a), offerDedupeKey(b));
});

test('merge: сбой одного marketplace сохраняет items другого', () => {
  let cat = migrateCatalogToV2({
    source_id: 24991,
    fetched_at: '2026-11-11T10:00:00.000Z',
    items: [
      normalizeEntry(
        {
          source_id: 24991,
          id: 'o1',
          product_id: 1,
          marketplace: 'Ozon',
          title: 'Портмоне',
          tracking_link: 'https://takprdm.ru/o',
          external_link: 'https://www.ozon.ru/1',
          image_url: 'https://ir.ozone.ru/1.jpg',
          legal_text: 'Реклама. Erid: o1',
          store_title: 'S',
          fetched_at: '2026-11-11T10:00:00.000Z',
        },
        { marketplaceSlug: 'ozon' }
      ),
      normalizeEntry(
        {
          source_id: 24991,
          id: 'l1',
          product_id: 2,
          marketplace: 'Lamoda',
          title: 'Сумка',
          tracking_link: 'https://takprdm.ru/l',
          external_link: 'https://www.lamoda.ru/1',
          image_url: 'https://a.lmcdn.ru/1.jpg',
          legal_text: 'Реклама. Erid: l1',
          store_title: 'lamoda ru',
          fetched_at: '2026-11-11T10:00:00.000Z',
        },
        { marketplaceSlug: 'lamoda' }
      ),
    ],
  }).catalog;

  const ozonFail = decideMarketplaceWrite({
    apiError: true,
    fetched: 0,
    admitted: 0,
    apiEmptySuccess: false,
  });
  assert.equal(ozonFail.writeCatalog, false);

  cat.marketplaces = cat.marketplaces || {};
  cat.marketplaces.ozon = {
    ...(cat.marketplaces.ozon || {}),
    last_success_at: '2026-11-11T10:00:00.000Z',
    status: 'ok',
  };
  cat = mergeMarketplaceIntoCatalog(cat, 'ozon', {
    writeItems: false,
    items: [],
    status: {
      status: 'error',
      last_attempt_at: '2026-11-11T12:00:00.000Z',
      last_success_at: null,
      last_error: 'product_fetch_failed',
      outcome: ozonFail.outcome,
    },
  });
  assert.equal(cat.marketplaces.ozon.last_success_at, '2026-11-11T10:00:00.000Z');
  assert.equal(cat.marketplaces.ozon.status, 'error');

  const lamodaOk = normalizeEntry(
    {
      source_id: 24991,
      id: 'l2',
      product_id: 3,
      marketplace: 'Lamoda',
      title: 'Ремень',
      tracking_link: 'https://takprdm.ru/l2',
      external_link: 'https://www.lamoda.ru/2',
      image_url: 'https://a.lmcdn.ru/2.jpg',
      legal_text: 'Реклама. Erid: l2xx',
      store_title: 'lamoda ru',
      fetched_at: '2026-11-11T12:00:00.000Z',
    },
    { marketplaceSlug: 'lamoda' }
  );

  cat = mergeMarketplaceIntoCatalog(cat, 'lamoda', {
    writeItems: true,
    items: [lamodaOk],
    status: {
      status: 'ok',
      last_attempt_at: '2026-11-11T12:00:00.000Z',
      last_success_at: '2026-11-11T12:00:00.000Z',
      outcome: 'success_write_catalog',
    },
  });

  const ozonItems = cat.items.filter((i) => i.marketplace_key === 'ozon');
  const lamodaItems = cat.items.filter((i) => i.marketplace_key === 'lamoda');
  assert.equal(ozonItems.length, 1);
  assert.equal(ozonItems[0].product_id, 1);
  assert.equal(lamodaItems.length, 1);
  assert.equal(lamodaItems[0].product_id, 3);
  assert.equal(cat.marketplaces.ozon.status, 'error');
  assert.equal(cat.marketplaces.lamoda.status, 'ok');
});

test('миграция v1→v2 создаёт aliases и сохраняет ссылки/legal', () => {
  const v1 = {
    source_id: 24991,
    fetched_at: '2026-11-11T18:00:00.000Z',
    items: [
      {
        source_id: 24991,
        id: 'old-uuid',
        product_id: 777,
        marketplace: 'Ozon',
        store_title: 'Shop',
        title: 'Сумка',
        external_link: 'https://www.ozon.ru/product/777/',
        tracking_link: 'https://takprdm.ru/t?erid=abc',
        image_url: 'https://ir.ozone.ru/x.jpg',
        legal_text: 'Реклама. ООО Тест. Erid: abc',
        price: 1000,
        currency: null,
        fetched_at: '2026-11-11T18:00:00.000Z',
      },
    ],
  };
  const { catalog, changed, idAliases } = migrateCatalogToV2(v1);
  assert.equal(changed, true);
  assert.equal(catalog.schema_version, SCHEMA_VERSION);
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].marketplace_key, 'ozon');
  assert.equal(catalog.items[0].external_link, 'https://www.ozon.ru/product/777/');
  assert.equal(catalog.items[0].legal_text, 'Реклама. ООО Тест. Erid: abc');
  const legacy = legacyPublicId(catalog.items[0]);
  const next = catalogPublicId(catalog.items[0]);
  assert.equal(idAliases[legacy], next);

  const resolved = resolveSavedOfferId(legacy, catalog);
  assert.equal(resolved.status, 'aliased');
  assert.equal(resolved.id, next);
});

test('избранное: legal сохраняется; legacy id помечается', () => {
  const ok = Saved.normalizeSavedItem({
    type: 'offer',
    id: 'takprodam:24991:ozon:777',
    item: 'Сумка',
    title: 'Сумка',
    url: 'https://takprdm.ru/t',
    source: 'Takprodam / Ozon',
    is_demo: false,
    legal_text: 'Реклама. ООО Тест. erid ABC',
    product_url: 'https://www.ozon.ru/product/777/',
    affiliate_url: 'https://takprdm.ru/t',
    price_mode: 'clarify',
  });
  assert.equal(!!ok.item.marking_incomplete, false);
  assert.equal(ok.item.legal_text.includes('Реклама'), true);

  const legacy = Saved.normalizeSavedItem({
    type: 'offer',
    id: 'takprodam:24991:777',
    item: 'Сумка',
    title: 'Сумка',
    url: 'https://takprdm.ru/t',
    source: 'Takprodam / Ozon',
    is_demo: false,
    legal_text: 'Реклама. ООО Тест. erid ABC',
  });
  assert.equal(legacy.item.id_format, 'legacy_v1');
});

test('бюджет + неизвестная валюта по-прежнему исключает', () => {
  const catalog = {
    fetched_at: new Date().toISOString(),
    items: [
      normalizeEntry(
        {
          source_id: 24991,
          id: '1',
          product_id: 1,
          marketplace: 'Lamoda',
          title: 'Сумка чёрная',
          price: 1000,
          currency: null,
          tracking_link: 'https://takprdm.ru/a',
          external_link: 'https://www.lamoda.ru/a',
          image_url: 'https://a.lmcdn.ru/a.jpg',
          legal_text: 'Реклама. Erid: 1',
          store_title: 'lamoda ru',
          fetched_at: new Date().toISOString(),
        },
        { marketplaceSlug: 'lamoda' }
      ),
    ],
  };
  const hit = searchCatalog(catalog, { search_phrase: 'сумка', budget_max: 5000 }, { isProd: true });
  assert.equal(hit.items.length, 0);
  assert.equal(hit.reason, 'budget_currency_unconfirmed');
});

test('toPublicOffer сохраняет product_url/affiliate_url и v2 id', () => {
  const entry = normalizeEntry(
    {
      source_id: 24991,
      id: 'u',
      product_id: 5,
      marketplace: 'Ozon',
      title: 'Сумка',
      price: 10,
      currency: null,
      external_link: 'https://www.ozon.ru/p/5',
      tracking_link: 'https://takprdm.ru/t',
      image_url: 'https://ir.ozone.ru/x.jpg',
      legal_text: 'Реклама Erid: x',
      store_title: 'S',
      fetched_at: '2026-11-11T00:00:00.000Z',
    },
    { marketplaceSlug: 'ozon' }
  );
  const pub = toPublicOffer(entry, { isProd: true });
  assert.equal(pub.id, 'takprodam:24991:ozon:5');
  assert.equal(pub.product_url, 'https://www.ozon.ru/p/5');
  assert.equal(pub.affiliate_url, 'https://takprdm.ru/t');
  assert.equal(pub.url, pub.affiliate_url);
});

test('миграция файлом: backup + rollback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-mig-'));
  const catalogFile = path.join(dir, 'catalog.json');
  const v1 = {
    source_id: 24991,
    fetched_at: '2026-11-11T18:00:00.000Z',
    items: [
      {
        source_id: 24991,
        id: 'x',
        product_id: 9,
        marketplace: 'Ozon',
        title: 'Сумка',
        external_link: 'https://www.ozon.ru/9',
        tracking_link: 'https://takprdm.ru/9',
        image_url: 'https://ir.ozone.ru/9.jpg',
        legal_text: 'Реклама. Erid: nine',
        store_title: 'S',
      },
    ],
  };
  fs.writeFileSync(catalogFile, JSON.stringify(v1));
  const { catalog } = migrateCatalogToV2(v1);
  const bak = path.join(dir, 'backups', 'catalog.pre-v2.test.json');
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.writeFileSync(bak, JSON.stringify(v1));
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  assert.equal(JSON.parse(fs.readFileSync(catalogFile, 'utf8')).schema_version, SCHEMA_VERSION);
  fs.writeFileSync(catalogFile, fs.readFileSync(bak));
  assert.equal(JSON.parse(fs.readFileSync(catalogFile, 'utf8')).schema_version, undefined);
  assert.equal(JSON.parse(fs.readFileSync(catalogFile, 'utf8')).items[0].product_id, 9);
});

test('сохранённый id вне каталога не считается актуальным', () => {
  const { catalog } = migrateCatalogToV2({
    source_id: 24991,
    fetched_at: '2026-11-11T18:00:00.000Z',
    items: [
      {
        source_id: 24991,
        id: 'x',
        product_id: 9,
        marketplace: 'Ozon',
        title: 'Сумка',
        external_link: 'https://www.ozon.ru/9',
        tracking_link: 'https://takprdm.ru/9',
        image_url: 'https://ir.ozone.ru/9.jpg',
        legal_text: 'Реклама. Erid: nine',
        store_title: 'S',
      },
    ],
  });
  const current = catalogPublicId(catalog.items[0]);
  assert.equal(isSavedOfferCurrent(current, catalog), true);
  assert.equal(isSavedOfferCurrent(legacyPublicId(catalog.items[0]), catalog), true);
  assert.equal(isSavedOfferCurrent('takprodam:24991:ozon:missing-offer', catalog), false);
  assert.equal(isSavedOfferCurrent(current, { items: [] }), false);
});
