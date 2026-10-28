'use strict';

/**
 * Локальный отчёт совместимости площадок.
 * Без сети и без браузера.
 *
 * Запуск: node scripts/marketplace-report.js
 *         npm run marketplace-report
 */

const { buildReport, loadFixtures } = require('../lib/marketplace-capabilities');
const { search: linksSearch } = require('../providers/links');
const sources = require('../data/sources.json');

async function runFixtures() {
  const { fixtures } = loadFixtures();
  const results = [];
  for (const f of fixtures || []) {
    const src = sources.find((s) => s.id === f.source_id);
    if (!src) {
      results.push({ id: f.id, ok: false, error: 'source missing' });
      continue;
    }
    const out = await linksSearch({ parsed: f.input || {}, sources: [src] });
    const item = out.items[0] || {};
    const url = String(item.url || '');
    const fails = [];
    for (const part of f.expect_url_includes || []) {
      if (!url.includes(part)) fails.push('missing ' + part);
    }
    for (const part of f.expect_url_excludes || []) {
      if (url.includes(part)) fails.push('unexpected ' + part);
    }
    for (const a of f.expect_applied || []) {
      if (!(item.applied_filters || []).includes(a)) fails.push('not applied ' + a);
    }
    results.push({
      id: f.id,
      ok: fails.length === 0,
      fails,
      url: url.slice(0, 120),
      browser_effect: f.browser_effect || null,
      verified_how: f.verified_how || null,
    });
  }
  return results;
}

async function main() {
  const report = buildReport();
  const fixtureResults = await runFixtures();
  const failed = fixtureResults.filter((r) => !r.ok);

  console.log('VishFind marketplace report');
  console.log('generated_at:', report.generated_at);
  console.log('sources:', report.sources.length, '| fixtures:', report.fixture_count);
  console.log('');
  for (const s of report.sources) {
    const priceMin = s.criteria.price_min;
    const priceMax = s.criteria.price_max;
    console.log(
      [
        s.shown_to_user ? '[on]' : '[off]',
        s.id.padEnd(14),
        'min=' + priceMin.transfer + '/' + priceMin.implemented,
        'max=' + priceMax.transfer + '/' + priceMax.implemented,
        'size=' + s.criteria.size.transfer,
        s.disabled_filters.length ? 'disabled:' + s.disabled_filters.join(',') : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
  console.log('');
  const srcOn = report.sources.filter((s) => s.shown_to_user);
  const nativePrice = srcOn.filter(
    (s) =>
      s.criteria.price_min.transfer === 'native_filter'
      || s.criteria.price_max.transfer === 'native_filter'
  );
  const manualPrice = srcOn.filter(
    (s) =>
      s.criteria.price_min.transfer === 'manual'
      || s.criteria.price_max.transfer === 'manual'
  );
  const unconfirmedPrice = srcOn.filter(
    (s) =>
      s.criteria.price_min.transfer === 'unconfirmed'
      || s.criteria.price_max.transfer === 'unconfirmed'
  );

  console.log(
    'fixture generation checks:',
    fixtureResults.length - failed.length,
    'ok,',
    failed.length,
    'fail'
  );
  for (const r of fixtureResults) {
    console.log(
      (r.ok ? '  OK ' : '  FAIL ')
        + r.id
        + (r.fails && r.fails.length ? ' · ' + r.fails.join('; ') : '')
        + (r.verified_how ? ' [' + r.verified_how + ']' : '')
    );
  }
  console.log('');
  console.log(
    'Конфигурация согласована: '
      + srcOn.length
      + '/'
      + report.sources.length
      + ' в выдаче.'
  );
  console.log(
    'Внешне подтверждены (native_filter цена): '
      + (nativePrice.map((s) => s.id).join(', ') || '—')
  );
  console.log(
    'Ручное применение цены: '
      + (manualPrice.map((s) => s.id).join(', ') || '—')
  );
  console.log(
    'Не подтверждены (цена): '
      + (unconfirmedPrice.map((s) => s.id).join(', ') || '—')
  );
  if (report.issues.length) {
    console.log('');
    console.log('issues:');
    for (const i of report.issues) {
      console.log(' -', i.id + ':', i.message);
    }
  }
  console.log('');
  console.log('No external HTTP requests were made. Internal generation ≠ browser confirmation.');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
