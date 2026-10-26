'use strict';

/**
 * Проверка production-режима VishFind (временный/вспомогательный скрипт).
 *
 * Поднимает server.js с NODE_ENV=production и проверяет:
 *  - /api/health (поля, отсутствие секретов, без внешних вызовов);
 *  - POST /api/search (200, offers, sources);
 *  - /.env → 403;
 *  - rate limit: 20 запросов с одного XFF-IP, другой IP проходит, 429 + Retry-After;
 *  - лимит тела 64 КБ → 413;
 *  - кнопка «Фото» скрыта при AI_ENABLED=false;
 *  - логи — валидный JSON без секретов.
 *
 * Запуск: node scripts/verify-prod.js
 * Выход: 0 — все проверки прошли, 1 — есть падения.
 */

const { spawn } = require('child_process');

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, ['server.js'], {
  cwd: require('path').join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    AI_ENABLED: 'false',
    TRUST_PROXY: 'true',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch (_) { /* ещё стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const ready = await waitReady();
  record('сервер поднялся в production', ready);
  if (!ready) return finish(1);

  // --- health ---
  const h = await (await fetch(BASE + '/api/health')).json();
  record(
    'health: ok, env=production, ai_enabled=false',
    h.ok === true && h.env === 'production' && h.ai_enabled === false,
    `env=${h.env} ai=${h.ai_enabled} name=${h.name} version=${h.version}`
  );
  record(
    'health: ebay-статус без секретов',
    h.ebay && typeof h.ebay.configured === 'boolean' && !JSON.stringify(h).includes('client_secret') && !JSON.stringify(h).includes('access_token')
  );

  // --- search ---
  const s = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'чёрная куртка' }),
  });
  const sj = await s.json();
  record('search: 200', s.status === 200, `status=${s.status}`);
  record('search: offers (is_demo) и sources', Array.isArray(sj.offers && sj.offers.items) && sj.offers.is_demo === true && Array.isArray(sj.sources) && sj.sources.length > 0, `offers=${sj.offers && sj.offers.items.length} sources=${sj.sources.length}`);

  // --- /.env → 403 ---
  const envRes = await fetch(BASE + '/.env');
  record('dotenv: 403', envRes.status === 403, `status=${envRes.status}`);

  // --- rate limit (TRUST_PROXY=true, ключ = XFF) ---
  const codes = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await fetch(BASE + '/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9' },
      body: JSON.stringify({ query: 'куртка' }),
    });
    codes.push(r.status);
  }
  record('rate limit: 20 запросов с одного IP проходят', codes.every((c) => c === 200), codes.join(','));

  const other = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '8.8.8.8' },
    body: JSON.stringify({ query: 'куртка' }),
  });
  record('rate limit: другой IP проходит', other.status === 200, `status=${other.status}`);

  const limited = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9' },
    body: JSON.stringify({ query: 'куртка' }),
  });
  const retryAfter = limited.headers.get('retry-after');
  record('rate limit: 429 + Retry-After', limited.status === 429 && retryAfter != null, `status=${limited.status} retry-after=${retryAfter}`);

  // --- лимит тела 64 КБ → 413 ---
  const big = JSON.stringify({ query: 'a'.repeat(70000) });
  const bigRes = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: big,
  });
  record('body limit: 70 КБ → 413', bigRes.status === 413, `status=${bigRes.status}`);

  // --- кнопка «Фото» скрыта при AI_ENABLED=false ---
  const html = await (await fetch(BASE + '/')).text();
  record('кнопка «Фото» скрыта', /id="btn-photo"[^>]*\bhidden\b/.test(html));

  // --- логи: валидный JSON, без секретов ---
  const lines = serverLog.split('\n').filter(Boolean);
  const allJson = lines.every((l) => {
    try { JSON.parse(l); return true; } catch (_) { return false; }
  });
  record('логи: валидный JSON', allJson, `строк=${lines.length}`);
  record('логи: без секретов', !serverLog.includes('client_secret') && !serverLog.includes('access_token'));

  return finish(results.every((r) => r.ok) ? 0 : 1);
}

function finish(code) {
  child.kill();
  setTimeout(() => process.exit(code), 150);
}

main().catch((e) => {
  console.error('verify-prod: непойманная ошибка', e);
  finish(1);
});