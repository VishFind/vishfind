'use strict';

/**
 * Прогон корпуса data/query-corpus.json.
 * По умолчанию — все группы; NODE_CORPUS_GROUPS=short,budget — выборочно.
 * Не входит в npm test.
 */

const assert = require('node:assert/strict');
const { parseQuery } = require('../lib/parse-query');
const brands = require('../data/brands.json');
const movies = require('../movies.json');
const corpus = require('../data/query-corpus.json');

const only = (process.env.NODE_CORPUS_GROUPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let pass = 0;
let fail = 0;
const failures = [];

function check(entry) {
  const p = parseQuery(entry.q, { brands, movies });
  const e = entry.expect || {};
  if (e.category != null) assert.equal(p.category, e.category);
  if (e.color != null) assert.equal(p.color, e.color);
  if (e.size != null) assert.equal(p.size, e.size);
  if (e.brand !== undefined) assert.equal(p.brand, e.brand);
  if (e.budget_min !== undefined) assert.equal(p.budget_min, e.budget_min);
  if (e.budget_max !== undefined) assert.equal(p.budget_max, e.budget_max);
  if (e.colors) {
    assert.deepEqual([...(p.colors || [])].sort(), [...e.colors].sort());
  }
  if (e.sizes) {
    assert.deepEqual([...(p.sizes || [])].sort(), [...e.sizes].sort());
  }
  if (e.brands_include) {
    for (const b of e.brands_include) assert.ok((p.brands || []).includes(b), 'brand ' + b);
  }
  if (e.categories_include) {
    for (const c of e.categories_include) assert.ok((p.categories || []).includes(c), 'cat ' + c);
  }
  if (e.category_one_of) {
    assert.ok(e.category_one_of.includes(p.category), 'category_one_of');
  }
  if (e.features_include) {
    for (const f of e.features_include) assert.ok((p.features || []).includes(f), 'feat ' + f);
  }
  if (e.rest_includes) {
    assert.match(String(p.rest || p.search_phrase || ''), new RegExp(e.rest_includes, 'i'));
  }
  if (e.has_warning) {
    assert.ok((p.warnings || []).length >= 1, 'expected warning');
  }
}

const groups = corpus.groups || {};
for (const [name, items] of Object.entries(groups)) {
  if (only.length && !only.includes(name)) continue;
  for (const entry of items) {
    try {
      check(entry);
      pass += 1;
    } catch (err) {
      fail += 1;
      failures.push({ group: name, q: entry.q, error: err.message });
    }
  }
}

console.log('query-corpus: pass=%d fail=%d groups=%s', pass, fail, only.length ? only.join(',') : 'all');
for (const f of failures) {
  console.log(' FAIL [%s] %s — %s', f.group, f.q, f.error);
}
process.exit(fail ? 1 : 0);
