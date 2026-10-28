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
 *  5) интеграция: /api/search — items=live, demo_items=демо; без live items пуст.
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

test('бюджет и сортировка не переводят чужие валюты выдуманным курсом', () => {
  const { passesBudget, compareOffers } = require('../lib/offers');
  assert.equal(passesBudget({ price: 5000, currency: 'RUB' }, 10000), true);
  assert.equal(passesBudget({ price: 25000, currency: 'RUB' }, 10000), false);
  // EUR не отсекаем рублёвым бюджетом через курс
  assert.equal(passesBudget({ price: 500, currency: 'EUR' }, 10000), true);
  const a = { score: 1, price: 100, currency: 'EUR' };
  const b = { score: 1, price: 200, currency: 'RUB' };
  assert.ok(compareOffers(b, a) < 0, 'RUB при равном score идёт раньше EUR');
  assert.equal(CURRENCY_RATE_RUB.RUB, 1);
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
    env: {
      ...process.env,
      PORT: String(server.port),
      HOST: '127.0.0.1',
      WEB_SEARCH_ENABLED: 'false',
      OLLAMA_WEB_FETCH: 'false',
    },
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

test('интеграция: /api/search — live items пусты для «брюки», sources целы', async () => {
  const { status, data } = await postSearch('брюки шерстяные до 5000');
  assert.equal(status, 200);

  // Контракт: items = только реальные; без eBay/HTML live — пустой массив.
  assert.ok(data.offers && typeof data.offers === 'object');
  assert.equal(data.offers.is_demo, false);
  assert.equal(data.offers.has_live_products, false);
  assert.ok(Array.isArray(data.offers.items));
  assert.equal(data.offers.items.length, 0);
  assert.ok(Array.isArray(data.offers.demo_items));
  // Демо не маскируется под live.
  assert.ok((data.offers.demo_items || []).every((o) => o && o.is_demo === true));
  assert.ok(!(data.offers.items || []).some((o) => o && o.is_demo === true));

  assert.ok(Array.isArray(data.sources));
  assert.ok(data.sources.length > 0);
  assert.ok(data.parsed && data.parsed.search_phrase);
});

test('интеграция: /api/search — демо в demo_items, не в items', async () => {
  const { status, data } = await postSearch('чёрная куртка до 20000');
  assert.equal(status, 200);

  assert.ok(Array.isArray(data.offers.items));
  assert.equal(data.offers.items.length, 0, 'без live-интеграции items пуст');
  assert.equal(data.offers.has_live_products, false);
  assert.equal(data.offers.is_demo, false);

  assert.ok(Array.isArray(data.offers.demo_items));
  assert.ok(data.offers.demo_items.length > 0);
  assert.ok(data.offers.demo_items.every((o) => o.is_demo === true));
  assert.ok(data.offers.demo_items.every((o) => o.in_stock === true));
  assert.ok(data.offers.demo_items.every((o) => o.price <= 20000));
  // Демо не попадает в массив реальных.
  const demoIds = new Set(data.offers.demo_items.map((o) => o.id).filter(Boolean));
  assert.ok(!(data.offers.items || []).some((o) => demoIds.has(o.id)));

  const top = data.offers.demo_items[0];
  assert.ok(
    top.category === 'куртка' || top.color === 'чёрный',
    `top demo должен совпадать по категории или цвету, got ${top.category}/${top.color}`
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