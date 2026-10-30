'use strict';

/**
 * Продуктовое исключение ЦУМ / TSUM Collect из активной выдачи.
 * Не путать с THE CULTT (thecultt.com).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/source-policy');
const ollamaWeb = require('../lib/ollama-web');
const { selectSources, adaptersForSelection } = require('../lib/source-registry');
const sources = require('../data/sources.json');
const { searchProducts } = require('../lib/product-html');

const EXCLUDED = ['tsum_ru', 'tsum_collect'];

function assertNoTsum(sel) {
  const ids = (sel.selected || []).map((s) => s.id);
  const extras = (sel.officialExtras || []).map((s) => s.id);
  for (const id of EXCLUDED) {
    assert.ok(!ids.includes(id), 'selected has ' + id);
    assert.ok(!extras.includes(id), 'officialExtras has ' + id);
  }
}

test('ЦУМ и TSUM Collect не в активной выдаче (общий запрос)', () => {
  const sel = selectSources({ search_phrase: 'чёрная куртка' }, { maxSources: 20 });
  assertNoTsum(sel);
  assert.ok(sel.selected.some((s) => s.id === 'ozon'));
  assert.ok(sel.selected.some((s) => s.id === 'wildberries'));
});

test('брендовый запрос не обходит отключение TSUM', () => {
  for (const brand of ['Dior', 'Chanel', 'Gucci']) {
    const sel = selectSources(
      { brands: [brand], search_phrase: brand + ' сумка' },
      { maxSources: 20 }
    );
    assertNoTsum(sel);
    const adapters = adaptersForSelection(
      [...sel.selected, ...(sel.officialExtras || [])],
      sources
    );
    assert.ok(!adapters.some((a) => a.id === 'tsum_collect' || a.registry_id === 'tsum_collect'));
    assert.ok(!adapters.some((a) => /tsum\.ru/i.test(a.url_template || '')));
  }
});

test('official extras и fallback не возвращают TSUM', () => {
  const sel = selectSources(
    { brands: ['Nike'], search_phrase: 'Nike худи' },
    { maxSources: 8, includeCandidates: true }
  );
  assertNoTsum(sel);
  assert.ok(!(sel.officialExtras || []).some((e) => /tsum/i.test(e.id || '')));
  assert.ok(!(sel.officialExtras || []).some((e) => /tsum\.ru/i.test(e.domain || '')));
});

test('web-результаты www.tsum.ru и collect.tsum.ru отфильтровываются', () => {
  assert.equal(policy.isOutboundRestrictedHost('www.tsum.ru'), true);
  assert.equal(policy.isOutboundRestrictedHost('tsum.ru'), true);
  assert.equal(policy.isOutboundRestrictedHost('collect.tsum.ru'), true);
  // Не путать с CULTT и не резать посторонние домены.
  assert.equal(policy.isOutboundRestrictedHost('thecultt.com'), true);
  assert.equal(policy.isOutboundRestrictedHost('nike.com'), false);
  assert.equal(policy.isOutboundRestrictedHost('brandshop.ru'), false);

  const raw = [
    { url: 'https://www.nike.com/w?q=1', title: 'Nike', content: 'ok' },
    { url: 'https://www.tsum.ru/catalog/foo', title: 'TSUM', content: 'x' },
    { url: 'https://collect.tsum.ru/item/1', title: 'Collect', content: 'y' },
    { url: 'https://brandshop.ru/search?q=1', title: 'BS', content: 'z' },
  ];
  const out = policy.filterWebSearchResults(raw, {
    allowedDomains: ['www.nike.com', 'www.tsum.ru', 'collect.tsum.ru', 'brandshop.ru'],
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => !/tsum\.ru/i.test(r.url)));
  assert.ok(out.some((r) => /nike\.com/i.test(r.url)));
  assert.ok(out.some((r) => /brandshop\.ru/i.test(r.url)));
});

test('кэш web-результатов повторно режет TSUM-домены', () => {
  const cached = [
    { url: 'https://www.adidas.com/search', title: 'A', content: 'x' },
    { url: 'https://www.tsum.ru/p/1', title: 'T', content: 'y' },
    { url: 'https://collect.tsum.ru/women/catalog', title: 'C', content: 'z' },
  ];
  const out = ollamaWeb.applySearchResultPolicy(cached, [
    'www.adidas.com',
    'www.tsum.ru',
    'collect.tsum.ru',
  ]);
  assert.equal(out.length, 1);
  assert.match(out[0].url, /adidas/);
});

test('webFetch к TSUM запрещён; посторонний documented путь не расширяем здесь', () => {
  assert.equal(policy.webFetchAllowedForUrl('https://www.tsum.ru/item/1'), false);
  assert.equal(policy.webFetchAllowedForUrl('https://collect.tsum.ru/item/1'), false);
  assert.equal(
    policy.webSearchDisplayAllowedForUrl('https://www.tsum.ru/catalog'),
    false
  );
  assert.equal(
    policy.webSearchDisplayAllowedForUrl('https://collect.tsum.ru/women/catalog'),
    false
  );
});

test('HTML/fetch к отключённым TSUM не вызывается (mock fetch)', async () => {
  let fetchCalls = 0;
  const prev = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('unexpected network call');
  };
  try {
    for (const id of EXCLUDED) {
      const res = await searchProducts(
        {
          id,
          search_url_template: 'https://example.invalid/{q}',
          parse: 'tsum_collect',
        },
        'куртка'
      );
      assert.equal(res.ok, false);
      assert.equal(res.error, 'policy_html_product_fetch_disabled');
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = prev;
  }
});

test('другие источники продолжают работать после исключения TSUM', () => {
  const sel = selectSources({ brands: ['Nike'], search_phrase: 'Nike худи' }, { maxSources: 8 });
  const ids = sel.selected.map((s) => s.id);
  assert.ok(ids.includes('nike_com'));
  assert.ok(ids.includes('ozon') && ids.includes('wildberries') && ids.includes('yandex_market'));
  assert.ok(ids.some((id) => id === 'brandshop' || id === 'peak_concept' || id === 'spin4spin'));
  assertNoTsum(sel);
});
