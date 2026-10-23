'use strict';

/**
 * Юнит-тест приоритета признаков: явный цвет из текста важнее цвета из анализа фото.
 *
 * Запуск (без установки зависимостей, встроенный node:test, Node >= 18.1):
 *   node --test test/color-priority.test.js
 *
 * Проверяемая логика (server.js):
 *   - mergeVisionIntoParsed(parsed, analysis) → applyAttributes(): фото-признаки
 *     заполняют ТОЛЬКО пустые поля текстового разбора (out.color == null и т.п.).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// require не поднимает сервер: listen() защищён require.main === module.
const { mergeVisionIntoParsed } = require('../server.js');

/** parsed в форме, которую возвращают parseQuery/emptyParsed. */
function parsedWith(overrides) {
  return {
    budget: null,
    size: null,
    color: null,
    category: null,
    brand: null,
    movie: null,
    rest: null,
    search_phrase: null,
    raw_query: '',
    ...overrides,
  };
}

/** Полный «ответ» фотоанализа (схема PHOTO_FORMAT + служебные поля). */
function photoAnalysis(overrides) {
  return {
    garment_type: 'jacket',
    subtype: 'bomber',
    color_primary: 'красный',
    color_extra: ['синий'],
    material: 'кожа',
    pattern: null,
    collar: null,
    closure: null,
    pockets: null,
    length: null,
    fit: null,
    hardware_and_details: null,
    era_or_style: null,
    visible_text: [],
    brand: null,
    model_name: null,
    description: 'красная куртка-бомбер',
    ...overrides,
  };
}

test('цвет из текста важнее цвета из анализа фото', () => {
  const parsed = parsedWith({ color: 'чёрный', category: 'куртка' });
  const out = mergeVisionIntoParsed(parsed, photoAnalysis({ color_primary: 'красный' }));

  assert.equal(out.color, 'чёрный');
  // цвет/доп. цвета фото не должны примешиваться к текстовому цвету
  assert.ok(!out.color.includes('красный'));
  assert.ok(!out.color.includes('синий'));
  // категория (тоже из текста) не перезатирается фото
  assert.equal(out.category, 'куртка');
});

test('фото заполняет цвет, если в тексте его нет', () => {
  const parsed = parsedWith({ category: 'куртка' });
  const out = mergeVisionIntoParsed(parsed, photoAnalysis({ color_primary: 'красный' }));

  assert.equal(out.color, 'красный, синий');
});

test('грязный цвет фото ("не указано") не попадает в результат при пустом тексте', () => {
  const parsed = parsedWith({});
  const out = mergeVisionIntoParsed(parsed, photoAnalysis({ color_primary: 'не указано', color_extra: [] }));

  assert.equal(out.color, null);
});

test('после слияния остальные поля сохраняются и search_phrase собирается из текста', () => {
  const parsed = parsedWith({ color: 'чёрный', category: 'куртка', rest: 'винтаж' });
  const out = mergeVisionIntoParsed(parsed, photoAnalysis({ color_primary: 'красный', material: 'кожа' }));

  assert.equal(out.category, 'куртка');
  assert.equal(out.rest, 'винтаж');
  assert.ok(out.search_phrase && out.search_phrase.includes('чёрный'));
  assert.ok(out.search_phrase.includes('куртка'));
  assert.ok(out.search_phrase.includes('винтаж'));
});