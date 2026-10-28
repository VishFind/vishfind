'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/source-policy');
const ollamaWeb = require('../lib/ollama-web');
const { selectSources, adaptersForSelection } = require('../lib/source-registry');
const sources = require('../data/sources.json');

test('CULTT домен и поддомен — outbound restricted', () => {
  assert.equal(policy.isOutboundRestrictedHost('thecultt.com'), true);
  assert.equal(policy.isOutboundRestrictedHost('www.thecultt.com'), true);
  assert.equal(policy.isOutboundRestrictedHost('cdn.thecultt.com'), true);
  assert.equal(policy.isOutboundRestrictedHost('nike.com'), false);
  assert.equal(
    policy.hostMatchesDomain('shop.thecultt.com', 'thecultt.com'),
    true
  );
  assert.equal(
    policy.hostMatchesDomain('notthecultt.com', 'thecultt.com'),
    false
  );
});

test('filterWebSearchResults отбрасывает CULTT и вне allowlist', () => {
  const raw = [
    { url: 'https://www.nike.com/w?q=1', title: 'Nike', content: 'secret copy' },
    { url: 'https://thecultt.com/product/1', title: 'Cultt', content: 'bag' },
    { url: 'https://evil.example/x', title: 'X', content: 'y' },
  ];
  const out = policy.filterWebSearchResults(raw, {
    allowedDomains: ['www.nike.com'],
  });
  assert.equal(out.length, 1);
  assert.match(out[0].url, /nike\.com/);
});

test('нет совпадений allowlist → пусто, без raw fallback', () => {
  const raw = [
    { url: 'https://random.example/a', title: 'A', content: 'b' },
    { url: 'https://thecultt.com/', title: 'C', content: 'd' },
  ];
  const out = policy.filterWebSearchResults(raw, {
    allowedDomains: ['www.nike.com'],
  });
  assert.equal(out.length, 0);
});

test('webFetch: неизвестный домен запрещён; CULTT запрещён', () => {
  assert.equal(
    policy.webFetchAllowedForUrl('https://unknown-shop.example/item'),
    false
  );
  assert.equal(
    policy.webFetchAllowedForUrl('https://thecultt.com/product/1'),
    false
  );
  assert.equal(
    policy.webFetchAllowedForUrl('https://collect.tsum.ru/item/1'),
    false
  );
});

test('CULTT не в selectSources и не в adapters', () => {
  const sel = selectSources({ search_phrase: 'сумка' }, { maxSources: 20 });
  assert.ok(!sel.selected.some((s) => s.id === 'the_cultt'));
  const adapters = adaptersForSelection(sel.selected, sources);
  assert.ok(!adapters.some((a) => a.id === 'the_cultt' || a.registry_id === 'the_cultt'));
});

test('applySearchResultPolicy на «кэше» повторно режет CULTT', () => {
  const cachedLike = [
    { url: 'https://www.adidas.com/search', title: 'A', content: 'x' },
    { url: 'https://www.thecultt.com/p/1', title: 'B', content: 'y' },
  ];
  const out = ollamaWeb.applySearchResultPolicy(cachedLike, [
    'www.adidas.com',
    'www.thecultt.com',
  ]);
  assert.equal(out.length, 1);
  assert.match(out[0].url, /adidas/);
});

/**
 * Изолированный child: флаги web не зависят от окружения npm test / .env хоста.
 * После выхода процесса настройки хоста не меняются.
 */
function runEnrichIsolated(envExtra) {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const code = `
    'use strict';
    let fetchCalls = 0;
    global.fetch = async function () {
      fetchCalls += 1;
      throw new Error('unexpected network call in test');
    };
    const ollamaWeb = require(${JSON.stringify(require.resolve('../lib/ollama-web'))});
    ollamaWeb.enrichBrandSearch(
      { brand: 'Nike', search_phrase: 'Nike худи' },
      []
    ).then((res) => {
      process.stdout.write(JSON.stringify({
        used: res.used,
        reason: res.reason,
        items: (res.items || []).length,
        fetchCalls,
        enabled: ollamaWeb.isEnabled(),
      }));
    }).catch((e) => {
      process.stderr.write(String(e && e.stack || e));
      process.exit(2);
    });
  `;
  const r = spawnSync(process.execPath, ['-e', code], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      // Явно для сценария; не трогаем рабочий сервер :3103.
      OLLAMA_WEB_FETCH: 'false',
      ...envExtra,
    },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error('isolated enrich failed: ' + (r.stderr || r.stdout || r.status));
  }
  return JSON.parse(r.stdout);
}

test('web выключен: enrichBrandSearch → disabled, без сети', () => {
  const out = runEnrichIsolated({
    WEB_SEARCH_ENABLED: 'false',
    OLLAMA_API_KEY: 'dummy-key-for-config-only',
  });
  assert.equal(out.enabled, false);
  assert.equal(out.used, false);
  assert.equal(out.reason, 'disabled');
  assert.equal(out.items, 0);
  assert.equal(out.fetchCalls, 0);
});

test('web включён, allowlist пуст: no_allowed_domains, без сети', () => {
  const out = runEnrichIsolated({
    WEB_SEARCH_ENABLED: 'true',
    OLLAMA_API_KEY: 'dummy-key-for-config-only',
  });
  assert.equal(out.enabled, true);
  assert.equal(out.used, true);
  assert.equal(out.reason, 'no_allowed_domains');
  assert.equal(out.items, 0);
  assert.equal(out.fetchCalls, 0);
});
