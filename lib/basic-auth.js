'use strict';

/**
 * Проверка HTTP Basic Auth.
 * Пароль и заголовок Authorization сюда только для сравнения, наружу и в логи не пишутся.
 */

const crypto = require('crypto');

const MAX_HEADER = 1024;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * @param {string|undefined} header
 * @returns {{ user: string, password: string }|null}
 */
function parseBasicAuthorization(header) {
  if (typeof header !== 'string') return null;
  if (header.length > MAX_HEADER) return null;
  const m = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(header.trim());
  if (!m) return null;
  let decoded;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch (_) {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i <= 0) return null;
  return { user: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

/**
 * Сравнивает и логин, и пароль, даже если логин уже не совпал.
 * @param {string|undefined} header
 * @param {string} user
 * @param {string} password
 */
function credentialsAccepted(header, user, password) {
  const parsed = parseBasicAuthorization(header);
  const givenUser = parsed ? parsed.user : '';
  const givenPass = parsed ? parsed.password : '';
  const userOk = safeEqual(givenUser, user);
  const passOk = safeEqual(givenPass, password);
  return userOk && passOk;
}

module.exports = {
  parseBasicAuthorization,
  credentialsAccepted,
};
