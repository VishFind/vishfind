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

function aliasList() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands.json'), 'utf8'));
  } catch (_) {
    const reg = loadRegistry();
    const out = [];
    for (const b of reg.brands || []) {
      for (const a of b.aliases || []) out.push(a);
    }
    return out.sort((a, b) => b.length - a.length);
  }
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
