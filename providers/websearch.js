'use strict';

/**
 * Провайдер веб-поиска через Ollama Web Search (или legacy Tavily).
 * Ключ только на сервере. Не подтверждает оригинал/цену/наличие.
 */

const ollamaWeb = require('../lib/ollama-web');

async function search(input) {
  if (!ollamaWeb.isEnabled()) {
    return {
      provider: 'websearch',
      items: [],
      disabled: true,
      reason: ollamaWeb.isConfigured()
        ? 'веб-поиск выключен (WEB_SEARCH_ENABLED=false)'
        : 'OLLAMA_API_KEY не настроен',
    };
  }
  const parsed = (input && input.parsed) || {};
  const domains = Array.isArray(input && input.domains) ? input.domains : [];
  const enrich = await ollamaWeb.enrichBrandSearch(parsed, domains);
  return {
    provider: 'websearch',
    items: enrich.items || [],
    used: enrich.used,
    warnings: enrich.warnings || [],
    reason: enrich.reason || null,
  };
}

function isEnabled() {
  return ollamaWeb.isEnabled();
}

module.exports = {
  id: 'websearch',
  get enabled() {
    return isEnabled();
  },
  search,
  isEnabled,
};
