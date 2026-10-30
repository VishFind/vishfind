'use strict';

/**
 * Регрессия: публичная статика по белому списку и общий слот фотоанализа
 * для POST /api/search и POST /api/find.
 * Ollama — локальный mock. Платные провайдеры не вызываются.
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

function okVisionPayload() {
  return JSON.stringify({
    message: {
      role: 'assistant',
      content: JSON.stringify({
        garment_type: 'куртка',
        subtype: null,
        color_primary: 'чёрный',
        color_extra: [],
        material: 'кожа',
        brand: null,
        model_name: null,
        description: 'чёрная кожаная куртка',
      }),
    },
  });
}

function holdingMock() {
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let signal;
  const arrived = new Promise((resolve) => {
    signal = resolve;
  });
  const handler = (req, res) => {
    signal();
    gate.then(() => {
      if (res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(okVisionPayload());
    });
  };
  return {
    handler,
    arrived,
    release() {
      releaseGate();
    },
  };
}

async function withApp(fn, extraEnv = {}, mockHandler) {
  const mock = mockHandler ? await startMockOllama(mockHandler) : null;
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: mock ? 'true' : 'false',
      OLLAMA_URL: mock ? `http://127.0.0.1:${mock.port}` : 'http://127.0.0.1:9',
      OLLAMA_MODEL: 'qwen3-vl:4b-instruct',
      PHOTO_PROVIDER: 'ollama',
      PHOTO_PIPELINE: 'schema',
      PHOTO_CONCURRENCY: '1',
      PHOTO_TIMEOUT_SEC: '8',
      PHOTO_TOTAL_BUDGET_SEC: '15',
      RATE_LIMIT_MAX: '200',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
      // Пустые значения блокируют чтение ключей из .env внутри дочернего процесса.
      TAVILY_API_KEY: '',
      OLLAMA_API_KEY: '',
      EBAY_CLIENT_ID: '',
      EBAY_CLIENT_SECRET: '',
      TIMEWEB_AI_API_KEY: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    return await fn(port);
  } finally {
    child.kill();
    if (mock) mock.server.close();
  }
}

function postJson(port, route, body, timeoutMs) {
  return fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
}

test('внутренние файлы недоступны, публичные ресурсы отдаются', async () => {
  await withApp(async (port) => {
    const base = `http://127.0.0.1:${port}`;
    const hidden = [
      '/archives/vishfind-2026-10-28.zip',
      '/docs/CURSOR_HANDOFF.md',
      '/TIMEWEB_AI_HANDOFF.md',
      '/PROJECT_SPECIFICATION.md',
      '/HOSTING_AI_BRIEF_RU.txt',
      '/server.js',
      '/lib/config.js',
      '/providers/ebay.js',
      '/package.json',
      '/package-lock.json',
      '/.env',
      '/env.txt',
      '/.env.example',
      '/data/sources.json',
      '/scripts/make-dated-archive.js',
      '/test/photo-mock.test.js',
      '/images/logo-preview/compare.html',
      '/css/../server.js',
      '/fonts/../package.json',
    ];
    for (const p of hidden) {
      const r = await fetch(base + p);
      assert.equal(r.status, 403, p);
      await r.arrayBuffer();
    }

    const visible = [
      ['/', 'text/html'],
      ['/about.html', 'text/html'],
      ['/contacts.html', 'text/html'],
      ['/css/site.css', 'text/css'],
      ['/css/fonts.css', 'text/css'],
      ['/js/welcome-splash.js', 'javascript'],
      ['/js/welcome-scene-data.js', 'javascript'],
      ['/js/search.js', 'javascript'],
      ['/images/favicon.svg', 'image/svg'],
      ['/images/logo-vishfind-light.png', 'image/png'],
      ['/images/logo-vishfind-dark.png', 'image/png'],
      ['/fonts/manrope-latin-400.woff2', 'font/woff2'],
      ['/fonts/literata-cyrillic-600.woff2', 'font/woff2'],
    ];
    for (const [p, type] of visible) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      const ct = r.headers.get('content-type') || '';
      assert.ok(ct.includes(type), p + ' ' + ct);
      await r.arrayBuffer();
    }
  });
});

test('занятый /api/search не пускает /api/find в тот же слот', async () => {
  const mock = holdingMock();
  await withApp(
    async (port) => {
      const searchP = postJson(port, '/api/search', { image: TINY_JPEG_B64 });
      await mock.arrived;
      const findRes = await postJson(port, '/api/find', { query: 'куртка', image: TINY_JPEG_B64 }, 4000);
      assert.equal(findRes.status, 503);
      const findBody = await findRes.json();
      assert.equal(findBody.overloaded, true);
      mock.release();
      const searchRes = await searchP;
      assert.equal(searchRes.status, 200);
      const searchBody = await searchRes.json();
      assert.equal(searchBody.photo_used, true);
    },
    {},
    mock.handler
  );
});

test('занятый /api/find не пускает /api/search в тот же слот', async () => {
  const mock = holdingMock();
  await withApp(
    async (port) => {
      const findP = postJson(port, '/api/find', { query: 'куртка', image: TINY_JPEG_B64 });
      await mock.arrived;
      const searchRes = await postJson(port, '/api/search', { image: TINY_JPEG_B64 }, 4000);
      assert.equal(searchRes.status, 503);
      const searchBody = await searchRes.json();
      assert.equal(searchBody.overloaded, true);
      mock.release();
      const findRes = await findP;
      assert.equal(findRes.status, 200);
      const findBody = await findRes.json();
      assert.ok(findBody.analysis);
    },
    {},
    mock.handler
  );
});

test('после ошибки фотоанализа следующий запрос снова проходит', async () => {
  let n = 0;
  await withApp(
    async (port) => {
      const failed = await postJson(port, '/api/search', { image: TINY_JPEG_B64 });
      assert.equal(failed.status, 502);
      await failed.json();
      const again = await postJson(port, '/api/find', { query: 'куртка', image: TINY_JPEG_B64 });
      assert.equal(again.status, 200);
      const body = await again.json();
      assert.ok(body.analysis);
      assert.notEqual(again.status, 503);
    },
    {},
    (req, res) => {
      n += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // schema и повтор строгого промпта — два вызова на один неудачный разбор.
      if (n <= 2) {
        res.end(JSON.stringify({ message: { role: 'assistant', content: 'not-json' } }));
        return;
      }
      res.end(okVisionPayload());
    }
  );
});
