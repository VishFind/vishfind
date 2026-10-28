'use strict';

/**
 * Целевые группы разбора естественных запросов (итерация NLU).
 * Ожидания заданы вручную, не копируются из parseQuery.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('../lib/parse-query');
const brands = require('../data/brands.json');
const movies = require('../movies.json');

function parse(q) {
  return parseQuery(q, { brands, movies });
}

test('NLU: формы слова — чёрную куртку / куртка чёрная', () => {
  assert.equal(parse('чёрную куртку').color, 'чёрный');
  assert.equal(parse('чёрную куртку').category, 'куртка');
  assert.equal(parse('куртка чёрная').color, 'чёрный');
  assert.equal(parse('куртка чёрная').category, 'куртка');
});

test('NLU: короткий запрос без размера/бренда/цены допустим', () => {
  const p = parse('чёрная куртка');
  assert.equal(p.category, 'куртка');
  assert.equal(p.color, 'чёрный');
  assert.equal(p.size, null);
  assert.equal(p.brand, null);
  assert.equal(p.budget, null);
  assert.ok(p.search_phrase);
});

test('NLU: бюджет — не дороже / до 7к / до 7 тысяч', () => {
  assert.equal(parse('куртка не дороже 7000').budget_max, 7000);
  assert.equal(parse('худи до 7к').budget_max, 7000);
  assert.equal(parse('худи до 7 тысяч').budget_max, 7000);
});

test('NLU: от 3 до 8 тысяч — единица на обе границы', () => {
  const p = parse('джинсы от 3 до 8 тысяч');
  assert.equal(p.budget_min, 3000);
  assert.equal(p.budget_max, 8000);
});

test('NLU: несколько цветов через «или»', () => {
  const p = parse('чёрный или зелёный худи');
  assert.deepEqual(p.colors.sort(), ['зелёный', 'чёрный'].sort());
  assert.equal(p.category, 'худи');
});

test('NLU: несколько брендов через «или»', () => {
  const p = parse('кроссовки Nike или Adidas размер 42');
  assert.ok(p.brands.includes('Nike'));
  assert.ok(p.brands.includes('Adidas'));
  assert.equal(p.size, '42');
});

test('NLU: худи или свитшот — оба типа, без подмены', () => {
  const p = parse('худи или свитшот');
  assert.ok(p.categories.includes('худи'));
  assert.ok(p.categories.includes('свитшот'));
  assert.equal(p.categories.length, 2);
});

test('NLU: отрицание цвета не становится положительным фильтром', () => {
  const p = parse('не красный худи');
  assert.ok(!p.colors.includes('красный'));
  assert.equal(p.color, null);
  assert.match(p.rest || '', /не\s+красный/i);
  assert.match(p.search_phrase || '', /не\s+красный/i);
  assert.ok((p.warnings || []).length >= 1);
});

test('NLU: неизвестное слово в rest, запрос не отклоняется', () => {
  const p = parse('куртка flibbertigibbet');
  assert.equal(p.category, 'куртка');
  assert.match(p.rest || '', /flibbertigibbet/i);
  assert.ok(p.search_phrase);
});

test('NLU: опубликованные примеры', () => {
  const a = parse('Чёрная кожаная куртка');
  assert.equal(a.color, 'чёрный');
  assert.ok(a.category === 'кожаная куртка' || a.category === 'куртка');

  const b = parse('Худи оверсайз, размер L, до 7000 ₽');
  assert.equal(b.category, 'худи');
  assert.equal(b.size, 'L');
  assert.equal(b.budget_max, 7000);

  const c = parse('Джинсы синие, размер 48, от 3000 до 8000 ₽');
  assert.equal(c.category, 'джинсы');
  assert.equal(c.color, 'синий');
  assert.equal(c.size, '48');
  assert.equal(c.budget_min, 3000);
  assert.equal(c.budget_max, 8000);

  const d = parse('Кроссовки Nike или Adidas, размер 42');
  assert.equal(d.category, 'кроссовки');
  assert.ok(d.brands.includes('Nike') && d.brands.includes('Adidas'));
  assert.equal(d.size, '42');
});
