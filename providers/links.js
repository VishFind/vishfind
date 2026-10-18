'use strict';

/**
 * Провайдер «ссылки»: строит прямые URL на поиск площадок.
 * Не ходит в сеть, не выдумывает товары и цены.
 *
 * Форматы URL (проверено 2026-10-18, см. data/sources.json):
 *  - Ozon:           https://www.ozon.ru/search/?text={q}
 *  - Wildberries:    https://www.wildberries.ru/catalog/0/search.aspx?search={q}
 *  - Яндекс Маркет:  https://market.yandex.ru/search?text={q}  (+ priceto при бюджете)
 *  - Avito:          https://www.avito.ru/all?q={q}
 *  - Lamoda:         https://www.lamoda.ru/catalogsearch/result/?q={q}
 *  - Zara:           https://www.zara.com/ru/ru/search?searchTerm={q}
 *  - eBay:           https://www.ebay.com/sch/i.html?_nkw={q}
 */

const TYPE_LABELS = {
  marketplace: 'маркетплейс',
  official_store: 'официальный магазин',
  vintage: 'винтаж',
};

function buildUrl(source, phrase, budget) {
  const enc = encodeURIComponent(phrase);
  let url = String(source.url_template || '').replace('{q}', enc);
  let price_filter_applied = false;
  let price_filter_note = null;

  if (budget != null && source.price_param && source.price_filter_verified) {
    let value = source.price_format || '{max}';
    value = value
      .replace('{max}', String(budget))
      .replace('{max_kopecks}', String(budget * 100));
    const join = url.includes('?') ? '&' : '?';
    url += `${join}${source.price_param}=${encodeURIComponent(value)}`;
    price_filter_applied = true;
  } else if (budget != null && source.price_param && !source.price_filter_verified) {
    price_filter_note =
      'Фильтр цены в URL этой площадки пока не подтверждён — откройте поиск и ограничьте цену вручную.';
  } else if (budget != null && !source.price_param) {
    price_filter_note =
      'У этой площадки фильтр цены в ссылку не подставляем — задайте бюджет на сайте.';
  }

  return { url, price_filter_applied, price_filter_note };
}

/**
 * @param {{ parsed: object, sources: object[] }} input
 * @returns {Promise<{ provider: string, items: object[] }>}
 */
async function search(input) {
  const parsed = input.parsed || {};
  const phrase = parsed.search_phrase || parsed.raw_query;
  if (!phrase) {
    return { provider: 'links', items: [] };
  }

  const items = [];
  for (const source of input.sources || []) {
    if (!source || source.verified !== true) continue;
    const built = buildUrl(source, phrase, parsed.budget);
    items.push({
      id: source.id,
      name: source.name,
      type: source.type,
      type_label: TYPE_LABELS[source.type] || source.type,
      url: built.url,
      price_filter_applied: built.price_filter_applied,
      price_filter_note: built.price_filter_note,
    });
  }

  return { provider: 'links', items };
}

module.exports = {
  id: 'links',
  enabled: true,
  search,
  TYPE_LABELS,
};
