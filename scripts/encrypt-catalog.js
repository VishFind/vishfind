'use strict';

/** Упаковать data/admitad-feeds/catalog.json → catalog.json.gz.enc */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FEEDS = path.join(ROOT, 'data', 'admitad-feeds');
const SRC = path.join(FEEDS, 'catalog.json');
const OUT = path.join(FEEDS, 'catalog.json.gz.enc');
const KEY_FILE = path.join(FEEDS, 'CATALOG_DECRYPT_KEY.local');

function loadKey() {
  const fromEnv = String(process.env.CATALOG_DECRYPT_KEY || '').trim();
  if (fromEnv) {
    if (/^[A-Za-z0-9+/=]+$/.test(fromEnv) && Buffer.from(fromEnv, 'base64').length === 32) {
      return Buffer.from(fromEnv, 'base64');
    }
    return crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
  }
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(String(fs.readFileSync(KEY_FILE, 'utf8')).trim(), 'base64');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('base64'));
  console.log('wrote new key', KEY_FILE);
  return key;
}

if (!fs.existsSync(SRC)) {
  console.error('missing', SRC, '— сначала npm run import-admitad-feeds');
  process.exit(1);
}
const key = loadKey();
const gz = zlib.gzipSync(fs.readFileSync(SRC), { level: 9 });
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
const tag = cipher.getAuthTag();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([Buffer.from('VF1'), iv, tag, enc]));
console.log('encrypted', OUT, 'bytes', fs.statSync(OUT).size);
