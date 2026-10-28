'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractWordPriceRange } = require('../lib/ru-amount');
const { parseQuery } = require('../lib/parse-query');
const brands = require('../data/brands.json');

test('от трёх до восьми тысяч → 3000–8000', () => {
  const w = extractWordPriceRange('куртка от трёх до восьми тысяч');
  assert.equal(w.budget_min, 3000);
  assert.equal(w.budget_max, 8000);
  const p = parseQuery('куртка от трёх до восьми тысяч', { brands });
  assert.equal(p.budget_min, 3000);
  assert.equal(p.budget_max, 8000);
  assert.equal(p.category, 'куртка');
  assert.doesNotMatch(p.search_phrase || '', /трёх|восьми|тысяч/i);
});

test('до пяти тысяч', () => {
  assert.equal(extractWordPriceRange('до пяти тысяч худи').budget_max, 5000);
});

test('не дороже десяти тысяч', () => {
  assert.equal(extractWordPriceRange('не дороже десяти тысяч').budget_max, 10000);
});

test('от двух тысяч пятисот до семи тысяч', () => {
  const w = extractWordPriceRange('от двух тысяч пятисот до семи тысяч');
  assert.equal(w.budget_min, 2500);
  assert.equal(w.budget_max, 7000);
});

test('от 3 до восьми тысяч', () => {
  const w = extractWordPriceRange('от 3 до восьми тысяч');
  assert.equal(w.budget_min, 3000);
  assert.equal(w.budget_max, 8000);
});
