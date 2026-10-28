'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPeakLike, extractCulttLike, safeUrl } = require('../lib/product-html');

test('safeUrl блокирует чужие хосты', () => {
  assert.equal(safeUrl('https://evil.example/x'), null);
  assert.ok(safeUrl('https://peakstore.ru/catalog/?q=a'));
});

test('extractPeakLike читает markdown-блоки с ценой', () => {
  const html = `
### Carhartt WIP
Jacket Detroit
12 500 ₽
### Nike
Hoodie Club
8 990 ₽
`;
  const items = extractPeakLike(html, 'https://peakstore.ru/catalog/?q=x');
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 12500);
  assert.equal(items[0].result_kind, 'product');
  assert.equal(items[0].currency, 'RUB');
});

test('extractCulttLike читает лоты с цены', () => {
  const { extractCulttLike: extract, extractTsumCollect } = require('../lib/product-html');
  const html = `## Chanel Classic
245 000 ₽
## Hermès Birkin
1 200 000 ₽`;
  const items = extract(html, 'https://thecultt.com/');
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 245000);
  assert.equal(items[0].result_kind, 'product');

  const culttHtml2 =
    'href="/product/PN31907941"><span>Chanel Vanity </span><b>559\u00a0000\u00a0₽</b>';
  const c2 = extract(culttHtml2, 'https://thecultt.com/');
  assert.ok(c2.length >= 1);
  assert.equal(c2[0].price, 559000);
  assert.match(c2[0].url, /PN31907941/);

  const tsumHtml =
    'href="/item/ITEM397298"></a><img alt="Chanel" data-brandlogo="true"/><span>699\u00a0000\u00a0₽</span>';
  const t = extractTsumCollect(tsumHtml, 'https://collect.tsum.ru/');
  assert.equal(t.length, 1);
  assert.equal(t[0].price, 699000);
  assert.equal(t[0].brand, 'Chanel');
  assert.match(t[0].url, /ITEM397298/);
});
