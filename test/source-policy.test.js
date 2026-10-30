'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/source-policy');
const { searchProducts } = require('../lib/product-html');

test('CULTT: html и outbound restricted', () => {
  const s = policy.findById('the_cultt');
  assert.ok(s);
  assert.equal(policy.cap(s, 'html_product_fetch'), 'restricted');
  assert.equal(policy.cap(s, 'outbound_link'), 'restricted');
  assert.equal(policy.cap(s, 'web_search_display'), 'restricted');
  assert.equal(policy.htmlProductFetchAllowed(s), false);
  assert.equal(policy.outboundLinkAllowed(s), false);
  assert.equal(
    policy.webSearchDisplayAllowedForUrl('https://thecultt.com/x'),
    false
  );
});

test('TSUM Collect: html+outbound restricted; terms_quote сохранён', () => {
  const s = policy.findById('tsum_collect');
  assert.equal(s.connection_status, 'temporarily_limited');
  assert.equal(policy.cap(s, 'html_product_fetch'), 'restricted');
  assert.equal(policy.cap(s, 'outbound_link'), 'restricted');
  assert.equal(policy.htmlProductFetchAllowed(s), false);
  assert.equal(policy.outboundLinkAllowed(s), false);
  assert.ok(s.terms_quote && s.terms_quote.text && /4\.6|контент/i.test(s.terms_quote.section + s.terms_quote.text));
  assert.equal(s.terms_quote.url, 'https://collect.tsum.ru/terms');
  assert.match(s.blocker || s.product_exclusion_reason || '', /решению владельца/i);
});

test('ЦУМ (tsum_ru): temporarily_limited, outbound restricted', () => {
  const s = policy.findById('tsum_ru');
  assert.ok(s);
  assert.equal(s.connection_status, 'temporarily_limited');
  assert.equal(policy.cap(s, 'outbound_link'), 'restricted');
  assert.equal(policy.outboundLinkAllowed(s), false);
  assert.equal(policy.htmlProductFetchAllowed(s), false);
  assert.match(s.blocker || s.product_exclusion_reason || '', /решению владельца/i);
});

test('searchProducts отказывает по политике без сети', async () => {
  const res = await searchProducts(
    {
      id: 'the_cultt',
      search_url_template: 'https://thecultt.com/',
      parse: 'cultt_like',
    },
    'Chanel'
  );
  assert.equal(res.ok, false);
  assert.equal(res.error, 'policy_html_product_fetch_disabled');
  assert.equal((res.items || []).length, 0);
});

test('searchProducts TSUM Collect — policy deny, без сети', async () => {
  let fetchCalls = 0;
  const prev = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('unexpected network');
  };
  try {
    const res = await searchProducts(
      {
        id: 'tsum_collect',
        search_url_template: 'https://collect.tsum.ru/women/catalog?q={q}',
        parse: 'tsum_collect',
      },
      'Chanel'
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, 'policy_html_product_fetch_disabled');
    assert.equal((res.items || []).length, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = prev;
  }
});
