'use strict';

/**
 * Провайдер веб-поиска (Tavily и т.п.).
 * По умолчанию ВЫКЛЮЧЕН. Включается только если в .env есть ключ
 * И явно задано WEB_SEARCH_ENABLED=true.
 *
 * Бесплатные квоты не считаем гарантированными; ключ не светить во frontend.
 */

async function search() {
  return { provider: 'websearch', items: [], disabled: true, reason: 'веб-поиск выключен' };
}

function isEnabled() {
  if (String(process.env.WEB_SEARCH_ENABLED || '').toLowerCase() !== 'true') return false;
  return !!(process.env.TAVILY_API_KEY || process.env.OLLAMA_API_KEY);
}

module.exports = {
  id: 'websearch',
  get enabled() {
    return isEnabled();
  },
  search,
};
