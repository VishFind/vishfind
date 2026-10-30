'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectSources, adaptersForSelection, registrySummary } = require('../lib/source-registry');
const sources = require('../data/sources.json');

test('реестр: есть десятки кандидатов', () => {
  const s = registrySummary();
  assert.ok(s.total >= 20, 'expected >=20 sources, got ' + s.total);
  assert.ok(s.active_search_link >= 1);
});

test('бренд Nike → официальный Nike раньше масс-маркетплейсов', () => {
  const sel = selectSources({ brands: ['Nike'], search_phrase: 'Nike худи' }, { maxSources: 8 });
  const ids = sel.selected.map((s) => s.id);
  const nikeIdx = ids.indexOf('nike_com');
  const ozonIdx = ids.indexOf('ozon');
  assert.ok(nikeIdx !== -1, 'nike selected');
  if (ozonIdx !== -1) assert.ok(nikeIdx < ozonIdx, 'nike before ozon');
  assert.ok(!ids.includes('adidas_com'), 'adidas not selected for Nike query');
});

test('без бренда → RU реселлеры/площадки, не только китайские', () => {
  const sel = selectSources({ search_phrase: 'чёрная куртка' }, { maxSources: 8 });
  assert.ok(sel.selected.length >= 1);
  const types = sel.selected.map((s) => s.type);
  assert.ok(types.includes('reseller') || types.includes('mass_marketplace') || types.includes('classifieds'));
});

test('adaptersForSelection даёт search_link для links', () => {
  const sel = selectSources({ brands: ['Zara'], search_phrase: 'Zara платье' }, { maxSources: 6 });
  const adapters = adaptersForSelection(sel.selected, sources);
  assert.ok(adapters.some((a) => a.id === 'zara' || a.registry_id === 'zara_official'));
  assert.ok(adapters.every((a) => a.result_kind === 'search_link'));
});

test('непроверенный реселлер-кандидат не в активной выдаче', () => {
  const sel = selectSources({ search_phrase: 'куртка' }, { maxSources: 20 });
  assert.ok(!sel.selected.some((s) => s.id === 'farfetch'));
  assert.ok(!sel.selected.some((s) => s.connection_status === 'candidate'));
});

test('Nike включает RU реселлеров Brandshop/Peak', () => {
  const sel = selectSources({ brands: ['Nike'], search_phrase: 'Nike худи' }, { maxSources: 8 });
  const ids = sel.selected.map((s) => s.id);
  assert.ok(ids.includes('brandshop') || ids.includes('peak_concept'));
});

test('Dior/AMIRI — официальный ориентир + не только масс-маркет', () => {
  for (const brand of ['Dior', 'AMIRI', 'Rick Owens']) {
    const sel = selectSources({ brands: [brand], search_phrase: brand + ' вещь' }, { maxSources: 8 });
    const ids = sel.selected.map((s) => s.id);
    const off = (sel.officialExtras || []).map((s) => s.id);
    const hasOfficial =
      ids.some((id) => id.includes('official') || id.startsWith('brand_'))
      || off.some((id) => /dior|amiri|rick|louis|brand_official/i.test(id))
      || (sel.officialExtras || []).some((s) => /dior|amiri|rick|louis/i.test(s.domain || ''));
    assert.ok(hasOfficial, brand + ' needs official entry');
    assert.ok(
      ids.some((id) =>
        ['brandshop', 'peak_concept', 'spin4spin', 'lamoda_ru'].includes(id)
      ),
      brand + ' needs trusted RU seller path'
    );
    assert.ok(!ids.includes('the_cultt'), 'CULTT не в активной выдаче без разрешения');
    assert.ok(!ids.includes('tsum_collect') && !ids.includes('tsum_ru'), 'TSUM исключён продуктово');
    assert.ok(!ids.includes('ozon') || ids.indexOf('ozon') > 0, brand + ' ozon not first');
    if (ids.includes('lamoda_ru') && ids.includes('ozon')) {
      assert.ok(ids.indexOf('lamoda_ru') < ids.indexOf('ozon'), brand + ' Lamoda before Ozon');
    }
  }
});

test('LIMÉ и MAAG выбираются по собственному бренду', () => {
  const lime = selectSources({ brands: ['LIMÉ'], search_phrase: 'LIMÉ платье' }, { maxSources: 8 });
  assert.ok(lime.selected.some((s) => s.id === 'lime_store'));
  const maag = selectSources({ brands: ['MAAG'], search_phrase: 'MAAG футболка' }, { maxSources: 8 });
  assert.ok(maag.selected.some((s) => s.id === 'maag'));
});

test('временно ограниченные OSKELLY/Luxxy/CULTT/TSUM не в активной выдаче', () => {
  const sel = selectSources({ search_phrase: 'сумка' }, { maxSources: 20 });
  assert.ok(!sel.selected.some((s) => s.id === 'oskelly'));
  assert.ok(!sel.selected.some((s) => s.id === 'luxxy'));
  assert.ok(!sel.selected.some((s) => s.id === 'the_cultt'));
  assert.ok(!sel.selected.some((s) => s.id === 'tsum_collect'));
  assert.ok(!sel.selected.some((s) => s.id === 'tsum_ru'));
});

test('политика: HTML product только documented_allowed', () => {
  const policy = require('../lib/source-policy');
  assert.equal(policy.htmlProductFetchAllowed(policy.findById('the_cultt')), false);
  assert.equal(policy.htmlProductFetchAllowed(policy.findById('tsum_collect')), false);
  assert.equal(policy.outboundLinkAllowed(policy.findById('the_cultt')), false);
  assert.equal(policy.outboundLinkAllowed(policy.findById('tsum_collect')), false);
  assert.equal(policy.outboundLinkAllowed(policy.findById('tsum_ru')), false);
});
