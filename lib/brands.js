'use strict';

/**
 * Загрузка реестра брендов + плоский список алиасов для parse-query.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brand-registry.json'), 'utf8'));
  } catch (_) {
    return { version: 1, brands: [] };
  }
}

/** Алиасы магазинов из Admitad-фидов VishFind — чтобы «куртка 2mood» распознавался как бренд. */
const PARTNER_FEED_ALIASES = [
  '2MOOD',
  '2mood',
  '2 mood',
  'too mood',
  'ту муд',
  'Finn Flare',
  'finn flare',
  'finnflare',
  'финн флер',
  'Shopping Live',
  'shopping live',
  'shoppinglive',
  'Waistline',
  'waistline',
  'wasteline',
  'вейстлайн',
  'Rieker',
  'rieker',
  'рикер',
];

function aliasList() {
  let base = [];
  try {
    base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands.json'), 'utf8'));
  } catch (_) {
    const reg = loadRegistry();
    for (const b of reg.brands || []) {
      for (const a of b.aliases || []) base.push(a);
    }
  }
  if (!Array.isArray(base)) base = [];
  const seen = new Set(base.map((a) => String(a).toLowerCase()));
  for (const a of PARTNER_FEED_ALIASES) {
    const key = String(a).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(a);
  }
  return base.sort((a, b) => b.length - a.length);
}

function findBrand(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const b of loadRegistry().brands || []) {
    if (String(b.name).toLowerCase() === n) return b;
    if ((b.aliases || []).some((a) => String(a).toLowerCase() === n)) return b;
    if (b.id === n) return b;
  }
  return null;
}

function summary() {
  const brands = loadRegistry().brands || [];
  return {
    total: brands.length,
    with_domain: brands.filter((b) => b.domain).length,
    candidates: brands.filter((b) => b.status === 'candidate').length,
  };
}

module.exports = {
  loadRegistry,
  aliasList,
  findBrand,
  summary,
};
