'use strict';

/**
 * Точка расширения: каждый источник данных — отдельный файл с интерфейсом
 *   { id, enabled, search(input) -> { provider, items } }
 * Сейчас активен только провайдер «ссылки».
 */

const links = require('./links');
const websearch = require('./websearch');

const ALL = [links, websearch];

function listProviders() {
  return ALL.map((p) => ({ id: p.id, enabled: !!p.enabled }));
}

async function runEnabled(input) {
  const results = [];
  for (const p of ALL) {
    if (!p.enabled) continue;
    results.push(await p.search(input));
  }
  return results;
}

module.exports = {
  listProviders,
  runEnabled,
  links,
  websearch,
};
