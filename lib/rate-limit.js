'use strict';

/**
 * Простой лимит частоты запросов в памяти процесса.
 * После перезапуска сервера счётчики обнуляются — для демо этого достаточно.
 */

function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function check(ip) {
    const key = ip || 'unknown';
    const now = Date.now();
    let list = hits.get(key) || [];
    list = list.filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      const retrySec = Math.ceil((windowMs - (now - list[0])) / 1000);
      return { ok: false, retrySec };
    }
    list.push(now);
    hits.set(key, list);
    return { ok: true };
  }

  return { check };
}

module.exports = { createRateLimiter };
