'use strict';

/**
 * Санитизированное логирование VishFind.
 *
 * - JSON-строки в stdout: { ts, level, msg, ...meta } — платформа может
 *   собирать их как структурированные логи.
 * - Секреты и персональные данные маскируются рекурсивно по имени поля.
 * - base64-фото, длинные значения и IP-адреса обрезаются/маскируются.
 * - Уровни: error < warn < info < debug (LOG_LEVEL).
 *
 * Что НИКОГДА не попадает в лог:
 *   - значения ключей (client_secret, access_token, api_key, cookies и т.п.);
 *   - тела запросов и base64-фото;
 *   - полные IP-адреса;
 *   - raw-запросы пользователя (только усечённый фрагмент на debug).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** Имена полей, значения которых считаем секретами. */
const SECRET_KEY_RE =
  /(authorization|client[-_]?secret|client[-_]?id|access[-_]?token|refresh[-_]?token|api[-_]?key|x-api-key|password|passwd|cookie|set-cookie|secret|token)/i;

const MAX_STRING = 500;
const MAX_STACK = 2000;
const MAX_DEPTH = 6;

/** Маскировка email-адресов. */
function maskEmails(s) {
  return s.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1@***');
}

/** Маскировка телефонных номеров (минимум 10 цифр — чтобы не задеть даты). */
function maskPhones(s) {
  return s.replace(/(?<!\d)(\+?\d[\d\s()-]{8,}\d)(?!\d)/g, (m) => m.slice(0, 4) + '***');
}

/** Маскировка IPv4: оставляем только первые два октета. */
function maskIpv4(s) {
  return s.replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.$2.***.***');
}

/** Является ли строка base64-фото (data URI или длинный base64-блоб). */
function isImageBase64(s) {
  if (/^data:image\//i.test(s)) return true;
  return s.length >= 200 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/**
 * Рекурсивная санитизация значения перед записью в лог.
 * @param {*} value
 * @param {number} depth
 * @returns {*}
 */
function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[max-depth]';

  if (typeof value === 'string') {
    if (isImageBase64(value)) return '[image-base64]';
    let s = maskEmails(value);
    s = maskPhones(s);
    s = maskIpv4(s);
    if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + '…[truncated]';
    return s;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) out[k] = '***';
      else out[k] = sanitize(v, depth + 1);
    }
    return out;
  }

  return value;
}

/** Преобразование ошибки в безопасный meta (имя, сообщение, стек). */
function errorToMeta(err) {
  if (!err) return { error: null };
  return {
    error: {
      name: err.name || 'Error',
      message: sanitize(String(err.message || '')),
      stack: sanitize(String(err.stack || '')).slice(0, MAX_STACK),
    },
  };
}

/**
 * Создание логгера.
 * @param {object} opts
 * @param {string} [opts.level='warn'] error | warn | info | debug
 * @param {NodeJS.WritableStream} [opts.stream=process.stdout]
 */
function createLogger({ level = 'warn', stream = process.stdout } = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] != null ? LEVELS[String(level).toLowerCase()] : LEVELS.warn;

  function write(lvl, msg, meta) {
    if (LEVELS[lvl] > threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      msg: String(msg),
      ...(meta ? sanitize(meta) : {}),
    });
    stream.write(line + '\n');
  }

  return {
    error: (msg, meta) => write('error', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    debug: (msg, meta) => write('debug', msg, meta),
    sanitize,
    errorToMeta,
  };
}

module.exports = { createLogger, sanitize, errorToMeta, LEVELS };