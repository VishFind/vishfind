'use strict';

/**
 * iSearch — локальный слой демо-предложений (без парсинга и внешних API).
 *
 * Данные: data/demo-offers.json (позиции честно помечены is_demo: true).
 * Правила:
 *  1) только позиции in_stock === true (по умолчанию);
 *  2) если задан budget — отсев price > budget (в RUB-эквиваленте);
 *  3) score = +1 за совпадение категории, бренда, цвета, размера (по norm());
 *  4) показываем только позиции со score >= 1 (нет совпадений → пусто, честно);
 *  5) сортировка: score по убыванию, затем цена в RUB по возрастанию;
 *  6) максимум MAX_OFFERS (10) позиций в ответе.
 */

const fs = require('fs');
const path = require('path');

const DEMO_OFFERS_PATH = 'data/demo-offers.json';
const MAX_OFFERS = 10;

/**
 * Демо-курсы ТОЛЬКО для сравнения цен в разных валютах при сортировке/бюджете.
 * На экран курс не выводится и не конвертируется.
 */
const CURRENCY_RATE_RUB = { RUB: 1, USD: 95, EUR: 105 };

let cache = null;
let cachePath = null;

/** Приведение к виду для сравнения: lowercase, ё→е, убрать "'", ".", лишние пробелы. */
function norm(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[''.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** RUB-эквивалент цены; невалидная цена → Infinity (отсекается бюджетом). */
function priceInRub(offer) {
  const price = Number(offer && offer.price);
  if (!Number.isFinite(price) || price < 0) return Infinity;
  const rate = CURRENCY_RATE_RUB[String((offer && offer.currency) || 'RUB').toUpperCase()] || 1;
  return price * rate;
}

/** Чтение демо-каталога с кэшем; при ошибке — [] и console.warn (как loadJson в server.js). */
function loadOffers(relPath = DEMO_OFFERS_PATH) {
  if (cache && cachePath === relPath) return cache;
  cachePath = relPath;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'));
    cache = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn(relPath, 'не загружен:', e.message);
    cache = [];
  }
  return cache;
}

/** Совпадает ли значение позиции хотя бы с одним из значений запроса (оба через norm). */
function matchAny(offerValue, wantedValues) {
  const n = norm(offerValue);
  if (!n) return false;
  const wants = [].concat(wantedValues == null ? [] : wantedValues);
  return wants.some((w) => {
    const nw = norm(w);
    return nw !== '' && nw === n;
  });
}

/**
 * Оценка позиции относительно запроса.
 * score = 0..4: +1 категория, +1 бренд, +1 цвет, +1 размер.
 * Цвет запроса может быть составным («красный, синий») — совпадение любого из списка.
 * Сравнение только по norm(); никаких угадываний и синонимов.
 */
function scoreOffer(offer, parsed = {}) {
  let score = 0;
  if (matchAny(offer.category, [parsed.category])) score += 1;
  if (matchAny(offer.brand, [parsed.brand])) score += 1;
  const wantedColors = String(parsed.color == null ? '' : parsed.color)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (matchAny(offer.color, wantedColors)) score += 1;
  if (matchAny(offer.size, [parsed.size])) score += 1;
  return score;
}

/**
 * Подбор демо-предложений.
 *
 * @param {object} options
 * @param {object}  [options.parsed]          критерии запроса (как в ответе /api/search)
 * @param {number}  [options.budget=null]     максимум в RUB (null — без фильтра)
 * @param {boolean} [options.inStockOnly=true] только in_stock === true
 * @param {number}  [options.max=MAX_OFFERS]  максимум позиций в ответе
 * @param {object[]} [options.offers]         каталог (по умолчанию loadOffers())
 * @returns {object[]} копии позиций с полем score, score >= 1,
 *                     отсортированные по score ↓, затем цена в RUB ↑.
 */
function findOffers({ parsed = {}, budget = null, inStockOnly = true, max = MAX_OFFERS, offers = loadOffers() } = {}) {
  const budgetNum = budget == null ? null : Number(budget);
  const scored = [];
  for (const o of offers || []) {
    if (!o || typeof o !== 'object') continue;
    if (inStockOnly && o.in_stock !== true) continue;
    if (budgetNum != null && Number.isFinite(budgetNum) && !(priceInRub(o) <= budgetNum)) continue;
    const score = scoreOffer(o, parsed);
    if (score < 1) continue; // нет совпадений — честно не показываем
    scored.push({ ...o, score });
  }
  scored.sort((a, b) => b.score - a.score || priceInRub(a) - priceInRub(b));
  return scored.slice(0, max);
}

module.exports = {
  loadOffers,
  findOffers,
  scoreOffer,
  norm,
  priceInRub,
  CURRENCY_RATE_RUB,
  DEMO_OFFERS_PATH,
  MAX_OFFERS,
};