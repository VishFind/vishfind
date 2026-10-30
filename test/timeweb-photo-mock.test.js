'use strict';

/**
 * Mock-тесты Timeweb vision через /api/search.
 * Не вызывают реальный Timeweb API.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EAD0QAAIBAgQDBgQFAwQDAAAAAAECAxEABAUSITFBUQYTImFxMoGhFCNCkbHB0fAVUmLh8RYjcv/aAAwDAQACEQMRAD8A9oFFFFABRRRQAUUUUAFFFFABRRRQB//Z';

const FULL_FIELDS = {
  garment_type: 'куртка',
  subtype: null,
  color_primary: 'чёрный',
  color_extra: [],
  material: 'кожа',
  pattern: null,
  collar: null,
  closure: null,
  pockets: null,
  length: null,
  fit: null,
  hardware_and_details: null,
  era_or_style: null,
  visible_text: [],
  brand: null,
  model_name: null,
  description: 'чёрная кожаная куртка',
};

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
      if (r.ok) return await r.json();
    } catch (_) {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}

function startMockTimeweb(handler) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
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

function okTimewebPayload(fields, usage) {
  return JSON.stringify({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(fields) } }],
    usage: usage || { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

async function withTimewebApp(mockHandler, fn, extraEnv = {}) {
  const mock = await startMockTimeweb(mockHandler);
  const port = await freePort();
  const deadOllama = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      PHOTO_PROVIDER: 'timeweb',
      TIMEWEB_AI_URL: `http://127.0.0.1:${mock.port}/v1/chat/completions`,
      TIMEWEB_AI_API_KEY: 'test-key-not-real',
      TIMEWEB_AI_MODEL: 'openai/gpt-4o-mini',
      // Ollama намеренно «мёртвая» — failover быть не должно.
      OLLAMA_URL: `http://127.0.0.1:${deadOllama}`,
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '3',
      PHOTO_TOTAL_BUDGET_SEC: '8',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    return await fn(port, mock);
  } finally {
    child.kill();
    mock.server.close();
  }
}

test('Timeweb mock: корректный JSON → 200, photo_used, usage', async () => {
  let sawAuth = false;
  let sawDataUrl = false;
  let sawJsonObject = false;
  const result = await withTimewebApp((req, res, body) => {
    sawAuth = String(req.headers.authorization || '').startsWith('Bearer ');
    const j = JSON.parse(body);
    sawJsonObject = j.response_format && j.response_format.type === 'json_object';
    const parts = j.messages && j.messages[0] && j.messages[0].content;
    if (Array.isArray(parts)) {
      const img = parts.find((p) => p && p.type === 'image_url');
      sawDataUrl = !!(img && img.image_url && /^data:image\//.test(img.image_url.url));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(okTimewebPayload(FULL_FIELDS));
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.photo_used, true);
  assert.equal(result.data.parsed.category, 'куртка');
  assert.ok(result.data.photo);
  assert.ok(result.data.photo.usage);
  assert.equal(result.data.photo.usage.total_tokens, 30);
  assert.equal(sawAuth, true);
  assert.equal(sawDataUrl, true);
  assert.equal(sawJsonObject, true);
});

test('Timeweb mock: неверный JSON → 502 только-фото', async () => {
  const result = await withTimewebApp((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: 'это не json {{{' } }],
        usage: { total_tokens: 1 },
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
  assert.equal(result.status, 502);
  assert.equal(result.data.photo_used, false);
});

test('Timeweb mock: частичные поля допустимы', async () => {
  const result = await withTimewebApp((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(okTimewebPayload({ garment_type: 'платье', color_primary: 'красный' }));
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
  assert.equal(result.data.photo.brand, null);
});

test('Timeweb mock: 401 → честная ошибка, без Ollama failover', async () => {
  const result = await withTimewebApp((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
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
  assert.match(String(result.data.detail || result.data.error || ''), /авторизац|TIMEWEB|ключ/i);
});

test('Timeweb mock: 429 лимит', async () => {
  const result = await withTimewebApp((_req, res) => {
    res.writeHead(429);
    res.end('rate');
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
  assert.match(String((result.data.warnings || []).join(' ')), /Фото не удалось разобрать/);
});

test('Timeweb mock: 503 сервис', async () => {
  const result = await withTimewebApp((_req, res) => {
    res.writeHead(503);
    res.end('down');
  }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    return { status: r.status, data: await r.json() };
  });
  assert.equal(result.status, 502);
  assert.match(String(result.data.detail || result.data.error || ''), /сервис|Timeweb|недоступ/i);
});

test('Timeweb: нет ключа → ошибка без сетевого вызова', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      PHOTO_PROVIDER: 'timeweb',
      TIMEWEB_AI_API_KEY: '',
      TIMEWEB_AI_URL: 'http://127.0.0.1:9/v1/chat/completions',
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '2',
      PHOTO_TOTAL_BUDGET_SEC: '6',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    const health = await waitHealth(port);
    assert.equal(health.photo_provider, 'timeweb');
    assert.equal(health.recognition_configured, false);
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    assert.equal(r.status, 502);
    assert.match(String(data.detail || data.error || ''), /TIMEWEB_AI_API_KEY|ключ/i);
  } finally {
    child.kill();
  }
});

test('Timeweb mock: таймаут → 502', async () => {
  const result = await withTimewebApp(
    (_req, res) => {
      setTimeout(() => {
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(okTimewebPayload(FULL_FIELDS));
        } catch (_) {
          /* closed */
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
    { PHOTO_TIMEOUT_SEC: '1', PHOTO_TOTAL_BUDGET_SEC: '3' }
  );
  assert.equal(result.status, 502);
  assert.equal(result.data.photo_used, false);
});

test('Ollama путь сохранён при PHOTO_PROVIDER=ollama (mock)', async () => {
  const mock = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            message: { role: 'assistant', content: JSON.stringify(FULL_FIELDS) },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end('no');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      PHOTO_PROVIDER: 'ollama',
      OLLAMA_URL: `http://127.0.0.1:${mock.port}`,
      PHOTO_PIPELINE: 'schema',
      PHOTO_TIMEOUT_SEC: '3',
      PHOTO_TOTAL_BUDGET_SEC: '8',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    const health = await waitHealth(port);
    assert.equal(health.photo_provider, 'ollama');
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', image: TINY_JPEG_B64 }),
    });
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.photo_used, true);
  } finally {
    child.kill();
    mock.server.close();
  }
});
