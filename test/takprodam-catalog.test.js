'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  legalTextLooksComplete,
  isFashionRelevantTitle,
  validateForPublic,
  searchCatalog,
  toPublicOffer,
  isCatalogFresh,
} = require('../lib/takprodam-catalog');

test('legal_text: пустой и без маркировки — неполные', () => {
  assert.equal(legalTextLooksComplete(''), false);
  assert.equal(legalTextLooksComplete('товар'), false);
  assert.equal(
    legalTextLooksComplete('Реклама. ООО «Ромашка». Erid: 2VtzqvXTest'),
    true
  );
});

test('fashion filter: краска исключается, сумка допускается', () => {
  assert.equal(isFashionRelevantTitle('Акриловая краска для мебели', 'Аксессуары'), false);
  assert.equal(isFashionRelevantTitle('Сумка женская кожаная', 'Аксессуары'), true);
  assert.equal(isFashionRelevantTitle('Браслет серебряный', 'Ювелирные изделия'), true);
});

test('fashion filter: кардхолдер, обложка документов и зажим для денег', () => {
  assert.equal(
    isFashionRelevantTitle('Кардхолдер из натуральной кожи крейзи хорс, для карт и банкнот', 'Аксессуары'),
    true
  );
  assert.equal(
    isFashionRelevantTitle('Обложка из натуральной кожи для прав, СТС, страховки', 'Аксессуары'),
    true
  );
  assert.equal(
    isFashionRelevantTitle('Обложка из натуральной кожи, для паспорта, коричневая', 'Аксессуары'),
    true
  );
  assert.equal(
    isFashionRelevantTitle('Зажим для банкнот, мужской, из натуральной кожи', 'Аксессуары'),
    true
  );
  assert.equal(isFashionRelevantTitle('Зажим для денег кожаный', 'Аксессуары'), true);
  assert.equal(isFashionRelevantTitle('Обложка книги художественной', 'Аксессуары'), false);
  assert.equal(isFashionRelevantTitle('Зажим для кабеля строительный', 'Аксессуары'), false);
});

test('validateForPublic требует tracking и legal', () => {
  const base = {
    title: 'Сумка кожаная',
    image_url: 'https://ir.ozone.ru/x.jpg',
    tracking_link: 'https://example.com/t',
    legal_text: 'Реклама. ООО Тест. Erid: abc',
    category_title: 'Аксессуары',
    product_id: 1,
    source_id: 24991,
  };
  assert.equal(validateForPublic(base).ok, true);
  assert.equal(validateForPublic({ ...base, tracking_link: null }).ok, false);
  assert.equal(validateForPublic({ ...base, legal_text: 'коротко' }).ok, false);
});

test('searchCatalog: без совпадений пусто; бренд обязателен в title', () => {
  const catalog = {
    fetched_at: new Date().toISOString(),
    items: [
      {
        title: 'Сумка чёрная кожаная',
        price: 1000,
        currency: null,
        marketplace: 'Ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/a',
        image_url: 'https://ir.ozone.ru/a.jpg',
        legal_text: 'Реклама. ООО. Erid: 1',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 11,
        fetched_at: new Date().toISOString(),
        source_updated_at: null,
      },
      {
        title: 'Браслет серебро',
        price: 500,
        currency: null,
        marketplace: 'Ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/b',
        image_url: 'https://ir.ozone.ru/b.jpg',
        legal_text: 'Реклама. ООО. Erid: 2',
        category_title: 'Ювелирные изделия',
        source_id: 24991,
        product_id: 12,
        fetched_at: new Date().toISOString(),
        source_updated_at: null,
      },
    ],
  };
  const hit = searchCatalog(catalog, { search_phrase: 'сумка чёрная' }, { isProd: false });
  assert.equal(hit.items.length, 1);
  assert.match(hit.items[0].title, /Сумка/);

  const miss = searchCatalog(catalog, { search_phrase: 'куртка кожаная' }, { isProd: false });
  assert.equal(miss.items.length, 0);

  const brandMiss = searchCatalog(
    catalog,
    { search_phrase: 'сумка', brand: 'Gucci' },
    { isProd: false }
  );
  assert.equal(brandMiss.items.length, 0);
});

test('searchCatalog: жёсткий бюджет исключает офферы без известной валюты', () => {
  const catalog = {
    fetched_at: new Date().toISOString(),
    items: [
      {
        title: 'Сумка чёрная',
        price: 1000,
        currency: null,
        marketplace: 'Ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/a',
        image_url: 'https://ir.ozone.ru/a.jpg',
        legal_text: 'Реклама. ООО. Erid: 1',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 21,
        fetched_at: new Date().toISOString(),
        source_updated_at: null,
      },
      {
        title: 'Сумка красная',
        price: 2000,
        currency: 'RUB',
        marketplace: 'Ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/b',
        image_url: 'https://ir.ozone.ru/b.jpg',
        legal_text: 'Реклама. ООО. Erid: 2',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 22,
        fetched_at: new Date().toISOString(),
        source_updated_at: null,
      },
      {
        title: 'Сумка дорогая',
        price: 90000,
        currency: 'RUB',
        marketplace: 'Ozon',
        store_title: 'Shop',
        tracking_link: 'https://example.com/c',
        image_url: 'https://ir.ozone.ru/c.jpg',
        legal_text: 'Реклама. ООО. Erid: 3',
        category_title: 'Аксессуары',
        source_id: 24991,
        product_id: 23,
        fetched_at: new Date().toISOString(),
        source_updated_at: null,
      },
    ],
  };
  const withBudget = searchCatalog(
    catalog,
    { search_phrase: 'сумка', budget_max: 5000 },
    { isProd: true }
  );
  assert.equal(withBudget.items.length, 1);
  assert.match(withBudget.items[0].title, /красная/);
  assert.equal(withBudget.items[0].price_mode, 'amount');

  const noBudget = searchCatalog(catalog, { search_phrase: 'сумка' }, { isProd: true });
  assert.ok(noBudget.items.some((i) => /чёрная/.test(i.title) && i.price_mode === 'clarify'));

  const onlyUnconfirmed = searchCatalog(
    {
      fetched_at: catalog.fetched_at,
      items: catalog.items.filter((i) => !i.currency),
    },
    { search_phrase: 'сумка', budget_max: 5000 },
    { isProd: true }
  );
  assert.equal(onlyUnconfirmed.items.length, 0);
  assert.equal(onlyUnconfirmed.reason, 'budget_currency_unconfirmed');
});

test('toPublicOffer: без currency в prod — Уточнить цену (clarify)', () => {
  const entry = {
    source_id: 24991,
    product_id: 7,
    title: 'Сумка',
    price: 1500,
    currency: null,
    marketplace: 'Ozon',
    store_title: 'S',
    external_link: 'https://www.ozon.ru/product/1',
    tracking_link: 'https://takprdm.ru/t?erid=x',
    image_url: 'https://ir.ozone.ru/x.jpg',
    legal_text: 'Реклама Erid: x',
    category_title: 'Аксессуары',
    fetched_at: '2026-11-11T00:00:00.000Z',
    source_updated_at: null,
  };
  const pub = toPublicOffer(entry, { isProd: true, score: 1 });
  assert.equal(pub.price_mode, 'clarify');
  assert.equal(pub.price, null);
  assert.equal(pub.product_url, 'https://www.ozon.ru/product/1');
  assert.equal(pub.affiliate_url, 'https://takprdm.ru/t?erid=x');
  assert.equal(pub.url, pub.affiliate_url);
  const local = toPublicOffer(entry, { isProd: false, score: 1 });
  assert.equal(local.price_mode, 'raw_unspecified_currency');
  assert.equal(local.price, 1500);
  assert.match(local.price_note, /валюта/i);
});

test('isCatalogFresh уважает maxAgeHours', () => {
  const fresh = { fetched_at: new Date().toISOString() };
  assert.equal(isCatalogFresh(fresh, 72), true);
  const stale = { fetched_at: new Date(Date.now() - 100 * 3600 * 1000).toISOString() };
  assert.equal(isCatalogFresh(stale, 72), false);
});

test('saved-items: affiliate без legal_text → marking_incomplete', () => {
  const Saved = require('../js/saved-items');
  const res = Saved.normalizeSavedItem({
    type: 'offer',
    id: 'takprodam:24991:1',
    item: 'Браслет',
    title: 'Браслет',
    url: 'https://takprdm.ru/x',
    source: 'Takprodam / Ozon',
    is_demo: false,
    price: 100,
    price_mode: 'clarify',
  });
  assert.equal(res.item.marking_incomplete, true);
  const ok = Saved.normalizeSavedItem({
    type: 'offer',
    id: 'takprodam:24991:2',
    item: 'Браслет',
    title: 'Браслет',
    url: 'https://takprdm.ru/y',
    source: 'Takprodam / Ozon',
    is_demo: false,
    legal_text: 'Реклама. ООО Тест. erid ABC',
    price_mode: 'clarify',
  });
  assert.equal(!!ok.item.marking_incomplete, false);
});
