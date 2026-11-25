'use strict';

/**
 * Пауза обновлений отдельных marketplace-срезов Takprodam.
 *
 * Это пауза до проверки условий (новые запросы / публичное размещение),
 * а не вывод о запрете площадки. Адаптер и данные на диске сохраняются;
 * last_success_at / TTL не меняются этим модулем.
 *
 * Env:
 *   TAKPRODAM_MARKETPLACE_PAUSE — список slug через запятую.
 *   По умолчанию: lamoda.
 *   Пустая строка («») — пауза снята со всех.
 */

const DEFAULT_PAUSED = Object.freeze(['lamoda']);

function parsePausedList(raw, fallback) {
  if (raw === '') return [];
  const source = raw == null ? fallback : raw;
  return String(source)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function pausedMarketplaces(env) {
  const e = env || process.env;
  return new Set(parsePausedList(e.TAKPRODAM_MARKETPLACE_PAUSE, DEFAULT_PAUSED.join(',')));
}

function isMarketplacePaused(marketplaceKey, env) {
  const key = String(marketplaceKey || '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  return pausedMarketplaces(env).has(key);
}

function pauseNote(marketplaceKey) {
  const key = String(marketplaceKey || 'marketplace');
  return (
    'Обновление «' +
    key +
    '» на паузе до проверки условий: новые запросы и публичное размещение не выполняются. ' +
    'Адаптер и существующие данные сохранены; время актуальности не менялось. Это не вывод о запрете.'
  );
}

module.exports = {
  DEFAULT_PAUSED,
  pausedMarketplaces,
  isMarketplacePaused,
  pauseNote,
};
