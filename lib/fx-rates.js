'use strict';

/**
 * Провайдер ориентировочных курсов валют.
 *
 * Google: документированного серверного REST API нет.
 * GOOGLEFINANCE работает только в Google Sheets и недоступен как backend API.
 * Live-режим Google здесь НЕ включается — без подмены другим источником.
 *
 * Интерфейс готов к подключению согласованного провайдера.
 */

const SUPPORTED = ['RUB', 'USD', 'EUR', 'CNY', 'GBP'];

/** @typedef {{ rate: number, from: string, to: string, as_of: string, source: string, stale?: boolean }} FxQuote */

const state = {
  provider: 'none',
  blocker:
    'У Google нет документированного публичного REST API курсов для серверов. '
    + 'GOOGLEFINANCE — функция Google Sheets, не backend. '
    + 'Скрейпинг сниппетов не считаем устойчивой интеграцией. '
    + 'Нужно согласование владельца: Sheets-прокси, другой документированный API или отказ от live-конвертации.',
  cache: new Map(),
};

function normalizeCcy(c) {
  const x = String(c || '').trim().toUpperCase();
  return SUPPORTED.includes(x) ? x : null;
}

/**
 * @returns {Promise<FxQuote|null>}
 */
async function getRate(from, to) {
  const a = normalizeCcy(from);
  const b = normalizeCcy(to);
  if (!a || !b) return null;
  if (a === b) {
    return {
      rate: 1,
      from: a,
      to: b,
      as_of: new Date().toISOString().slice(0, 10),
      source: 'identity',
    };
  }
  // Live отключён: нет согласованного источника.
  return null;
}

/**
 * Пересчёт бюджета: нижняя граница вниз, верхняя вверх (наружу).
 * Исходный бюджет не меняется — возвращается производное.
 */
function convertBudget(budgetMin, budgetMax, fromCcy, toCcy, quote) {
  const from = normalizeCcy(fromCcy) || 'RUB';
  const to = normalizeCcy(toCcy);
  if (!to || !quote || !(quote.rate > 0)) {
    return {
      ok: false,
      original: { min: budgetMin, max: budgetMax, currency: from },
      converted: null,
      warning: 'Конвертация недоступна — ориентируйтесь на цену на сайте.',
    };
  }
  const rate = Number(quote.rate);
  function outMin(n) {
    if (n == null || !Number.isFinite(n)) return null;
    return Math.floor(n * rate);
  }
  function outMax(n) {
    if (n == null || !Number.isFinite(n)) return null;
    return Math.ceil(n * rate);
  }
  return {
    ok: true,
    original: { min: budgetMin, max: budgetMax, currency: from },
    converted: {
      min: outMin(budgetMin),
      max: outMax(budgetMax),
      currency: to,
      rate,
      rate_as_of: quote.as_of,
      rate_source: quote.source,
    },
    warning:
      quote.source && /google/i.test(quote.source)
        ? 'Курс получен из Google Finance и может быть неточным. Итоговая сумма зависит от курса оплаты, доставки и комиссий.'
        : 'Ориентировочный курс; итог на сайте может отличаться.',
  };
}

function publicStatus() {
  return {
    provider: state.provider,
    live: false,
    supported: SUPPORTED.slice(),
    blocker: state.blocker,
  };
}

module.exports = {
  SUPPORTED,
  getRate,
  convertBudget,
  publicStatus,
  normalizeCcy,
};
