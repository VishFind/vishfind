'use strict';

/**
 * Тесты провайдера eBay Browse API (providers/ebay.js).
 * Без сети и зависимостей: fetch инжектится через createEbayProvider({ fetchImpl }).
 *
 * Запуск (Node >= 18.1):
 *   node --test test/ebay.test.js
 *
 * Покрытие:
 *  1) нормализация itemSummary в формат offers (category/color/size/brand = null);
 *  2) кэш access-токена: второй поиск не запрашивает токен заново;
 *  3) кэш результатов: повторный поиск той же фразы не ходит в Browse API;
 *  4) ошибка сети не выбрасывается: search() -> { ok:false, items:[] };
 *  5) ограничение EBAY_LIMIT (30) при большом ответе.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEbayProvider,
  normalizeItem,
  normalizeItems,
  EBAY_LIMIT,
} = require('../providers/ebay');

const CLIENT = { clientId: 'cid', clientSecret: 'secret' };

function itemSummary(overrides = {}) {
  return {
    itemId: 'v1|296000000001|0',
    title: 'Vintage 90s Leather Jacket Carhartt Size L',
    price: { value: '89.99', currency: 'USD' },
    condition: 'USED',
    itemWebUrl: 'https://www.ebay.com/itm/296000000001',
    thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/xxx/s-l500.jpg' }],
    categories: [{ categoryId: '57988', categoryName: "Men's Coats & Jackets" }],
    itemCreationDate: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(obj, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(obj) };
}

function makeFakeFetch(handlers) {
  const calls = { token: 0, search: 0 };
  const fn = async (url, opts = {}) => {
    if (url.includes('/identity/v1/oauth2/token')) {
      calls.token += 1;
      if (handlers.token) return handlers.token();
      return jsonResponse({ access_token: 'tok-1', expires_in: 3600 });
    }
    if (url.includes('/buy/browse/v1/item_summary/search')) {
      calls.search += 1;
      if (handlers.search) return handlers.search();
      return jsonResponse({ itemSummaries: [itemSummary(), itemSummary({ title: 'Levi\'s 501 Jeans' })] });
    }
    throw new Error('unexpected url: ' + url);
  };
  return { fn, calls };
}

test('нормализация: itemSummary -> формат offers (category/color/size/brand = null, is_demo=false)', () => {
  const out = normalizeItem(itemSummary());
  assert.ok(out);
  assert.equal(out.id, 'v1|296000000001|0');
  assert.equal(out.source, 'eBay');
  assert.equal(out.title, 'Vintage 90s Leather Jacket Carhartt Size L');
  assert.equal(out.brand, null);
  assert.equal(out.category, null); // английские категории не показываем
  assert.equal(out.color, null);
  assert.equal(out.size, null);
  assert.equal(out.price, 89.99);
  assert.equal(out.currency, 'USD');
  assert.equal(out.condition, 'USED');
  assert.equal(out.url, 'https://www.ebay.com/itm/296000000001');
  assert.equal(out.image_url, 'https://i.ebayimg.com/images/g/xxx/s-l500.jpg');
  assert.equal(out.in_stock, true);
  assert.equal(out.updated_at, '2026-10-20');
  assert.equal(out.is_demo, false);
});

test('нормализация: невалидная позиция отбрасывается', () => {
  assert.equal(normalizeItem(null), null);
  assert.equal(normalizeItem({ itemId: 'a', title: 'x', price: { value: 'x' } }), null); // цена не число
  assert.equal(normalizeItem({ itemId: 'a', title: 'x', price: { value: '5' } }), null); // нет url
});

test('кэш токена: второй поиск не запрашивает токен заново', async () => {
  const fake = makeFakeFetch({});
  const ebay = createEbayProvider({ fetchImpl: fake.fn, ...CLIENT });

  const first = await ebay.search('купить куртку');
  assert.equal(first.ok, true);
  assert.equal(fake.calls.token, 1);
  assert.equal(fake.calls.search, 1);

  const second = await ebay.search('ещё один запрос');
  assert.equal(second.ok, true);
  assert.equal(fake.calls.token, 1, 'токен не должен запрашиваться повторно');
  assert.equal(fake.calls.search, 2);
});

test('кэш результатов: повторный поиск той же фразы не ходит в Browse API', async () => {
  const fake = makeFakeFetch({});
  const ebay = createEbayProvider({ fetchImpl: fake.fn, ...CLIENT });

  const first = await ebay.search('чёрная куртка');
  assert.equal(first.ok, true);
  const second = await ebay.search('ЧЁРНАЯ КУРТКА'); // регистр не важен
  assert.equal(second.ok, true);
  assert.equal(fake.calls.search, 1, 'Browse API вызывается один раз (кэш)');
  assert.equal(second.cached, true);
});

test('ошибка сети: search() возвращает ok:false и не бросает исключение', async () => {
  const ebay = createEbayProvider({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    ...CLIENT,
  });

  const res = await ebay.search('куртка');
  assert.equal(res.ok, false);
  assert.deepEqual(res.items, []);
  assert.ok(res.error);
});

test('ошибка токена (401): search() возвращает ok:false, поиск не ломается', async () => {
  const ebay = createEbayProvider({
    fetchImpl: async (url) => {
      if (url.includes('oauth2/token')) return jsonResponse({ error: 'bad' }, false, 401);
      throw new Error('search не должен вызываться');
    },
    ...CLIENT,
  });
  const res = await ebay.search('куртка');
  assert.equal(res.ok, false);
  assert.deepEqual(res.items, []);
  assert.match(res.error, /token|токен/i);
});

test('лимит: normalizeItems обрезает до EBAY_LIMIT', () => {
  const many = [];
  for (let i = 0; i < 100; i += 1) {
    many.push(itemSummary({ itemId: `v1|${i}|0`, title: `Item ${i}`, itemWebUrl: `https://www.ebay.com/itm/${i}` }));
  }
  const out = normalizeItems(many);
  assert.equal(out.length, EBAY_LIMIT);
  assert.equal(out[0].id, 'v1|0|0');
  assert.equal(EBAY_LIMIT, 30);
});

test('без ключей: isConfigured() === false и search() не вызывает сеть', async () => {
  const fake = makeFakeFetch({});
  const ebay = createEbayProvider({ fetchImpl: fake.fn, clientId: null, clientSecret: null });
  assert.equal(ebay.isConfigured(), false);
  const res = await ebay.search('куртка');
  assert.equal(res.ok, false);
  assert.equal(fake.calls.token, 0);
  assert.equal(fake.calls.search, 0);
});

test('circuit breaker: после порога ошибок поиск не ходит в сеть', async () => {
  let calls = 0;
  const ebay = createEbayProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network down');
    },
    ...CLIENT,
    circuitThreshold: 2,
    circuitCooldownMs: 60_000,
  });

  const r1 = await ebay.search('куртка');
  assert.equal(r1.ok, false);
  const r2 = await ebay.search('куртка');
  assert.equal(r2.ok, false);
  assert.equal(r2.circuit_open, true, 'после порога ошибок circuit открыт');

  const r3 = await ebay.search('пальто');
  assert.equal(r3.ok, false);
  assert.equal(r3.circuit_open, true);
  assert.equal(calls, 2, 'после открытия circuit breaker сеть не вызывается');
});

test('circuit breaker: успех сбрасывает счётчик ошибок', async () => {
  let fail = true;
  const ebay = createEbayProvider({
    fetchImpl: async (url) => {
      if (fail) throw new Error('network down');
      if (url.includes('oauth2/token')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      return jsonResponse({ itemSummaries: [itemSummary()] });
    },
    ...CLIENT,
    circuitThreshold: 2,
    circuitCooldownMs: 60_000,
  });

  await ebay.search('куртка'); // ошибка 1
  await ebay.search('куртка'); // ошибка 2 → circuit open
  assert.equal((await ebay.search('куртка')).circuit_open, true);

  fail = false;
  ebay.clearCache(); // сброс circuit breaker (операционный/тестовый путь)
  const ok = await ebay.search('куртка');
  assert.equal(ok.ok, true);
  const st = ebay.status();
  assert.equal(st.fails, 0);
  assert.equal(st.circuit_open, false);
});

test('status(): отдаёт состояние без секретов', async () => {
  const ebay = createEbayProvider({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    ...CLIENT,
  });
  const st0 = ebay.status();
  assert.equal(st0.configured, true);
  assert.equal(st0.circuit_open, false);

  await ebay.search('куртка');
  const st1 = ebay.status();
  assert.equal(st1.fails, 1);
  assert.ok(st1.last_error_at);
  assert.ok(!('clientSecret' in st1), 'секреты не попадают в status()');
  assert.ok(!('clientId' in st1), 'секреты не попадают в status()');
});