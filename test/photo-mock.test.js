'use strict';

/**
 * Mock-тесты обработки ответа Ollama через /api/search.
 * Не вызывают реальную модель и не считаются проверкой качества vision.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Минимальный JPEG 1×1 (валидный base64 без data:-префикса).
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EAD0QAAIBAgQDBgQFAwQDAAAAAAECAxEABAUSITFBUQYTImFxMoGhFCNCkbHB0fAVUmLh8RYjcv/aAAwDAQACEQMRAD8A9oFFFFABRRRQAUUUUAFFFFABRRRQB//Z';

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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}

function startMockOllama(handler) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => handler(req, res, body));
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function withApp(mockHandler, fn, extraEnv = {}) {
  const mock = await startMockOllama(mockHandler);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      OLLAMA_URL: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'qwen3-vl:4b-instruct',
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '3',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    return await fn(port);
  } finally {
    child.kill();
    mock.server.close();
  }
}

function okVisionPayload(fields) {
  return JSON.stringify({
    message: {
      role: 'assistant',
      content: JSON.stringify(fields),
    },
  });
}

test('фото: корректный JSON от Ollama → 200 и photo_used', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      okVisionPayload({
        garment_type: 'куртка',
        subtype: null,
        color_primary: 'чёрный',
        color_extra: [],
        material: 'кожа',
        brand: null,
        model_name: null,
        description: 'чёрная кожаная куртка',
      })
    );
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    return { status: r.status, data };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.photo_used, true);
  assert.equal(result.data.parsed.category, 'куртка');
  assert.equal(result.data.parsed.color, 'чёрный');
  assert.ok(result.data.photo);
});

const PHOTO_FAIL_WARN =
  'Фото не удалось разобрать. Результаты сформированы только по тексту и выбранным критериям.';

function hasPhotoFailWarn(data) {
  const list = []
    .concat((data && data.warnings) || [])
    .concat((data && data.parsed && data.parsed.warnings) || []);
  return list.some((w) => String(w).includes('Фото не удалось разобрать'));
}

test('текст+фото: некорректный JSON → 200 только по тексту, photo_used=false', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: 'это не json {{{' } }));
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'чёрная куртка', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.photo_used, false);
  assert.equal(result.data.photo, null);
  assert.ok(Array.isArray(result.data.sources) && result.data.sources.length > 0);
  assert.ok(hasPhotoFailWarn(result.data));
  assert.match(result.data.parsed.search_phrase || '', /куртка/i);
  // Не подмешаны выдуманные признаки vision.
  assert.notEqual(result.data.parsed.category, 'платье');
});

test('только фото: пустой ответ модели → 502', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: '' } }));
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.photo_used, false);
  assert.equal(result.data.sources, undefined);
});

test('только фото: Ollama недоступна → 502', async () => {
  const port = await freePort();
  const dead = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      OLLAMA_URL: `http://127.0.0.1:${dead}`,
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '2',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    assert.equal(r.status, 502);
    assert.equal(data.photo_used, false);
  } finally {
    child.kill();
  }
});

test('текст+фото: Ollama недоступна → 200 по тексту с предупреждением', async () => {
  const port = await freePort();
  const dead = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      OLLAMA_URL: `http://127.0.0.1:${dead}`,
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '2',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'джинсы синие размер 48', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.photo_used, false);
    assert.equal(data.photo, null);
    assert.ok(Array.isArray(data.sources) && data.sources.length > 0);
    assert.ok(hasPhotoFailWarn(data));
    assert.ok(String(data.warnings[0] || '').includes(PHOTO_FAIL_WARN.slice(0, 20)));
  } finally {
    child.kill();
  }
});

test('фото: частичные необязательные поля допустимы', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      okVisionPayload({
        garment_type: 'платье',
        color_primary: 'красный',
      })
    );
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.parsed.category, 'платье');
  assert.equal(result.data.parsed.color, 'красный');
  assert.equal(result.data.photo.brand, null);
});

test('только фото: таймаут Ollama → 502 без подмены успеха', async () => {
  const result = await withApp(
    (_req, res) => {
      setTimeout(() => {
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(okVisionPayload({ garment_type: 'куртка', color_primary: 'чёрный' }));
        } catch (_) {
          /* соединение уже закрыто */
        }
      }, 8000);
    },
    async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
      });
      return { status: r.status, data: await r.json() };
    },
    { PHOTO_TIMEOUT_SEC: '1' }
  );
  assert.equal(result.status, 502);
  assert.equal(result.data.photo_used, false);
});

test('текст+фото: таймаут Ollama → 200 по тексту с предупреждением', async () => {
  const result = await withApp(
    (_req, res) => {
      setTimeout(() => {
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(okVisionPayload({ garment_type: 'платье', color_primary: 'красный' }));
        } catch (_) {
          /* closed */
        }
      }, 8000);
    },
    async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'худи оверсайз', image: TINY_JPEG_B64 }),
      });
      return { status: r.status, data: await r.json() };
    },
    { PHOTO_TIMEOUT_SEC: '1' }
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.photo_used, false);
  assert.equal(result.data.photo, null);
  assert.ok(hasPhotoFailWarn(result.data));
  assert.ok(Array.isArray(result.data.sources) && result.data.sources.length > 0);
  // Поздний ответ vision не должен попасть в критерии (таймаут до merge).
  assert.notEqual(result.data.parsed.category, 'платье');
});

test('зависимый от фото текст («найди такое») + ошибка → 502, не общие ссылки', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: 'broken' } }));
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'найди такое', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.photo_used, false);
  assert.equal(result.data.sources, undefined);
  assert.match(result.data.error || '', /фото|слов/i);
});

test('критерии без текста + сбой фото → 200 по attributes', async () => {
  const result = await withApp((req, res) => {
    res.writeHead(500);
    res.end('fail');
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '',
        image: TINY_JPEG_B64,
        attributes: { category: 'куртка', color: 'чёрный' },
        attributes_priority: true,
      }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.photo_used, false);
  assert.ok(hasPhotoFailWarn(result.data));
  assert.ok(Array.isArray(result.data.sources) && result.data.sources.length > 0);
  assert.match(result.data.parsed.search_phrase || '', /куртка/i);
});

test('клиент: отмена/superseded не применяет поздний ответ', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
  assert.match(js, /abort\('superseded'\)/);
  assert.match(js, /mySeq !== searchSeq/);
  assert.match(js, /signal\.reason === 'superseded'/);
  assert.match(js, /signal\.reason === 'reset'/);
  assert.match(js, /function resetCurrentSearch/);
  // Fallback при сбое фото не помечает photo_used успехом.
  assert.match(js, /else if \(sentPhoto\)/);
  assert.match(js, /setPhotoStatus\('fail'\)/);
});

test('AI_ENABLED=false: фото → 503 честно', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'false',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    assert.equal(r.status, 503);
    assert.equal(data.ai_enabled, false);
  } finally {
    child.kill();
  }
});
