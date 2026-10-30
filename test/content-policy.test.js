'use strict';

/**
 * Контентные ограничения поисковых запросов (не юр. гарантия).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const {
  checkSearchInput,
  checkText,
  USER_MESSAGE,
} = require('../lib/content-policy');
const { validateSearchBody } = require('../lib/search-request');

const ROOT = path.join(__dirname, '..');

test('явные запрещённые намерения блокируются', () => {
  for (const q of [
    'скачать порно видео',
    'СМОТРЕТЬ   ПОРНО',
    'buy porn videos',
    'Download XXX movies',
    'купить экстремистскую литературу',
    'download extremist propaganda',
  ]) {
    const r = checkSearchInput({ query: q });
    assert.equal(r.allowed, false, q);
    assert.equal(r.error_kind, 'content_not_allowed');
    assert.equal(r.error, USER_MESSAGE);
    assert.ok(r.rule_id);
    assert.ok(!String(r.error).toLowerCase().includes('порно'));
  }
});

test('регистр и лишние пробелы не дают простой обход', () => {
  assert.equal(checkText('Скачать   Порно').allowed, false);
  assert.equal(checkText('DOWNLOAD   PORN VIDEOS').allowed, false);
});

test('допустимые запросы проходят', () => {
  for (const q of [
    'женское нижнее бельё',
    'купальник',
    'одежда для взрослых',
    'футболка без экстремистской символики',
    'Nike худи размер M',
    '18+',
    'взрослый размер',
    'куртка',
  ]) {
    assert.equal(checkSearchInput({ query: q }).allowed, true, q);
  }
});

test('отрицание и нейтральное упоминание не блокируются по одиночному слову', () => {
  assert.equal(checkSearchInput({ query: 'футболка без экстремистской символики' }).allowed, true);
  assert.equal(checkSearchInput({ query: 'экстремизм в новостях как термин' }).allowed, true);
  assert.equal(checkSearchInput({ query: 'бельё' }).allowed, true);
  assert.equal(checkSearchInput({ query: '18' }).allowed, true);
});

test('критерии не позволяют обойти проверку', () => {
  const r = checkSearchInput({
    query: 'куртка',
    attributes: { rest: 'скачать порно видео' },
  });
  assert.equal(r.allowed, false);
  const r2 = checkSearchInput({
    query: 'худи',
    attributes: { brand: 'download extremist propaganda' },
  });
  assert.equal(r2.allowed, false);
});

test('пустые/длинные/неверные типы — по-прежнему через validateSearchBody', () => {
  assert.equal(validateSearchBody({ query: '' }).error_kind, 'empty_query');
  assert.equal(validateSearchBody({ query: 'x'.repeat(301) }).error_kind, 'query_too_long');
  assert.equal(validateSearchBody({ query: 1 }).error_kind, 'invalid_query_type');
  // Контент не срабатывает на пустом до validate — порядок на сервере: validate → content.
  assert.equal(checkSearchInput({ query: '' }).allowed, true);
});

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
    } catch (_) { /* wait */ }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('server not ready');
}

test('HTTP: блокировка до Ollama; mock fetch не вызывается', async () => {
  const port = await freePort();
  let ollamaHits = 0;
  const mock = http.createServer((req, res) => {
    ollamaHits += 1;
    res.writeHead(500);
    res.end('no');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'true',
      OLLAMA_URL: `http://127.0.0.1:${mockPort}`,
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
      RATE_LIMIT_MAX: '200',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'скачать порно видео' }),
    });
    assert.equal(r.status, 400);
    const data = await r.json();
    assert.equal(data.error_kind, 'content_not_allowed');
    assert.equal(data.error, USER_MESSAGE);
    assert.equal(ollamaHits, 0);

    const ok = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'чёрная куртка' }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(Array.isArray(body.sources));
    assert.ok(!body.sources.some((s) => s.id === 'tsum_collect' || s.id === 'the_cultt'));
  } finally {
    child.kill();
    mock.close();
  }
});

test('фото-only тип ok при AI_ENABLED=false → 503, не content block', async () => {
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
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitHealth(port);
    const tiny =
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EAD0QAAIBAgQDBgQFAwQDAAAAAAECAxEABAUSITFBUQYTImFxMoGhFCNCkbHB0fAVUmLh8RYjcv/aAAwDAQACEQMRAD8A9oFFFFABRRRQAUUUUAFFFFABRRRQB//Z';
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/jpeg;base64,' + tiny }),
    });
    assert.equal(r.status, 503);
    const data = await r.json();
    assert.notEqual(data.error_kind, 'content_not_allowed');
  } finally {
    child.kill();
  }
});

test('интерфейс показывает нейтральную ошибку как textContent-путь', () => {
  const searchJs = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
  assert.match(searchJs, /data\.error/);
  assert.match(searchJs, /setStatus\(text,\s*'error'\)/);
  assert.match(searchJs, /textContent/);
});
