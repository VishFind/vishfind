'use strict';

/**
 * Тесты rate limit (lib/rate-limit.js).
 * Запуск: node --test test/rate-limit.test.js
 *
 * Покрытие:
 *  1) пропуск запросов до лимита и отказ после;
 *  2) независимость счётчиков по разным IP;
 *  3) скользящее окно (старые записи не блокируют);
 *  4) reset очищает счётчики;
 *  5) retrySec положительный при превышении.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../lib/rate-limit');

test('пропускает запросы до лимита и отказывает после', () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(rl.check('1.2.3.4').ok, true);
  assert.equal(rl.check('1.2.3.4').ok, true);
  assert.equal(rl.check('1.2.3.4').ok, true);
  const hit = rl.check('1.2.3.4');
  assert.equal(hit.ok, false);
  assert.ok(hit.retrySec >= 1);
});

test('разные IP считаются отдельно', () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 2 });
  rl.check('a');
  rl.check('a');
  assert.equal(rl.check('b').ok, true);
  assert.equal(rl.check('a').ok, false);
});

test('окно скользящее: старые записи не блокируют', async () => {
  const rl = createRateLimiter({ windowMs: 50, max: 2 });
  rl.check('ip');
  rl.check('ip');
  assert.equal(rl.check('ip').ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rl.check('ip').ok, true);
});

test('reset очищает счётчики', () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 1 });
  rl.check('ip');
  assert.equal(rl.check('ip').ok, false);
  rl.reset();
  assert.equal(rl.check('ip').ok, true);
});

test('retrySec положительный при превышении', () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 1 });
  rl.check('ip');
  const hit = rl.check('ip');
  assert.equal(hit.ok, false);
  assert.ok(hit.retrySec >= 1 && hit.retrySec <= 60);
});