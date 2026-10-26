'use strict';

/**
 * Тесты санитизированного логгера (lib/logger.js).
 * Запуск: node --test test/logger.test.js
 *
 * Покрытие:
 *  1) маскировка секретов по имени поля;
 *  2) маскировка base64-фото и data URI;
 *  3) маскировка email, телефона и IPv4 в строках;
 *  4) обрезка длинных строк;
 *  5) отсутствие ложных срабатываний на датах;
 *  6) фильтрация по уровню;
 *  7) вывод — валидный JSON без секретов.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLogger, sanitize } = require('../lib/logger');

function captureLogger(level) {
  const lines = [];
  const stream = { write: (s) => lines.push(s) };
  const logger = createLogger({ level, stream });
  return { logger, lines };
}

test('sanitize: маскирует секреты по имени поля', () => {
  const out = sanitize({
    client_secret: 'super-secret',
    access_token: 'tok-123',
    api_key: 'key-456',
    authorization: 'Bearer abc',
    cookie: 'sid=1',
    title: 'нормальное поле',
  });
  assert.equal(out.client_secret, '***');
  assert.equal(out.access_token, '***');
  assert.equal(out.api_key, '***');
  assert.equal(out.authorization, '***');
  assert.equal(out.cookie, '***');
  assert.equal(out.title, 'нормальное поле');
});

test('sanitize: маскирует base64-фото и data URI', () => {
  const b64 = 'A'.repeat(300);
  assert.equal(sanitize(b64), '[image-base64]');
  assert.equal(sanitize('data:image/jpeg;base64,AAAA'), '[image-base64]');
});

test('sanitize: маскирует email, телефон и IPv4 в строках', () => {
  const s = 'пишите на user@example.com или +7 916 123-45-67, ip 192.168.1.10';
  const out = sanitize(s);
  assert.ok(!out.includes('user@example.com'), 'email не должен остаться');
  assert.ok(out.includes('user@***'), 'email должен быть маскирован');
  assert.ok(!out.includes('916 123-45-67'), 'телефон не должен остаться');
  assert.ok(!out.includes('192.168.1.10'), 'полный IP не должен остаться');
  assert.ok(out.includes('192.168.***.***'), 'IP должен быть маскирован');
});

test('sanitize: обрезает длинные строки', () => {
  const long = 'текст '.repeat(500);
  const out = sanitize(long);
  assert.ok(out.length < 600, 'длинная строка должна быть обрезана');
  assert.ok(out.includes('[truncated]'));
});

test('sanitize: не маскирует даты (ложные срабатывания)', () => {
  const out = sanitize('2026-10-26T12:00:00.000Z');
  assert.equal(out, '2026-10-26T12:00:00.000Z');
});

test('logger: уровни фильтруются', () => {
  const { logger, lines } = captureLogger('warn');
  logger.debug('скрыто');
  logger.info('скрыто');
  logger.warn('видно');
  logger.error('видно');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('"level":"warn"'));
  assert.ok(lines[1].includes('"level":"error"'));
});

test('logger: вывод — валидный JSON без секретов', () => {
  const { logger, lines } = captureLogger('debug');
  logger.error('ошибка', { client_secret: 'abc', query: 'куртка' });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.client_secret, '***');
  assert.ok(parsed.ts);
  assert.ok(parsed.msg);
});