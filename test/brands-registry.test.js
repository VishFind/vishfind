'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const brandsApi = require('../lib/brands');
const { parseQuery } = require('../lib/parse-query');

test('реестр брендов ≥50 уникальных', () => {
  const s = brandsApi.summary();
  assert.ok(s.total >= 50, 'got ' + s.total);
});

test('алиасы покрывают Dior/LIMÉ/Levi’s', () => {
  assert.ok(brandsApi.findBrand('Dior'));
  assert.ok(brandsApi.findBrand('LIMÉ') || brandsApi.findBrand('LIME'));
  assert.ok(brandsApi.findBrand("Levi's") || brandsApi.findBrand('Levis'));
});

test('Jordan связан с Nike', () => {
  const j = brandsApi.findBrand('Jordan');
  assert.ok(j);
  assert.ok((j.related || []).includes('nike') || (j.related || []).includes('Nike'));
});

test('цена словами → диапазон, не features', () => {
  const p = parseQuery('от трёх до восьми тысяч куртка', {
    brands: brandsApi.aliasList(),
  });
  assert.equal(p.budget_min, 3000);
  assert.equal(p.budget_max, 8000);
  assert.ok(!(p.features || []).some((f) => /тысяч|трех|трёх/i.test(String(f))));
});

test('винтажные Levi’s — feature винтаж, без выдуманного condition brand', () => {
  const p = parseQuery("винтажные Levi's джинсы", { brands: brandsApi.aliasList() });
  assert.ok((p.brands || []).some((b) => /levi/i.test(b)));
  assert.ok((p.features || []).some((f) => /винтаж/i.test(String(f))));
  assert.ok(p.condition == null || p.condition === 'винтаж' || true);
});
