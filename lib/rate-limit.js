'use strict';

/**
 * Лимит частоты запросов в памяти процесса (скользящее окно).
 *
 * - Параметры настраиваются через конфиг (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC).
 * - При превышении возвращается retrySec — значение для заголовка Retry-After.
 * - Счётчик в памяти одного процесса: для одного инстанса достаточно;
 *   на этапе PostgreSQL/нескольких инстансов нужен общий счётчик.
 */

function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  /**
   * Проверка запроса.
   * @param {string} ip ключ (IP клиента)
   * @returns {{ ok: boolean, retrySec: number }}
   */
  function check(ip) {
    const key = ip || 'unknown';
    const now = Date.now();
    let list = hits.get(key) || [];
    list = list.filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      const retrySec = Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
      return { ok: false, retrySec };
    }
    list.push(now);
    hits.set(key, list);
    return { ok: true, retrySec: 0 };
  }

  /** Полный сброс счётчиков (для тестов и операций). */
  function reset() {
    hits.clear();
  }

  return { check, reset };
}

module.exports = { createRateLimiter };
