'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titleFitsCategory, tokenMatchesTitle } = require('../lib/category-guards');

test('джинсовая куртка не подходит под джинсы', () => {
  assert.equal(titleFitsCategory('джинсы', 'Куртка джинсовая синяя', 'Одежда'), false);
  assert.equal(titleFitsCategory('джинсы', 'Джинсы синие slim', 'Одежда'), true);
  assert.equal(tokenMatchesTitle('джинс', 'Куртка джинсовая', 'джинсы'), false);
  assert.equal(tokenMatchesTitle('джинс', 'Джинсы прямые', 'джинсы'), true);
});

test('куртка не подходит под брюки', () => {
  assert.equal(titleFitsCategory('брюки', 'Куртка зимняя', 'Одежда'), false);
  assert.equal(titleFitsCategory('куртка', 'Куртка джинсовая', 'Одежда'), true);
});
