'use strict';

/**
 * Перед стартом сервера: если есть зашифрованный каталог и ключ в env —
 * распаковывает data/takprodam-catalog/catalog.json (не коммитится).
 * Без ключа сервер стартует, но карточек не будет.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENC = path.join(ROOT, 'data', 'takprodam-catalog', 'catalog.json.gz.enc');
const OUT = path.join(ROOT, 'data', 'takprodam-catalog', 'catalog.json');

function keyFromEnv() {
  const raw = String(process.env.CATALOG_DECRYPT_KEY || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && Buffer.from(raw, 'base64').length === 32) {
    return Buffer.from(raw, 'base64');
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function decrypt() {
  if (!fs.existsSync(ENC)) {
    console.log('[prepare-catalog] no encrypted catalog, skip');
    return;
  }
  const key = keyFromEnv();
  if (!key) {
    console.warn(
      '[prepare-catalog] CATALOG_DECRYPT_KEY не задан — catalog.json не собран. Карточки партнёров на проде не появятся.'
    );
    return;
  }
  const blob = fs.readFileSync(ENC);
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
  // refresh fetched_at so max-age не режет сразу после деплоя
  const catalog = JSON.parse(json.toString('utf8'));
  catalog.fetched_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog));
  console.log(
    '[prepare-catalog] decrypted ok, items=',
    Array.isArray(catalog.items) ? catalog.items.length : 0
  );
}

try {
  decrypt();
} catch (e) {
  console.error('[prepare-catalog] failed:', e && e.message ? e.message : e);
  process.exit(1);
}
