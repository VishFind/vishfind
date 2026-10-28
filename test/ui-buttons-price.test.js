'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');

test('Фото в search-actions; Новый запрос вне строки поиска', () => {
  const actionsMatch = html.match(/class="search-actions"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(actionsMatch, 'search-actions block');
  const actions = actionsMatch[0];
  assert.match(actions, /id="btn-photo"/);
  assert.match(actions, /id="btn-submit"/);
  assert.doesNotMatch(actions, /id="btn-new-query"/);
  assert.match(html, /id="btn-new-query"/);
  assert.match(html, /id="file-input"/);
  assert.equal((html.match(/id="file-input"/g) || []).length, 1);
});

test('Новый запрос: скрыт до поиска, монтируется после ссылок, сброс скрывает', () => {
  assert.match(html, /id="new-query-row"[^>]*hidden|hidden[^>]*id="new-query-row"/);
  assert.match(js, /resultsBody\.appendChild\(newQueryRow\)/);
  assert.match(js, /setNewQueryVisible\(false\)/);
  assert.match(js, /setNewQueryVisible\(true\)/);
  assert.match(js, /function resetCurrentSearch/);
  assert.doesNotMatch(js, /localStorage\.clear\(/);
  assert.doesNotMatch(js, /location\.reload\(/);
});
