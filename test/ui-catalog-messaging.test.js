'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const searchJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'search.js'), 'utf8');
const siteCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'site.css'), 'utf8');

test('просроченный срез: понятный текст перед поисковыми ссылками', () => {
  assert.match(searchJs, /устаревших данных/);
  assert.match(searchJs, /не значит, что товара нет в продаже/);
  assert.match(searchJs, /Поиск на сайтах магазинов/);
  assert.match(searchJs, /function catalogUnavailableMessage/);
  assert.match(searchJs, /function appendFilterHints/);
  assert.match(searchJs, /photoVisionAvailable/);
  assert.match(searchJs, /Фото временно недоступно/);
});

test('неподтверждённая валюта в основном UI — «Уточнить цену»', () => {
  assert.match(
    searchJs,
    /mode === 'clarify' \|\| mode === 'raw_unspecified_currency'\) return 'Уточнить цену'/
  );
  assert.match(searchJs, /Без подтверждённой валюты число не показываем как обычную цену/);
  assert.match(searchJs, /if \(!code\) return 'Уточнить цену'/);
});

test('упрощённая выдача: без дубля «Изменить параметры», разбор внизу', () => {
  assert.doesNotMatch(searchJs, /el\('button', 'btn', 'Изменить параметры'\)/);
  assert.match(searchJs, /Как распознан запрос/);
  assert.match(searchJs, /Как распознано фото/);
  assert.match(searchJs, /Продолжить поиск в магазинах/);
  assert.doesNotMatch(searchJs, /Это не AI-диалог/);
  assert.match(searchJs, /function appendNeedUnderstood/);
  assert.match(searchJs, /function renderResultsToolbar/);
  assert.match(searchJs, /'Предложения'/);
});

test('вёрстка: пустая плашка с padding; товарная сетка 1/2/3 колонки', () => {
  assert.match(siteCss, /\.offers-empty\.understood\s*\{[^}]*padding:\s*18px 16px/s);
  assert.match(siteCss, /container-type:\s*inline-size/);
  assert.match(siteCss, /@container offers \(min-width: 900px\)/);
  assert.match(siteCss, /object-fit:\s*contain/);
  assert.match(siteCss, /\.offers-row\.is-real\s*\{[^}]*flex-direction:\s*column/s);
});

test('карточки: свежий HTML подключает compare-view и search с cache-bust', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(indexHtml, /js\/compare-view\.js\?v=/);
  assert.match(indexHtml, /js\/search\.js\?v=/);
  assert.match(indexHtml, /css\/site\.css\?v=/);
  const comparePos = indexHtml.indexOf('compare-view.js');
  const searchPos = indexHtml.indexOf('js/search.js');
  assert.ok(comparePos > 0 && searchPos > comparePos, 'compare-view.js должен быть до search.js');
  assert.match(searchJs, /offers-title-more/);
  assert.match(searchJs, /formatOfferPrice\(o\) \|\| 'Уточнить цену'/);
});

test('сброс фильтров не блокирует новый текстовый запрос sticky clear', () => {
  const criteriaJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'criteria-panel.js'), 'utf8');
  // После полного сброса cleared пустой — не category:true на все поля.
  assert.match(criteriaJs, /Object\.assign\(state, emptyState\(\)\);\s*state\.cleared = \{\};/);
  assert.match(searchJs, /Sticky clear без выбранных чипов не отправляем/);
  assert.match(searchJs, /if \(!hasAttr\) \{\s*return \{ attributes: undefined, attributes_priority: false, clear_attributes: \[\] \};/);
  assert.match(searchJs, /criteriaBeforePhoto/);
  assert.match(searchJs, /criteriaAfterPhoto/);
  assert.match(searchJs, /mergeAfterPhotoClear/);
});

test('история не сохраняет фото/base64 в localStorage', () => {
  assert.match(searchJs, /Фото\/base64 в localStorage не пишем/);
  assert.match(searchJs, /thumb: null/);
  assert.match(searchJs, /\.map\(\(item\) => Object\.assign\(\{\}, item, \{ thumb: null \}\)\)/);
  assert.doesNotMatch(searchJs, /makeThumb\(/);
  assert.doesNotMatch(searchJs, /imageDataUrl = item\.thumb/);
});

test('sticky clear с priority затирает phrase — клиент не должен слать clear без attrs', () => {
  const { parseQuery } = require('../lib/parse-query');
  const { mergeCriteria } = require('../lib/criteria-model');
  const parsed = parseQuery('сумка', { movies: [], brands: [] });
  assert.ok(parsed.search_phrase);
  const wiped = mergeCriteria(parsed, {}, {
    priority: true,
    clear: ['category', 'categories', 'rest', 'features', 'color', 'colors', 'size', 'sizes', 'brand', 'brands'],
  });
  assert.equal(!wiped.search_phrase, true);
});
