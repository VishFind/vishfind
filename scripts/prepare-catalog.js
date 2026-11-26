'use strict';

/**
 * Перед стартом: расшифровывает catalog.json.gz.enc → catalog.json.
 * Ошибки НЕ валят процесс: сервер должен подняться даже без карточек
 * (иначе Timeweb уходит в restart loop).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FEEDS_LOCAL = path.join(ROOT, 'data', 'admitad-feeds');
const ENC_LOCAL = path.join(FEEDS_LOCAL, 'catalog.json.gz.enc');
const ENC_LEGACY = path.join(ROOT, 'data', 'takprodam-catalog', 'catalog.json.gz.enc');

function resolveOutPath() {
  const configured = String(process.env.PARTNER_CATALOG_PATH || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
  }
  const dataRoot = String(process.env.PARTNER_CATALOG_DATA_ROOT || '/data').trim() || '/data';
  try {
    if (fs.existsSync(dataRoot)) {
      const dir = path.join(dataRoot, 'admitad-feeds');
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return path.join(dir, 'catalog.json');
    }
  } catch (_) {
    /* нет прав на /data */
  }
  return path.join(FEEDS_LOCAL, 'catalog.json');
}

function keyFromEnv() {
  const raw = String(process.env.CATALOG_DECRYPT_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!raw) return null;
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch (_) {
    /* not base64 */
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function decrypt() {
  const encPath = fs.existsSync(ENC_LOCAL)
    ? ENC_LOCAL
    : fs.existsSync(ENC_LEGACY)
      ? ENC_LEGACY
      : null;
  if (!encPath) {
    console.log('[prepare-catalog] no encrypted catalog, skip');
    return;
  }
  const key = keyFromEnv();
  if (!key) {
    console.warn(
      '[prepare-catalog] CATALOG_DECRYPT_KEY не задан — карточки партнёров не загрузятся, сервер стартует.'
    );
    return;
  }

  const blob = fs.readFileSync(encPath);
  if (blob.length < 3 + 12 + 16 || blob.slice(0, 3).toString() !== 'VF1') {
    throw new Error('bad catalog envelope');
  }
  const iv = blob.subarray(3, 15);
  const tag = blob.subarray(15, 31);
  const data = blob.subarray(31);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const gz = Buffer.concat([decipher.update(data), decipher.final()]);
  const json = zlib.gunzipSync(gz);
  const catalog = JSON.parse(json.toString('utf8'));
  catalog.fetched_at = new Date().toISOString();
  catalog.provider = 'admitad';

  const out = resolveOutPath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(catalog));
  console.log(
    '[prepare-catalog] decrypted ok, items=',
    Array.isArray(catalog.items) ? catalog.items.length : 0,
    'out=',
    out
  );
}

try {
  decrypt();
} catch (e) {
  // Не exit(1): иначе Timeweb Apps крутит restart loop и не сканирует порт.
  console.error(
    '[prepare-catalog] failed (server will start without partner cards):',
    e && e.message ? e.message : e
  );
}
