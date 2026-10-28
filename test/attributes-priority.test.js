'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const server = { child: null, port: 0 };

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

async function waitHealth(port, timeoutMs = 10000) {
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

test.before(async () => {
  server.port = await freePort();
  server.child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(server.port),
      HOST: '127.0.0.1',
      AI_ENABLED: 'false',
      RATE_LIMIT_MAX: '200',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitHealth(server.port);
});

test.after(() => {
  if (server.child) server.child.kill();
});

async function post(body) {
  const r = await fetch(`http://127.0.0.1:${server.port}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

test('без attributes_priority текст важнее attributes', async () => {
  const { status, data } = await post({
    query: 'чёрная куртка',
    attributes: { color: 'красный', category: 'платье' },
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.color, 'чёрный');
  assert.equal(data.parsed.category, 'куртка');
});

test('attributes_priority=true: ручные поля главнее текста', async () => {
  const { status, data } = await post({
    query: 'чёрная куртка',
    attributes: { color: 'красный', category: 'платье', size: 'M' },
    attributes_priority: true,
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.color, 'красный');
  assert.equal(data.parsed.category, 'платье');
  assert.equal(data.parsed.size, 'M');
  assert.ok(data.parsed.search_phrase);
  assert.match(data.parsed.search_phrase, /платье/);
});

test('attributes заполняют только пустые поля', async () => {
  const { status, data } = await post({
    query: 'куртка',
    attributes: { color: 'синий', brand: 'Nike' },
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.category, 'куртка');
  assert.equal(data.parsed.color, 'синий');
  assert.equal(data.parsed.brand, 'Nike');
});

test('clear_attributes убирает бюджет из текста', async () => {
  const { status, data } = await post({
    query: 'чёрная куртка до 15000',
    clear_attributes: ['budget'],
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.budget, null);
  assert.equal(data.parsed.budget_min, null);
  assert.equal(data.parsed.budget_max, null);
  assert.equal(data.parsed.category, 'куртка');
  assert.equal(data.parsed.color, 'чёрный');
});

test('attributes_priority с диапазоном цены', async () => {
  const { status, data } = await post({
    query: 'куртка до 90000',
    attributes: { category: 'бомбер', budget_min: 5000, budget_max: 12000 },
    attributes_priority: true,
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.category, 'бомбер');
  assert.equal(data.parsed.budget_min, 5000);
  assert.equal(data.parsed.budget_max, 12000);
  assert.equal(data.parsed.budget, 12000);
});

test('attributes_priority: частичные attrs не затирают текст пустыми null', async () => {
  const { status, data } = await post({
    query: 'чёрная куртка до 15000',
    attributes: { size: 'M', budget_min: null, budget_max: null, color: null, category: null },
    attributes_priority: true,
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.size, 'M');
  assert.equal(data.parsed.color, 'чёрный');
  assert.equal(data.parsed.category, 'куртка');
  assert.equal(data.parsed.budget_max, 15000);
});

test('attributes_priority + clear_attributes: цена из текста не возвращается', async () => {
  const { status, data } = await post({
    query: 'чёрная куртка до 15000',
    attributes: { size: 'L' },
    attributes_priority: true,
    clear_attributes: ['budget'],
  });
  assert.equal(status, 200);
  assert.equal(data.parsed.size, 'L');
  assert.equal(data.parsed.budget, null);
  assert.equal(data.parsed.budget_max, null);
  assert.equal(data.parsed.color, 'чёрный');
});
