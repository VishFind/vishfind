'use strict';

/**
 * Контрольные тесты качества текстового разбора (lib/parse-query.js).
 * Консервативные ожидания: не угадываем бренд, числовой размер только с «размер».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('../lib/parse-query');
const brands = require('../data/brands.json');
const movies = require('../movies.json');

function parse(q) {
  return parseQuery(q, { brands, movies });
}

test('комплексный запрос: цвет, материал, категория, винтаж, бюджет, размер', () => {
  const p = parse('чёрная кожаная куртка, винтаж, до 15 000, размер M');
  assert.equal(p.budget, 15000);
  assert.equal(p.budget_max, 15000);
  assert.equal(p.size, 'M');
  assert.equal(p.color, 'чёрный');
  assert.equal(p.category, 'кожаная куртка');
  assert.equal(p.brand, null);
  assert.match(p.rest || '', /винтаж/i);
  assert.ok(p.search_phrase);
  assert.match(p.search_phrase, /куртка/);
  assert.doesNotMatch(p.search_phrase, /15000|15 000/);
});

test('бюджет: до 15 000', () => {
  assert.equal(parse('куртка до 15 000').budget, 15000);
});

test('бюджет: до 15к', () => {
  assert.equal(parse('куртка до 15к').budget, 15000);
});

test('бюджет: до 15 тыс.', () => {
  assert.equal(parse('куртка до 15 тыс.').budget, 15000);
});

test('бюджет: 15к без «до»', () => {
  const p = parse('15к худи');
  assert.equal(p.budget, 15000);
  assert.equal(p.category, 'худи');
  assert.doesNotMatch(p.search_phrase || '', /15к|15000/);
});

test('бюджет: 15 тыс без «до»', () => {
  const p = parse('худи 15 тыс');
  assert.equal(p.budget, 15000);
  assert.equal(p.category, 'худи');
  assert.doesNotMatch(p.rest || '', /^тыс$/);
});

test('бюджет: бюджет 20000', () => {
  assert.equal(parse('куртка бюджет 20000').budget, 20000);
});

test('бюджет не путается с маленьким числом «до 48»', () => {
  const p = parse('куртка до 48');
  assert.equal(p.budget, null);
  assert.equal(p.size, null);
});

test('размер буквенный с явным словом: размер XL', () => {
  assert.equal(parse('размер XL худи').size, 'XL');
});

test('размер буквенный рядом с категорией: худи XL', () => {
  assert.equal(parse('худи XL').size, 'XL');
});

test('размер M рядом с категорией', () => {
  assert.equal(parse('куртка M').size, 'M');
});

test('числовой размер только с явным указанием', () => {
  assert.equal(parse('куртка размер 48').size, '48');
  assert.equal(parse('куртка 48').size, null);
});

test('цвет и словоформы: чёрная / черный', () => {
  assert.equal(parse('чёрная куртка').color, 'чёрный');
  assert.equal(parse('черный свитер').color, 'чёрный');
});

test('цвет на английском: black / white', () => {
  assert.equal(parse('black jacket').color, 'чёрный');
  assert.equal(parse('white dress').color, 'белый');
});

test('категории: куртка, джинсы, платье, худи', () => {
  assert.equal(parse('куртка').category, 'куртка');
  assert.equal(parse('джинсы').category, 'джинсы');
  assert.equal(parse('красное платье').category, 'платье');
  assert.equal(parse('худи').category, 'худи');
});

test('известный бренд из словаря', () => {
  const p = parse('Nike худи');
  assert.equal(p.brand, 'Nike');
  assert.equal(p.category, 'худи');
});

test('неизвестное слово не становится брендом и не удаляется', () => {
  const p = parse('xyzzy куртка');
  assert.equal(p.brand, null);
  assert.equal(p.category, 'куртка');
  assert.match(p.rest || '', /xyzzy/i);
  assert.match(p.search_phrase, /xyzzy/i);
});

test('запрос без бюджета', () => {
  const p = parse('серое пальто');
  assert.equal(p.budget, null);
  assert.equal(p.color, 'серый');
  assert.equal(p.category, 'пальто');
});

test('запрос без бренда не заполняет бренд', () => {
  const p = parse('чёрная куртка размер M');
  assert.equal(p.brand, null);
});

test('смешанный русский/латинский текст', () => {
  const p = parse('чёрный oversize jacket');
  assert.equal(p.color, 'чёрный');
  assert.equal(p.category, 'куртка');
  assert.match(p.rest || '', /oversize/i);
});

test('лишние пробелы и пунктуация', () => {
  const p = parse('  куртка   ,,  чёрная  ');
  assert.equal(p.category, 'куртка');
  assert.equal(p.color, 'чёрный');
  assert.ok(p.search_phrase);
});

test('значимые слова винтаж / кожаная / oversize сохраняются', () => {
  const p = parse('кожаная винтаж oversize куртка');
  assert.equal(p.category, 'куртка');
  assert.match(p.rest || '', /кожан/i);
  assert.match(p.rest || '', /винтаж/i);
  assert.match(p.rest || '', /oversize/i);
  assert.match(p.search_phrase, /кожан/i);
  assert.match(p.search_phrase, /винтаж/i);
  assert.match(p.search_phrase, /oversize/i);
});

test('бюджет не становится размером и размер не становится бюджетом', () => {
  const p = parse('куртка до 15 000 размер M');
  assert.equal(p.budget, 15000);
  assert.equal(p.size, 'M');
  const q = parse('куртка размер 48 до 20к');
  assert.equal(q.size, '48');
  assert.equal(q.budget, 20000);
});

test('пользовательский запрос не подменяется другой вещью', () => {
  const p = parse('платье');
  assert.equal(p.category, 'платье');
  assert.doesNotMatch(p.search_phrase, /куртка|джинсы/);
});

test('пустой и стоп-слова: search_phrase null', () => {
  assert.equal(parse('').search_phrase, null);
  assert.equal(parse('пожалуйста найди одежду вещь').search_phrase, null);
});

test('длинный комплексный запрос сохраняет суть', () => {
  const p = parse(
    'Ищу чёрную кожаную куртку, винтаж, oversize, до 30 000 руб, размер L, как в фильме, пожалуйста'
  );
  assert.equal(p.color, 'чёрный');
  // «кожаную куртку» — словоформа; точная «кожаная куртка» может не сработать → куртка
  assert.ok(p.category === 'куртка' || p.category === 'кожаная куртка');
  assert.equal(p.budget, 30000);
  assert.equal(p.size, 'L');
  assert.match(p.rest || '', /винтаж|кожан|oversize/i);
});

test('категория брюки распознаётся (для пустых демо-offers)', () => {
  const p = parse('брюки шерстяные до 5000');
  assert.equal(p.category, 'брюки');
  assert.equal(p.budget, 5000);
});

test('сырой запрос сохраняется в raw_query', () => {
  const q = 'Чёрная куртка';
  assert.equal(parse(q).raw_query, q);
});

test('цена: от 5000', () => {
  const p = parse('куртка от 5000');
  assert.equal(p.budget_min, 5000);
  assert.equal(p.budget_max, null);
  assert.equal(p.budget, null);
});

test('цена: от 5000 до 15000', () => {
  const p = parse('куртка от 5000 до 15000');
  assert.equal(p.budget_min, 5000);
  assert.equal(p.budget_max, 15000);
  assert.equal(p.budget, 15000);
  assert.doesNotMatch(p.search_phrase || '', /5000|15000|до/);
});

test('цена: до 15000', () => {
  const p = parse('худи до 15000');
  assert.equal(p.budget_max, 15000);
  assert.equal(p.budget, 15000);
  assert.equal(p.budget_min, null);
});

test('расширенный тип: бомбер и кожаная куртка', () => {
  assert.equal(parse('зелёный бомбер').category, 'бомбер');
  assert.equal(parse('кожаная куртка чёрная').category, 'кожаная куртка');
});

test('запрос без цены не подставляет 15000', () => {
  const p = parse('чёрная куртка размер M');
  assert.equal(p.budget, null);
  assert.equal(p.budget_min, null);
  assert.equal(p.budget_max, null);
});
