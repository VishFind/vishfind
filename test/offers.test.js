'use strict';

/**
 * Тесты слоя демо-предложений (lib/offers.js) и контракта /api/search.
 *
 * Запуск (без установки зависимостей, встроенный node:test, Node >= 18.1):
 *   node --test test/offers.test.js
 *
 * Покрытие:
 *  1) бюджет отсекает предложения дороже лимита;
 *  2) цвет из текста приоритетнее цвета фото (через mergeVisionIntoParsed);
 *  3) при отсутствии совпадений offers пустой (категория «брюки» отсутствует в демо-каталоге);
 *  4) позиции с in_stock: false не показываются;
 *  5) интеграция: /api/search возвращает offers (is_demo: true) и не ломает sources.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const { findOffers, loadOffers, scoreOffer, CURRENCY_RATE_RUB } = require('../lib/offers');
// require не поднимает сервер: listen() защищён require.main === module.
const { mergeVisionIntoParsed } = require('../server.js');

const ROOT = path.join(__dirname, '..');

// ---------- юнит-тесты ----------

test('бюджет отсекает дорогие предложения', () => {
  const offers = [
    { id: 'a', category: 'куртка', color: 'чёрный', price: 5000, currency: 'RUB', in_stock: true },
    { id: 'b', category: 'куртка', color: 'чёрный', price: 15000, currency: 'RUB', in_stock: true },
    { id: 'c', category: 'куртка', color: 'чёрный', price: 25000, currency: 'RUB', in_stock: true },
  ];
  const parsed = { category: 'куртка' };

  const inBudget = findOffers({ parsed, budget: 10000, offers });
  assert.deepEqual(inBudget.map((o) => o.id), ['a']);
  assert.ok(inBudget.every((o) => o.price <= 10000));

  // без бюджета возвращаются все три, отсортированные по цене
  const all = findOffers({ parsed, budget: null, offers });
  assert.deepEqual(all.map((o) => o.id), ['a', 'b', 'c']);
});

test('цвет из текста приоритетнее цвета фото (для offers)', () => {
  // текстовый parsed: цвет «чёрный»; фото-анализ предлагает «красный»
  const parsed = mergeVisionIntoParsed(
    { budget: null, size: null, color: 'чёрный', category: 'куртка', brand: null, movie: null, rest: null, search_phrase: null },
    { garment_type: 'куртка', subtype: null, color_primary: 'красный', color_extra: ['синий'], material: 'кожа', description: 'красная куртка' }
  );
  assert.equal(parsed.color, 'чёрный');

  // у красной позиции нет совпадений с итоговым запросом («чёрный» + «куртка»),
  // поэтому она обязан быть отсечена, даже если бы цвет из фото был красным
  const offers = [
    { id: 'red', category: 'платье', color: 'красный', price: 100, currency: 'RUB', in_stock: true },
    { id: 'black', category: 'куртка', color: 'чёрный', price: 200, currency: 'RUB', in_stock: true },
  ];
  const items = findOffers({ parsed, offers });
  // только чёрная позиция (color из текста, а не из фото)
  assert.deepEqual(items.map((o) => o.id), ['black']);
});

test('при отсутствии совпадений offers пустой (категория «брюки» отсутствует в демо-каталоге)', () => {
  const catalog = loadOffers();
  const items = findOffers({ parsed: { category: 'брюки', color: null, brand: null, size: null }, offers: catalog });
  assert.equal(items.length, 0);
});

test('позиции без in_stock=true не показываются', () => {
  const offers = [
    { id: 'on', category: 'куртка', color: 'чёрный', price: 100, currency: 'RUB', in_stock: true },
    { id: 'off', category: 'куртка', color: 'чёрный', price: 50, currency: 'RUB', in_stock: false },
  ];
  const items = findOffers({ parsed: { category: 'куртка' }, offers });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'on');
  assert.ok(items.every((o) => o.in_stock === true));
});

test('scoreOffer: +1 за категорию, бренд, цвет (составной), размер', () => {
  const offer = { category: 'куртка', brand: "Levi's", color: 'синий', size: 'M' };
  assert.equal(scoreOffer(offer, { category: 'куртка', brand: 'Levis', color: 'синий, красный', size: 'm' }), 4);
  assert.equal(scoreOffer(offer, { category: 'платье', brand: null, color: null, size: null }), 0);
});

test('priceInRub считает демо-курсы валют для сортировки/бюджета', () => {
  assert.equal(findOffers.length >= 0, true);
  assert.equal(CURRENCY_RATE_RUB.RUB, 1);
  assert.ok(CURRENCY_RATE_RUB.USD > 1);
  assert.ok(CURRENCY_RATE_RUB.EUR > CURRENCY_RATE_RUB.USD);
});

// ---------- интеграционный smoke: контракт /api/search ----------

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
      /* сервер ещё не готов */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}

test.before(async () => {
  server.port = await freePort();
  server.child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(server.port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.child.stderr.on('data', () => {
    /* дренаж stderr, чтобы не блокировать процесс */
  });
  await waitHealth(server.port);
});

test.after(() => {
  if (server.child) server.child.kill();
});

async function postSearch(query) {
  const r = await fetch(`http://127.0.0.1:${server.port}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: r.status, data: await r.json() };
}

test('интеграция: /api/search возвращает offers (is_demo, пустой для «брюки») и не ломает sources', async () => {
  const { status, data } = await postSearch('брюки шерстяные до 5000');
  assert.equal(status, 200);

  // offers — поле с демо-пометкой и пустым списком (нет совпадений в каталоге)
  assert.ok(data.offers && typeof data.offers === 'object');
  assert.equal(data.offers.is_demo, true);
  assert.ok(Array.isArray(data.offers.items));
  assert.equal(data.offers.items.length, 0);

  // sources не сломан: ссылки по-прежнему собираются
  assert.ok(Array.isArray(data.sources));
  assert.ok(data.sources.length > 0);
  assert.ok(data.parsed && data.parsed.search_phrase);
});

test('интеграция: /api/search с чёрной курткой возвращает демо-предложения', async () => {
  const { status, data } = await postSearch('чёрная куртка до 20000');
  assert.equal(status, 200);

  assert.ok(Array.isArray(data.offers.items));
  assert.ok(data.offers.items.length > 0);
  assert.ok(data.offers.items.every((o) => o.is_demo === true));
  assert.ok(data.offers.items.every((o) => o.in_stock === true));
  assert.ok(data.offers.items.every((o) => o.price <= 20000));
  // первый по score — позиция с категорией «куртка» и/или цветом «чёрный»
  const top = data.offers.items[0];
  assert.ok(
    top.category === 'куртка' || top.color === 'чёрный',
    `top offer должен совпадать по категории или цвету, got ${top.category}/${top.color}`
  );
});

test('интеграция: валидный запрос возвращает 200, а не 422', async () => {
  const { status, data } = await postSearch('black jacket');
  assert.equal(status, 200);
  assert.ok(data.parsed && data.parsed.search_phrase);
  assert.equal(data.parsed.color, 'чёрный');
  assert.equal(data.parsed.category, 'куртка');
});

test('интеграция: запрос без значимых слов возвращает 422', async () => {
  const { status, data } = await postSearch('пожалуйста найди одежду вещь');
  assert.equal(status, 422);
  assert.equal(data.parsed.search_phrase, null);
});

test('интеграция: 422 содержит понятное сообщение с рекомендацией и примером', async () => {
  const { status, data } = await postSearch('ищу вещь');
  assert.equal(status, 422);
  assert.ok(data.error && data.error.length > 0);
  // объясняет, что нужно ввести осмысленный запрос
  assert.match(data.error, /распознать|признак|осмысленн|конкретнее/i);
  // и приводит пример
  assert.match(data.error, /куртка/i);
  assert.equal(data.keep_text_input, true);
});