'use strict';

/**
 * Временная HTTP Basic Auth на всё приложение.
 * Текстовый поиск без фото. Платные провайдеры отключены пустыми ключами.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const USER = 'vf-tester';
const PASS = 'canary-closed-test-9f3a';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
}

function childEnv(port, extra) {
  return {
    ...process.env,
    PORT: String(port || 0),
    HOST: '127.0.0.1',
    AI_ENABLED: 'false',
    PHOTO_PROVIDER: 'ollama',
    WEB_SEARCH_ENABLED: 'false',
    OLLAMA_WEB_FETCH: 'false',
    TAVILY_API_KEY: '',
    OLLAMA_API_KEY: '',
    EBAY_CLIENT_ID: '',
    EBAY_CLIENT_SECRET: '',
    TIMEWEB_AI_API_KEY: '',
    BASIC_AUTH_ENABLED: 'false',
    BASIC_AUTH_USER: '',
    BASIC_AUTH_PASSWORD: '',
    ...extra,
  };
}

async function waitHealth(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (r.ok) return;
    } catch (_) {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server not ready');
}

async function withServer(extra, fn) {
  const port = await freePort();
  const chunks = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: childEnv(port, extra),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  try {
    await waitHealth(port);
    return await fn(port);
  } finally {
    child.kill();
    const out = Buffer.concat(chunks).toString('utf8');
    assert.equal(out.includes(PASS), false);
    if (extra && extra.BASIC_AUTH_PASSWORD && extra.BASIC_AUTH_PASSWORD !== PASS) {
      assert.equal(out.includes(extra.BASIC_AUTH_PASSWORD), false);
    }
  }
}

function fetchPath(port, method, pathname, headers, body) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body,
  });
}

function postWithoutBody(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(8 * 1024 * 1024),
        },
      },
      (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(parts).toString('utf8'),
            www: res.headers['www-authenticate'] || '',
          });
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('сервер ждал тело запроса'));
    }, 1500);
    req.on('response', () => clearTimeout(timer));
    req.on('error', (e) => {
      if (e.code === 'ECONNRESET') return;
      clearTimeout(timer);
      reject(e);
    });
    req.flushHeaders();
  });
}

test('без учётных данных страницы и API закрыты, healthz минимальный', async () => {
  await withServer({ BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: USER, BASIC_AUTH_PASSWORD: PASS }, async (port) => {
    const closed = [
      ['GET', '/'],
      ['GET', '/about.html'],
      ['GET', '/css/site.css'],
      ['GET', '/js/search.js'],
      ['GET', '/images/favicon.svg'],
      ['GET', '/api/health'],
      ['POST', '/api/search'],
      ['POST', '/api/find'],
    ];
    for (const [method, pathname] of closed) {
      const r = await fetchPath(
        port,
        method,
        pathname,
        { 'Content-Type': 'application/json' },
        method === 'POST' ? JSON.stringify({ query: 'куртка', image: 'abc' }) : undefined
      );
      assert.equal(r.status, 401, pathname);
      const www = r.headers.get('www-authenticate') || '';
      assert.match(www, /Basic/i);
      const text = await r.text();
      assert.equal(text.includes(PASS), false);
      assert.equal(text.includes('photo_provider'), false);
      assert.equal(text.includes('ebay'), false);
      assert.equal(text.includes('TIMEWEB'), false);
    }

    const early = await postWithoutBody(port, '/api/search');
    assert.equal(early.status, 401);
    assert.equal(early.body.includes(PASS), false);

    const health = await fetchPath(port, 'GET', '/api/healthz');
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.deepEqual(body, { ok: true });
  });
});

test('неверные данные отклоняются, верные открывают страницы, статику и API', async () => {
  await withServer({ BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: USER, BASIC_AUTH_PASSWORD: PASS }, async (port) => {
    const badCases = [
      basic('vf-tester', 'wrong-pass'),
      basic('other', PASS),
      'Bearer ' + PASS,
    ];
    for (const authorization of badCases) {
      const r = await fetchPath(port, 'GET', '/', { authorization });
      assert.equal(r.status, 401);
      await r.arrayBuffer();
    }

    const authorization = basic(USER, PASS);
    const page = await fetchPath(port, 'GET', '/', { authorization });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    await page.arrayBuffer();

    const script = await fetchPath(port, 'GET', '/js/search.js', { authorization });
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') || '', /javascript/);
    await script.arrayBuffer();

    const svg = await fetchPath(port, 'GET', '/images/favicon.svg', { authorization });
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type') || '', /image\/svg/);
    await svg.arrayBuffer();

    const search = await fetchPath(
      port,
      'POST',
      '/api/search',
      { authorization, 'Content-Type': 'application/json' },
      JSON.stringify({ query: 'куртка' })
    );
    assert.equal(search.status, 200);
    await search.json();

    const find = await fetchPath(
      port,
      'POST',
      '/api/find',
      { authorization, 'Content-Type': 'application/json' },
      JSON.stringify({ query: 'куртка' })
    );
    assert.equal(find.status, 503);
    await find.json();

    const detailed = await fetchPath(port, 'GET', '/api/health', { authorization });
    assert.equal(detailed.status, 200);
    const healthBody = await detailed.json();
    assert.equal(healthBody.ok, true);
    assert.equal(typeof healthBody.ai_enabled, 'boolean');
  });
});

test('при выключенной защите пароль в env не требуется', async () => {
  await withServer(
    { BASIC_AUTH_ENABLED: 'false', BASIC_AUTH_USER: USER, BASIC_AUTH_PASSWORD: PASS },
    async (port) => {
      const page = await fetchPath(port, 'GET', '/');
      assert.equal(page.status, 200);
      await page.arrayBuffer();
      const search = await fetchPath(
        port,
        'POST',
        '/api/search',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ query: 'куртка' })
      );
      assert.equal(search.status, 200);
      await search.json();
      const health = await fetchPath(port, 'GET', '/api/health');
      assert.equal(health.status, 200);
      const body = await health.json();
      assert.equal(body.ok, true);
      assert.equal(typeof body.ai_enabled, 'boolean');
    }
  );
});

test('пустые настройки при включённой защите не открывают сервер', async () => {
  const cases = [
    { BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: '', BASIC_AUTH_PASSWORD: '' },
    { BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: USER, BASIC_AUTH_PASSWORD: '   ' },
    { BASIC_AUTH_ENABLED: 'true', BASIC_AUTH_USER: '', BASIC_AUTH_PASSWORD: PASS },
  ];
  for (const extra of cases) {
    const port = await freePort();
    const chunks = [];
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: childEnv(port, extra),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: 'timeout' });
      }, 4000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
    });
    const out = Buffer.concat(chunks).toString('utf8');
    assert.equal(result.code, 1);
    assert.equal(out.includes(PASS), false);
    let opened = false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      opened = r.status === 200;
      await r.arrayBuffer();
    } catch (_) {
      opened = false;
    }
    assert.equal(opened, false);
  }
});
