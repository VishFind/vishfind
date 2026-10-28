'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('кнопка «Новый запрос» в разметке (вне search-actions)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="btn-new-query"/);
  assert.match(html, /Новый запрос/);
  assert.match(html, /type="button"[^>]*id="btn-new-query"|id="btn-new-query"[^>]*type="button"/);
  const actions = html.match(/class="search-actions"[\s\S]*?<\/div>/);
  assert.ok(actions);
  assert.doesNotMatch(actions[0], /btn-new-query/);
});

test('resetCurrentSearch: отмена seq, очистка критериев, без reload', () => {
  const js = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');
  assert.match(js, /function resetCurrentSearch/);
  assert.match(js, /searchSeq\s*\+=\s*1/);
  assert.match(js, /activeAbort\.abort\('reset'\)/);
  assert.match(js, /Criteria\.emptyState\(\)/);
  assert.match(js, /clearPhoto\(\)/);
  assert.match(js, /resultsSection\.hidden\s*=\s*true/);
  assert.match(js, /searchParams\.delete\(k\)/);
  assert.match(js, /\['q',\s*'query'/);
  assert.doesNotMatch(js, /location\.reload\(/);
  assert.match(js, /newQueryBtn\.addEventListener\('click'/);
});

test('клиент использует display_group сервера, не старые RU маркетплейсы', () => {
  const js = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');
  assert.match(js, /display_group_label/);
  assert.match(js, /Маркетплейсы/);
  assert.match(js, /Реселлеры и ресейл/);
  assert.doesNotMatch(js, /Российские маркетплейсы/);
});
