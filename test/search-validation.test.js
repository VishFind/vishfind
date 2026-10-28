'use strict';

/**
 * Валидация POST /api/search: типы, длина, пустота.
 * Без реальной Ollama и платных API (WEB_SEARCH off; mock только где нужно).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  MAX_QUERY_LEN,
  validateSearchBody,
  attributesHaveContent,
} = require('../lib/search-request');

const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EAD0QAAIBAgQDBgQFAwQDAAAAAAECAxEABAUSITFBUQYTImFxMoGhFCNCkbHB0fAVUmLh8RYjcv/aAAwDAQACEQMRAD8A9oFFFFABRRRQAUUUUAFFFFABRRRQB//Z';

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

async function waitHealth(port, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch (_) {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('server not ready');
}

async function withServer(fn, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'false',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
      RATE_LIMIT_MAX: '500',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    return await fn(port);
  } finally {
    child.kill();
  }
}

async function postSearch(port, body, { raw } = {}) {
  const payload = raw != null ? raw : JSON.stringify(body);
  const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  let data = null;
  try {
    data = await r.json();
  } catch (_) {
    data = null;
  }
  return { status: r.status, data };
}

// --- unit: validateSearchBody ---

test('unit: пустой и пробелы → empty_query', () => {
  assert.equal(validateSearchBody({}, { aiEnabled: false }).error_kind, 'empty_query');
  assert.equal(validateSearchBody({ query: '   ' }, { aiEnabled: false }).error_kind, 'empty_query');
  assert.equal(validateSearchBody({ query: '', attributes: {} }, { aiEnabled: false }).error_kind, 'empty_query');
});

test('unit: только валидные критерии → ok', () => {
  const r = validateSearchBody(
    { attributes: { category: 'куртка' }, attributes_priority: true },
    { aiEnabled: false }
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.query, '');
  assert.ok(attributesHaveContent(r.value.attrs));
});

test('unit: только image → ok (тип)', () => {
  const r = validateSearchBody({ image: TINY_JPEG_B64 }, { aiEnabled: true });
  assert.equal(r.ok, true);
  assert.ok(r.value.image.length > 0);
});

test('unit: длина на границе и сверх лимита', () => {
  const edge = 'я'.repeat(MAX_QUERY_LEN);
  assert.equal(edge.length, MAX_QUERY_LEN);
  assert.equal(validateSearchBody({ query: edge }, { aiEnabled: false }).ok, true);
  const over = 'я'.repeat(MAX_QUERY_LEN + 1);
  const bad = validateSearchBody({ query: over }, { aiEnabled: false });
  assert.equal(bad.ok, false);
  assert.equal(bad.error_kind, 'query_too_long');
  // trim: пробелы по краям не входят в лимит полезной длины
  const padded = '  ' + 'a'.repeat(MAX_QUERY_LEN) + '  ';
  assert.equal(validateSearchBody({ query: padded }, { aiEnabled: false }).ok, true);
});

test('unit: неверный тип query', () => {
  for (const q of [123, { a: 1 }, ['x'], true]) {
    const r = validateSearchBody({ query: q }, { aiEnabled: false });
    assert.equal(r.ok, false);
    assert.equal(r.error_kind, 'invalid_query_type');
  }
});

test('unit: неверные типы structured / web_search; строка false ≠ true', () => {
  assert.equal(
    validateSearchBody({ query: 'куртка', attributes: [] }, { aiEnabled: false }).error_kind,
    'invalid_attributes_type'
  );
  assert.equal(
    validateSearchBody({ query: 'куртка', attributes_priority: 'true' }, { aiEnabled: false })
      .error_kind,
    'invalid_attributes_priority_type'
  );
  assert.equal(
    validateSearchBody({ query: 'куртка', clear_attributes: 'budget' }, { aiEnabled: false })
      .error_kind,
    'invalid_clear_attributes_type'
  );
  assert.equal(
    validateSearchBody({ query: 'куртка', web_search: 'false' }, { aiEnabled: false }).error_kind,
    'invalid_web_search_type'
  );
  const okFalse = validateSearchBody({ query: 'куртка', web_search: false }, { aiEnabled: false });
  assert.equal(okFalse.ok, true);
  assert.equal(okFalse.value.webSearch, false);
  const okTrue = validateSearchBody({ query: 'куртка', web_search: true }, { aiEnabled: false });
  assert.equal(okTrue.value.webSearch, true);
  // clear с пустыми строками-ключами допустим как массив строк
  const cleared = validateSearchBody(
    { query: 'куртка', clear_attributes: ['budget'] },
    { aiEnabled: false }
  );
  assert.equal(cleared.ok, true);
});

test('unit: нормальные запросы с пунктуацией сохраняются', () => {
  const samples = [
    "куртка O'STIN",
    'футболка чёрно-белая',
    "Levi's 501",
    'платье до 5000 ₽',
  ];
  for (const q of samples) {
    const r = validateSearchBody({ query: q }, { aiEnabled: false });
    assert.equal(r.ok, true);
    assert.equal(r.value.query, q);
  }
});

// --- HTTP integration ---

test('HTTP: пустой / пробелы → 400', async () => {
  await withServer(async (port) => {
    let r = await postSearch(port, { query: '' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error_kind, 'empty_query');
    r = await postSearch(port, { query: '   \t  ' });
    assert.equal(r.status, 400);
  });
});

test('HTTP: только валидные критерии → 200', async () => {
  await withServer(async (port) => {
    const r = await postSearch(port, {
      attributes: { category: 'куртка', color: 'чёрный' },
      attributes_priority: true,
    });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.sources) && r.data.sources.length > 0);
  });
});

test('HTTP: длина 300 ok, 301 → 400', async () => {
  await withServer(async (port) => {
    const ok = await postSearch(port, { query: 'к'.repeat(300) });
    assert.equal(ok.status, 200);
    const bad = await postSearch(port, { query: 'к'.repeat(301) });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error_kind, 'query_too_long');
  });
});

test('HTTP: неверный тип query → 400', async () => {
  await withServer(async (port) => {
    const r = await postSearch(port, { query: 42 });
    assert.equal(r.status, 400);
    assert.equal(r.data.error_kind, 'invalid_query_type');
  });
});

test('HTTP: неверные типы полей и web_search', async () => {
  await withServer(async (port) => {
    let r = await postSearch(port, { query: 'куртка', web_search: 'true' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error_kind, 'invalid_web_search_type');
    r = await postSearch(port, { query: 'куртка', attributes: ['куртка'] });
    assert.equal(r.status, 400);
    r = await postSearch(port, { query: 'куртка', clear_attributes: { budget: true } });
    assert.equal(r.status, 400);
  });
});

test('HTTP: повреждённый JSON → 400', async () => {
  await withServer(async (port) => {
    const r = await postSearch(port, null, { raw: '{not-json' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error_kind, 'invalid_json');
  });
});

test('HTTP: превышение размера тела → 413', async () => {
  await withServer(async (port) => {
    // AI_ENABLED=false → лимит тела ~64 КБ
    const big = '{"query":"' + 'a'.repeat(80_000) + '"}';
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    });
    assert.equal(r.status, 413);
    const data = await r.json();
    assert.equal(data.error_kind, 'payload_too_large');
  });
});

test('HTTP: нормальные фразы с апострофом и ₽ → 200', async () => {
  await withServer(async (port) => {
    for (const q of ["куртка O'STIN", 'футболка чёрно-белая', "Levi's 501", 'платье до 5000 ₽']) {
      const r = await postSearch(port, { query: q });
      assert.equal(r.status, 200, q);
      assert.ok(r.data.parsed && r.data.parsed.search_phrase, q);
    }
  });
});

test('клиент: вывод запроса через textContent, не innerHTML', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(js, /textContent/);
  assert.match(js, /MAX_QUERY_LEN|максимум 300|query\.length > 300/);
});

test('невалидный запрос не вызывает mock Ollama', async () => {
  let chatHits = 0;
  const mock = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
      chatHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content: '{}' } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mport = mock.address().port;
  try {
    await withServer(
      async (port) => {
        const r = await postSearch(port, { query: { evil: true }, image: TINY_JPEG_B64 });
        assert.equal(r.status, 400);
        assert.equal(r.data.error_kind, 'invalid_query_type');
        assert.equal(chatHits, 0);
      },
      {
        AI_ENABLED: 'true',
        OLLAMA_URL: `http://127.0.0.1:${mport}`,
        PHOTO_TIMEOUT_SEC: '3',
      }
    );
  } finally {
    mock.close();
  }
});

test('HTTP: только фото (тип ок) при AI_ENABLED=false → 503, не 400', async () => {
  await withServer(async (port) => {
    const r = await postSearch(port, { image: TINY_JPEG_B64 });
    assert.equal(r.status, 503);
    assert.equal(r.data.ai_enabled, false);
  });
});
