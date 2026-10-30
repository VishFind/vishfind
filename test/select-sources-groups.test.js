'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectSources,
  MANDATORY_TAIL_IDS,
} = require('../lib/source-registry');

function ids(sel) {
  return sel.selected.map((s) => s.id);
}

function groups(sel) {
  return sel.selected.map((s) => s.display_group);
}

test('Nike: официальный → Lamoda/Авито → Ozon/WB/ЯМ → ресейл; без LIMÉ/MAAG/Befree/Sela', () => {
  const sel = selectSources(
    { brands: ['Nike'], search_phrase: 'Nike худи', category: 'худи' },
    { maxSources: 8 }
  );
  const list = ids(sel);
  assert.ok(list.includes('nike_com'), 'nike official');
  assert.ok(list.indexOf('nike_com') < list.indexOf('ozon'), 'nike before ozon');
  for (const bad of ['lime_store', 'maag', 'befree', 'sela', 'zarina']) {
    assert.ok(!list.includes(bad), bad + ' must not sell Nike without basis');
  }
  for (const id of MANDATORY_TAIL_IDS) {
    assert.ok(list.includes(id), id + ' mandatory');
  }
  const oz = list.indexOf('ozon');
  const wb = list.indexOf('wildberries');
  const ym = list.indexOf('yandex_market');
  assert.ok(oz < wb && wb < ym, 'tail order Ozon→WB→YM');
  const g = groups(sel);
  const firstOfficial = g.indexOf('official');
  const firstOther = g.indexOf('other');
  const firstReseller = g.indexOf('reseller');
  const firstTail = g.indexOf('marketplace_tail');
  assert.ok(firstOfficial !== -1 && firstOfficial < firstTail);
  if (firstOther !== -1) {
    assert.ok(firstOther < firstTail, 'Lamoda/Avito before marketplaces');
  }
  if (firstReseller !== -1) {
    assert.ok(firstTail !== -1 && firstTail < firstReseller, 'reseller after marketplaces');
  }
  if (list.includes('lamoda_ru') && list.includes('avito')) {
    assert.ok(list.indexOf('lamoda_ru') < list.indexOf('avito'));
  }
  if (list.includes('lamoda_ru')) {
    assert.ok(list.indexOf('lamoda_ru') < oz, 'Lamoda before Ozon');
  }
});

test('Befree: официальный в группе 1, без дубля в other', () => {
  const sel = selectSources(
    { brands: ['Befree'], search_phrase: 'Befree худи' },
    { maxSources: 8 }
  );
  const befreeRows = sel.selected.filter((s) => s.id === 'befree');
  assert.equal(befreeRows.length, 1);
  assert.equal(befreeRows[0].display_group, 'official');
  assert.ok(!sel.officialExtras.some((e) => e.id === 'befree' || e.id === 'brand_official_befree'));
});

test('Sela: официальный в группе 1', () => {
  const sel = selectSources(
    { brands: ['Sela'], search_phrase: 'Sela куртка' },
    { maxSources: 8 }
  );
  const row = sel.selected.find((s) => s.id === 'sela');
  assert.ok(row, 'sela selected');
  assert.equal(row.display_group, 'official');
});

test('без бренда: own-brand не только LIMÉ/MAAG; тройка на месте', () => {
  const sel = selectSources({ search_phrase: 'чёрная куртка', category: 'куртка' }, { maxSources: 8 });
  const list = ids(sel);
  for (const id of MANDATORY_TAIL_IDS) assert.ok(list.includes(id));
  const own = sel.selected.filter((s) => s.own_brand);
  assert.ok(own.length >= 1, 'at least one own-brand');
  // Ротация/кап: не обязаны быть lime+maag всегда
  const ownIds = own.map((s) => s.id);
  assert.ok(own.every((s) => s.display_group === 'other'));
  assert.ok(
    ownIds.some((id) => id !== 'lime_store' && id !== 'maag') || ownIds.length <= 2,
    'diversity or small set'
  );
});

test('несколько брендов Nike|Adidas: оба официальных, дедуп', () => {
  const sel = selectSources(
    { brands: ['Nike', 'Adidas'], search_phrase: 'Nike или adidas кроссовки' },
    { maxSources: 8 }
  );
  const list = ids(sel);
  assert.ok(list.includes('nike_com'));
  assert.ok(list.includes('adidas_com'));
  assert.equal(list.filter((id) => id === 'nike_com').length, 1);
  for (const id of MANDATORY_TAIL_IDS) assert.ok(list.includes(id));
});

test('лимит: тройка не вытесняется; реселлеры остаются', () => {
  const sel = selectSources({ brands: ['Nike'], search_phrase: 'Nike худи' }, { maxSources: 8 });
  const list = ids(sel);
  assert.ok(list.includes('ozon') && list.includes('wildberries') && list.includes('yandex_market'));
  assert.ok(
    list.some((id) =>
      ['brandshop', 'peak_concept', 'spin4spin', 'ebay'].includes(id)
    ),
    'reseller remains'
  );
  assert.ok(!list.includes('tsum_collect') && !list.includes('tsum_ru'));
  assert.ok(list.length > 8, 'optional + mandatory can exceed 8');
});

test('исключённый CULTT не возвращается', () => {
  const sel = selectSources({ search_phrase: 'сумка Dior', brands: ['Dior'] }, { maxSources: 20 });
  assert.ok(!ids(sel).includes('the_cultt'));
  assert.ok(!(sel.officialExtras || []).some((e) => e.id === 'the_cultt'));
});

test('неизвестный бренд: не подставлять LIMÉ/MAAG', () => {
  const sel = selectSources(
    { search_phrase: 'UnknownBrandxyz худи', rest: 'UnknownBrandxyz' },
    { maxSources: 8 }
  );
  assert.equal(sel.unknownBrandIntent, true);
  const list = ids(sel);
  assert.ok(!list.includes('lime_store'));
  assert.ok(!list.includes('maag'));
  assert.ok(!list.includes('befree'));
  for (const id of MANDATORY_TAIL_IDS) assert.ok(list.includes(id));
});

test('каталог: минимум 10 активных own-brand', () => {
  const { registrySummary } = require('../lib/source-registry');
  const s = registrySummary();
  assert.ok(s.own_brand_active >= 10, 'own_brand_active=' + s.own_brand_active);
});
